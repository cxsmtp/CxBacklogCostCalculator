/*
 * model.js — the analytics behind the calculator.
 *
 * Everything here is a pure function on plain data. That matters twice over:
 * the app calls it directly, and the exported customer report embeds a
 * serialised copy of this same object, so the numbers in the export are
 * produced by exactly the code that produced them on screen.
 *
 * Vocabulary
 *   open        vulnerabilities in the backlog at the end of a week
 *   fixed       vulnerabilities that left the backlog during a week
 *   introduced  derived: open(t) - open(t-1) + fixed(t)
 *   processed   findings a team gets through per week going forward — every one
 *               is triaged; the true positives are then remediated
 *   credit      one Checkmarx credit: 1 per triage, 3 per remediation by default
 *
 * Per severity the plan picks one of three modes, and the whole model keys off
 * it — cost, burn-down and forecast alike:
 *
 *   'full'    triage everything, remediate the true positives. The severity
 *             can reach zero.
 *   'triage'  triage everything, remediate nothing. Only the false positives
 *             leave the backlog; the real findings stay, by choice.
 *   'none'    out of the plan entirely. No credits, no movement.
 */
window.CxModel = {
  SEVERITIES: ['Critical', 'High', 'Medium', 'Low', 'Info'],

  MODES: ['full', 'triage', 'none'],

  MODE_LABEL: {
    full: 'Triage + remediate',
    triage: 'Triage only',
    none: 'Not in plan',
  },

  /* Assumptions the team can override in the UI. The true-positive defaults are
   * typical AppSec figures, not measured values — replace them with real triage
   * history as soon as there is any. */
  DEFAULTS: {
    triageCredits: 1,
    remediationCredits: 3,
    truePositiveRate: { Critical: 0.85, High: 0.75, Medium: 0.60, Low: 0.40, Info: 0.10 },
    modes: { Critical: 'full', High: 'full', Medium: 'full', Low: 'full', Info: 'none' },
    lookbackWeeks: 8,
    horizonWeeks: 52,
    allocation: 'severity-first',
  },

  /* ------------------------------------------------------------- utilities -- */

  sum(list) {
    let total = 0;
    for (const v of list) if (typeof v === 'number' && isFinite(v)) total += v;
    return total;
  },

  mean(list) {
    const usable = list.filter((v) => typeof v === 'number' && isFinite(v));
    return usable.length ? CxModel.sum(usable) / usable.length : 0;
  },

  /* Least-squares slope of y against its own index — change per week. */
  slope(values) {
    const points = values.map((y, x) => [x, y]).filter((p) => typeof p[1] === 'number' && isFinite(p[1]));
    const n = points.length;
    if (n < 2) return 0;
    const meanX = CxModel.sum(points.map((p) => p[0])) / n;
    const meanY = CxModel.sum(points.map((p) => p[1])) / n;
    let num = 0;
    let den = 0;
    for (const [x, y] of points) { num += (x - meanX) * (y - meanY); den += (x - meanX) ** 2; }
    return den === 0 ? 0 : num / den;
  },

  emptyBySeverity(value) {
    const out = {};
    for (const s of CxModel.SEVERITIES) out[s] = typeof value === 'function' ? value(s) : value;
    return out;
  },

  addWeeks(isoDate, weeks) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + weeks * 7));
    const pad = (n) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  },

  /* ----------------------------------------------------------------- modes -- */

  inPlan(modes, severity) { return (modes[severity] || 'none') !== 'none'; },

  /** Severities the plan touches at all, worst first. */
  scopeList(modes) {
    return CxModel.SEVERITIES.filter((s) => CxModel.inPlan(modes, s));
  },

  /* --------------------------------------------------------------- framing -- */

  /**
   * Align the two exports onto one weekly timeline and derive the influx.
   * Weeks present in only one file are kept — the missing side stays null so it
   * is visibly absent rather than silently zero.
   */
  align(totals, fixed) {
    const weeks = Array.from(new Set([...(totals?.weeks || []), ...(fixed?.weeks || [])])).sort();
    const valueAt = (series, week, severity) => {
      if (!series) return null;
      const i = series.weeks.indexOf(week);
      return i < 0 ? null : (series.bySeverity[severity][i] ?? 0);
    };

    const open = CxModel.emptyBySeverity(() => []);
    const fixes = CxModel.emptyBySeverity(() => []);
    const introduced = CxModel.emptyBySeverity(() => []);

    for (const week of weeks) {
      for (const s of CxModel.SEVERITIES) {
        open[s].push(valueAt(totals, week, s));
        fixes[s].push(valueAt(fixed, week, s));
      }
    }

    weeks.forEach((_, i) => {
      for (const s of CxModel.SEVERITIES) {
        if (i === 0) { introduced[s].push(null); continue; }
        const before = open[s][i - 1];
        const now = open[s][i];
        const cleared = fixes[s][i];
        introduced[s].push(
          before === null || now === null || cleared === null ? null : now - before + cleared
        );
      }
    });

    return {
      weeks, open, fixed: fixes, introduced,
      missingTotals: weeks.filter((w) => !(totals?.weeks || []).includes(w)),
      missingFixed: weeks.filter((w) => !(fixed?.weeks || []).includes(w)),
    };
  },

  /** Sum a per-severity frame across the severities currently in the plan. */
  scoped(frame, modes) {
    const inScope = CxModel.scopeList(modes);
    const length = inScope.length ? frame[inScope[0]].length : 0;
    const out = [];
    for (let i = 0; i < length; i++) {
      let total = 0;
      let known = false;
      for (const s of inScope) {
        const v = frame[s][i];
        if (v === null || v === undefined) continue;
        total += v;
        known = true;
      }
      out.push(known ? total : null);
    }
    return out;
  },

  /* ---------------------------------------------------------------- stats -- */

  /** Headline rates over the last `lookbackWeeks` weeks, per severity and rolled up. */
  stats(frames, modes, lookbackWeeks) {
    const weeks = frames.weeks;
    const lastIndex = weeks.length - 1;
    const from = Math.max(1, weeks.length - (lookbackWeeks || CxModel.DEFAULTS.lookbackWeeks));

    const bySeverity = {};
    for (const s of CxModel.SEVERITIES) {
      const avgIntroduced = CxModel.mean(frames.introduced[s].slice(from));
      const avgFixed = CxModel.mean(frames.fixed[s].slice(from));
      bySeverity[s] = {
        backlog: frames.open[s][lastIndex] ?? 0,
        avgIntroduced,
        avgFixed,
        netWeekly: avgFixed - avgIntroduced,
        fixRatio: avgIntroduced > 0 ? avgFixed / avgIntroduced : 0,
        backlogSlope: CxModel.slope(frames.open[s].slice(from - 1)),
        totalFixed: CxModel.sum(frames.fixed[s]),
      };
    }

    const inScope = CxModel.scopeList(modes);
    const roll = (key) => CxModel.sum(inScope.map((s) => bySeverity[s][key]));
    const avgIntroduced = roll('avgIntroduced');
    const avgFixed = roll('avgFixed');

    return {
      bySeverity,
      weeksOfData: weeks.length,
      weeksUsed: weeks.length - from,
      firstWeek: weeks[0],
      lastWeek: weeks[lastIndex],
      scope: {
        backlog: roll('backlog'),
        avgIntroduced,
        avgFixed,
        netWeekly: avgFixed - avgIntroduced,
        fixRatio: avgIntroduced > 0 ? avgFixed / avgIntroduced : 0,
        totalFixed: roll('totalFixed'),
        backlogSlope: CxModel.slope(CxModel.scoped(frames.open, modes).slice(from - 1)),
      },
    };
  },

  /* ----------------------------------------------------------------- cost -- */

  /** Credits to put one finding of this severity through the chosen mode. */
  unitCost(severity, assumptions, mode) {
    if (mode === 'none') return 0;
    const tpRate = assumptions.truePositiveRate[severity] ?? 0;
    if (mode === 'triage') return assumptions.triageCredits;
    return assumptions.triageCredits + tpRate * assumptions.remediationCredits;
  },

  /** Share of a severity that actually leaves the backlog under its mode. */
  removalRate(severity, assumptions, mode) {
    if (mode === 'none') return 0;
    if (mode === 'triage') return 1 - (assumptions.truePositiveRate[severity] ?? 0);
    return 1;
  },

  /**
   * Credits needed to work through `counts` findings under `modes`.
   * Everything in the plan is triaged; only 'full' severities are remediated.
   */
  cost(counts, assumptions, modes) {
    const bySeverity = {};
    let totalCount = 0;
    let totalTriage = 0;
    let totalRemediation = 0;
    let totalTruePositives = 0;
    let totalRemoved = 0;

    for (const s of CxModel.SEVERITIES) {
      const mode = modes[s] || 'none';
      const count = Math.max(0, counts[s] || 0);
      const tpRate = assumptions.truePositiveRate[s] ?? 0;
      const truePositives = count * tpRate;
      const inPlan = mode !== 'none';
      const triage = inPlan ? count * assumptions.triageCredits : 0;
      const remediation = mode === 'full' ? truePositives * assumptions.remediationCredits : 0;
      const removed = count * CxModel.removalRate(s, assumptions, mode);

      bySeverity[s] = {
        mode,
        count,
        truePositives,
        falsePositives: count - truePositives,
        triage,
        remediation,
        removed,
        leftInPlace: inPlan ? count - removed : 0,
        total: triage + remediation,
        creditsEach: CxModel.unitCost(s, assumptions, mode),
      };

      if (!inPlan) continue;
      totalCount += count;
      totalTriage += triage;
      totalRemediation += remediation;
      totalTruePositives += truePositives;
      totalRemoved += removed;
    }

    return {
      bySeverity,
      count: totalCount,
      truePositives: totalTruePositives,
      removed: totalRemoved,
      leftInPlace: totalCount - totalRemoved,
      triage: totalTriage,
      remediation: totalRemediation,
      total: totalTriage + totalRemediation,
      blendedCreditsEach: totalCount > 0 ? (totalTriage + totalRemediation) / totalCount : 0,
    };
  },

  /* ------------------------------------------------------------- forecast -- */

  /**
   * Roll the backlog forward a week at a time.
   *
   * Each severity holds two buckets: findings not yet triaged (`pending`) and
   * true positives that were triaged but deliberately left unfixed under
   * 'triage' mode (`residual`). Weekly capacity is spent processing pending
   * findings, worst severity first; a processed finding costs one triage credit
   * and, when the mode is 'full' and it is a true positive, the remediation
   * credits too.
   */
  forecast(options) {
    const {
      startBacklog, influx, weeklyProcessing, horizonWeeks, modes, assumptions,
      allocation = 'severity-first', startWeek,
    } = options;

    const inScope = CxModel.scopeList(modes);
    const pending = {};
    const residual = {};
    for (const s of CxModel.SEVERITIES) {
      pending[s] = Math.max(0, startBacklog[s] || 0);
      residual[s] = 0;
    }

    const weeks = [];
    let cumulativeProcessed = 0;
    let cumulativeRemoved = 0;
    let cumulativeCredits = 0;
    let clearedWeek = null;

    for (let w = 1; w <= horizonWeeks; w++) {
      for (const s of inScope) pending[s] += Math.max(0, influx[s] || 0);

      const demand = CxModel.sum(inScope.map((s) => pending[s]));
      let capacity = Math.max(0, Math.min(weeklyProcessing, demand));

      const processed = CxModel.emptyBySeverity(0);
      if (capacity > 0) {
        if (allocation === 'proportional' && demand > 0) {
          for (const s of inScope) processed[s] = capacity * (pending[s] / demand);
        } else {
          for (const s of CxModel.SEVERITIES) {
            if (!CxModel.inPlan(modes, s) || capacity <= 0) continue;
            const take = Math.min(pending[s], capacity);
            processed[s] = take;
            capacity -= take;
          }
        }
      }

      let weekProcessed = 0;
      let weekRemoved = 0;
      let weekCredits = 0;
      for (const s of inScope) {
        const mode = modes[s];
        const done = processed[s];
        const removed = done * CxModel.removalRate(s, assumptions, mode);
        pending[s] = Math.max(0, pending[s] - done);
        residual[s] += done - removed;
        weekProcessed += done;
        weekRemoved += removed;
        weekCredits += done * CxModel.unitCost(s, assumptions, mode);
      }
      cumulativeProcessed += weekProcessed;
      cumulativeRemoved += weekRemoved;
      cumulativeCredits += weekCredits;

      const open = {};
      for (const s of CxModel.SEVERITIES) open[s] = pending[s] + residual[s];
      const remaining = CxModel.sum(inScope.map((s) => open[s]));
      const untriaged = CxModel.sum(inScope.map((s) => pending[s]));
      if (clearedWeek === null && remaining < 1) clearedWeek = w;

      weeks.push({
        week: w,
        date: startWeek ? CxModel.addWeeks(startWeek, w) : null,
        open,
        pending: { ...pending },
        residual: { ...residual },
        processed: { ...processed },
        remaining,
        untriaged,
        weekProcessed,
        weekRemoved,
        weekCredits,
        cumulativeProcessed,
        cumulativeRemoved,
        cumulativeCredits,
      });
    }

    // Closed form for time-to-zero, so the answer survives past the charted
    // horizon. Only reachable when every severity in the plan is remediated.
    const totalInflux = CxModel.sum(inScope.map((s) => influx[s] || 0));
    const netBurn = weeklyProcessing - totalInflux;
    const startTotal = CxModel.sum(inScope.map((s) => startBacklog[s] || 0));
    const reachesZero = inScope.length > 0 && inScope.every((s) => modes[s] === 'full');

    return {
      weeks,
      clearedWeek,
      weeksToZero: reachesZero && netBurn > 0 ? startTotal / netBurn : null,
      neverZeroReason: reachesZero ? null : 'triage-only severities keep their true positives on the books',
      netBurn,
      startTotal,
      endTotal: weeks.length ? weeks[weeks.length - 1].remaining : startTotal,
      endResidual: CxModel.sum(inScope.map((s) => residual[s])),
      totalCredits: cumulativeCredits,
      totalProcessed: cumulativeProcessed,
      totalRemoved: cumulativeRemoved,
    };
  },

  /** Weekly processing needed to empty the backlog in `weeks`, influx included. */
  requiredProcessing(backlog, weeklyInflux, weeks) {
    if (!weeks || weeks <= 0) return Infinity;
    return backlog / weeks + weeklyInflux;
  },

  /**
   * How far a credit budget goes. Spends worst-first, so the answer is
   * "what does this budget buy" rather than an averaged abstraction.
   */
  budget(credits, backlog, assumptions, modes) {
    let remaining = credits;
    const processed = CxModel.emptyBySeverity(0);
    for (const s of CxModel.SEVERITIES) {
      if (!CxModel.inPlan(modes, s)) continue;
      const each = CxModel.unitCost(s, assumptions, modes[s]);
      if (each <= 0) continue;
      const affordable = Math.min(backlog[s] || 0, remaining / each);
      processed[s] = affordable;
      remaining -= affordable * each;
      if (remaining <= 0) break;
    }
    const inScope = CxModel.scopeList(modes);
    const total = CxModel.sum(inScope.map((s) => processed[s]));
    const removed = CxModel.sum(inScope.map((s) => processed[s] * CxModel.removalRate(s, assumptions, modes[s])));
    const backlogTotal = CxModel.sum(inScope.map((s) => backlog[s] || 0));
    return {
      processed,
      total,
      removed,
      leftover: Math.max(0, remaining),
      coverage: backlogTotal > 0 ? total / backlogTotal : 1,
    };
  },

  /* ------------------------------------------------------------ scenarios -- */

  /** Starting backlog and weekly arrivals for the severities in the plan. */
  planInputs(stats, modes) {
    const startBacklog = {};
    const influx = {};
    for (const s of CxModel.SEVERITIES) {
      const inPlan = CxModel.inPlan(modes, s);
      startBacklog[s] = inPlan ? stats.bySeverity[s].backlog : 0;
      influx[s] = inPlan ? Math.max(0, stats.bySeverity[s].avgIntroduced) : 0;
    }
    return { startBacklog, influx };
  },

  /**
   * The four comparisons that answer "what if we do nothing / keep going /
   * push harder / commit to a date".
   */
  scenarios(stats, modes, assumptions, settings) {
    const { startBacklog, influx } = CxModel.planInputs(stats, modes);
    const totalInflux = CxModel.sum(CxModel.scopeList(modes).map((s) => influx[s]));
    const base = {
      startBacklog, influx, modes, assumptions,
      horizonWeeks: settings.horizonWeeks,
      allocation: settings.allocation,
      startWeek: settings.startWeek,
    };

    const targetWeeks = settings.targetWeeks || 26;
    const currentPace = Math.max(0, stats.scope.avgFixed);
    const required = CxModel.requiredProcessing(stats.scope.backlog, totalInflux, targetWeeks);

    return [
      {
        id: 'nothing',
        name: 'Do nothing',
        note: 'No triage or remediation capacity funded. New findings keep arriving.',
        processing: 0,
        result: CxModel.forecast({ ...base, weeklyProcessing: 0 }),
      },
      {
        id: 'current',
        name: 'Current pace',
        note: `Keep going at ${CxModel.int(currentPace)} findings a week — the rate measured in the uploaded data.`,
        processing: currentPace,
        result: CxModel.forecast({ ...base, weeklyProcessing: currentPace }),
      },
      {
        id: 'target',
        name: settings.targetLabel || 'Chosen pace',
        note: `Work through ${CxModel.int(settings.targetProcessing)} findings a week.`,
        processing: settings.targetProcessing,
        result: CxModel.forecast({ ...base, weeklyProcessing: settings.targetProcessing }),
      },
      {
        id: 'deadline',
        name: `Clear in ${targetWeeks} weeks`,
        note: `Requires ${CxModel.int(required)} a week: the ${CxModel.int(totalInflux)} arriving each week plus the standing backlog.`,
        processing: required,
        result: CxModel.forecast({ ...base, weeklyProcessing: required }),
      },
    ];
  },

  /* ----------------------------------------------------------- formatting -- */

  int(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return Math.round(value).toLocaleString('en-US');
  },

  compact(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 1e9) return (value / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
    if (abs >= 1e6) return (value / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
    if (abs >= 1e4) return (value / 1e3).toFixed(0) + 'k';
    if (abs >= 1e3) return (value / 1e3).toFixed(1) + 'k';
    return Math.round(value).toLocaleString('en-US');
  },

  signed(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    const rounded = Math.round(value);
    return (rounded > 0 ? '+' : '') + rounded.toLocaleString('en-US');
  },

  pct(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return (value * 100).toFixed(digits === undefined ? 0 : digits) + '%';
  },

  weeksAsDuration(weeks) {
    if (weeks === null || weeks === undefined || !isFinite(weeks)) return 'not at this pace';
    if (weeks <= 0) return 'already clear';
    if (weeks < 8) return `${Math.ceil(weeks)} weeks`;
    if (weeks < 104) return `${Math.round(weeks)} weeks (~${(weeks / 52).toFixed(1)} years)`;
    return `${(weeks / 52).toFixed(1)} years`;
  },
};
