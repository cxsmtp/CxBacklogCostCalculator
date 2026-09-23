/*
 * model.js — the analytics behind the calculator.
 *
 * Everything here is a pure function on plain data. That matters twice over:
 * the app calls it directly, and the exported customer report embeds a
 * serialised copy of this same object, so the numbers in the export are
 * produced by exactly the code that produced them on screen. Nothing in this
 * file may close over anything outside it.
 *
 * Vocabulary
 *   open        vulnerabilities in the backlog at the end of a week
 *   fixed       vulnerabilities that left the backlog during a week
 *   introduced  derived: open(t) - open(t-1) + fixed(t)
 *   credit      one Checkmarx credit: 1 per triage, 3 per remediation by default
 *
 * The plan is deliberately simple. For each severity the customer sets two
 * numbers and nothing else:
 *
 *   selected  how many of the open findings to put through triage (0 .. open)
 *   fp        the share of those expected to come back false positive
 *
 * Everything selected is triaged. The true positives — selected x (100 - fp) —
 * are then remediated. False positives cost their triage credit and stop there.
 */
window.CxModel = {
  SEVERITIES: ['Critical', 'High', 'Medium', 'Low', 'Info'],

  /* Assumptions the team can override before exporting. The false-positive
   * defaults are typical AppSec figures, not measured values — replace them
   * with real triage history as soon as there is any. */
  DEFAULTS: {
    triageCredits: 1,
    remediationCredits: 3,
    falsePositive: { Critical: 15, High: 25, Medium: 40, Low: 60, Info: 90 },
    lookbackWeeks: 8,
    horizonWeeks: 52,
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

  clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
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

  /** Sum a per-severity frame across every severity. */
  rollup(frame) {
    const length = frame[CxModel.SEVERITIES[0]].length;
    const out = [];
    for (let i = 0; i < length; i++) {
      let total = 0;
      let known = false;
      for (const s of CxModel.SEVERITIES) {
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

  /**
   * The two headline rates, per severity and rolled up, averaged over the last
   * `lookbackWeeks` weeks.
   *
   *   debtRate  findings arriving each week
   *   fixRate   findings cleared each week
   *
   * Both are counts, never percentages of a moving base — a rate expressed
   * against a backlog that grew by two orders of magnitude is unreadable and
   * was the single biggest defect in the report this one replaces. The one
   * ratio that is safe to quote is fixRate / debtRate: how many of every
   * hundred arrivals the team actually clears.
   */
  stats(frames, lookbackWeeks) {
    const weeks = frames.weeks;
    const lastIndex = weeks.length - 1;
    const from = Math.max(1, weeks.length - (lookbackWeeks || CxModel.DEFAULTS.lookbackWeeks));

    const bySeverity = {};
    for (const s of CxModel.SEVERITIES) {
      const debtRate = CxModel.mean(frames.introduced[s].slice(from));
      const fixRate = CxModel.mean(frames.fixed[s].slice(from));
      bySeverity[s] = {
        severity: s,
        backlog: frames.open[s][lastIndex] ?? 0,
        debtRate,
        fixRate,
        netWeekly: debtRate - fixRate,
        keepUp: debtRate > 0 ? fixRate / debtRate : (fixRate > 0 ? 1 : 0),
      };
    }

    const roll = (key) => CxModel.sum(CxModel.SEVERITIES.map((s) => bySeverity[s][key]));
    const debtRate = roll('debtRate');
    const fixRate = roll('fixRate');

    return {
      bySeverity,
      weeksOfData: weeks.length,
      weeksUsed: weeks.length - from,
      firstWeek: weeks[0],
      lastWeek: weeks[lastIndex],
      total: {
        backlog: roll('backlog'),
        debtRate,
        fixRate,
        netWeekly: debtRate - fixRate,
        keepUp: debtRate > 0 ? fixRate / debtRate : (fixRate > 0 ? 1 : 0),
      },
    };
  },

  /* ----------------------------------------------------------------- plan -- */

  /** A starting plan: triage the whole backlog, at the default FP rates. */
  defaultPlan(stats, assumptions) {
    const plan = {};
    for (const s of CxModel.SEVERITIES) {
      plan[s] = {
        selected: Math.round(stats.bySeverity[s].backlog),
        fp: assumptions.falsePositive[s] ?? 0,
      };
    }
    return plan;
  },

  /** Keep a plan inside the backlog it is drawn from. */
  clampPlan(plan, stats) {
    const out = {};
    for (const s of CxModel.SEVERITIES) {
      const backlog = Math.round(stats.bySeverity[s].backlog);
      const row = plan[s] || { selected: 0, fp: 0 };
      out[s] = {
        selected: Math.round(CxModel.clamp(row.selected || 0, 0, backlog)),
        fp: Math.round(CxModel.clamp(row.fp || 0, 0, 100)),
      };
    }
    return out;
  },

  /* ----------------------------------------------------------------- cost -- */

  /**
   * The whole cost model, in six lines per severity:
   *
   *   triage       = selected x triageCredits
   *   truePositive = selected x (100 - fp) / 100
   *   remediation  = truePositive x remediationCredits
   *   total        = triage + remediation
   */
  cost(plan, stats, assumptions) {
    const rows = [];
    let count = 0;
    let truePositives = 0;
    let triage = 0;
    let remediation = 0;

    for (const s of CxModel.SEVERITIES) {
      const row = plan[s] || { selected: 0, fp: 0 };
      const backlog = Math.round(stats.bySeverity[s].backlog);
      const selected = Math.round(CxModel.clamp(row.selected || 0, 0, backlog));
      const fp = CxModel.clamp(row.fp || 0, 0, 100);
      const tpRate = (100 - fp) / 100;
      const tp = selected * tpRate;
      const triageCost = selected * assumptions.triageCredits;
      const remedCost = tp * assumptions.remediationCredits;

      rows.push({
        severity: s,
        backlog,
        selected,
        share: backlog > 0 ? selected / backlog : 0,
        fp,
        tpRate,
        truePositives: tp,
        falsePositives: selected - tp,
        triage: triageCost,
        remediation: remedCost,
        total: triageCost + remedCost,
        creditsEach: selected > 0 ? (triageCost + remedCost) / selected : 0,
        deferred: backlog - selected,
      });

      count += selected;
      truePositives += tp;
      triage += triageCost;
      remediation += remedCost;
    }

    return {
      rows,
      bySeverity: rows.reduce((acc, r) => { acc[r.severity] = r; return acc; }, {}),
      count,
      truePositives,
      falsePositives: count - truePositives,
      triage,
      remediation,
      total: triage + remediation,
      creditsEach: count > 0 ? (triage + remediation) / count : 0,
      backlog: CxModel.sum(rows.map((r) => r.backlog)),
      deferred: CxModel.sum(rows.map((r) => r.deferred)),
    };
  },

  /* ------------------------------------------------------------- forecast -- */

  /**
   * Two futures on one axis, both in open findings:
   *
   *   noAction  the backlog keeps taking the measured weekly arrivals
   *   withPlan  the same arrivals, minus the selected work as it is cleared at
   *             `pace` findings a week
   *
   * Arrivals do not stop because a plan started, so the two lines converge in
   * slope once the plan is finished. That gap is the point of the chart.
   */
  forecast(options) {
    const { backlog, debtRate, selected, pace, horizonWeeks, startWeek } = options;
    const arrivals = Math.max(0, debtRate);
    const weekly = Math.max(0, pace);
    const scope = Math.max(0, selected);

    const weeks = [{
      week: 0,
      date: startWeek || null,
      noAction: backlog,
      withPlan: backlog,
      cleared: 0,
      credits: 0,
    }];

    let clearedTotal = 0;
    let finishedWeek = null;
    for (let w = 1; w <= horizonWeeks; w++) {
      const clear = Math.min(weekly, Math.max(0, scope - clearedTotal));
      clearedTotal += clear;
      if (finishedWeek === null && clearedTotal >= scope - 0.5) finishedWeek = w;
      weeks.push({
        week: w,
        date: startWeek ? CxModel.addWeeks(startWeek, w) : null,
        noAction: backlog + arrivals * w,
        withPlan: Math.max(0, backlog + arrivals * w - clearedTotal),
        cleared: clearedTotal,
        weekCleared: clear,
      });
    }

    const last = weeks[weeks.length - 1];
    return {
      weeks,
      arrivals,
      pace: weekly,
      scope,
      weeksToFinishPlan: weekly > 0 ? scope / weekly : null,
      finishedWeek,
      netBurn: weekly - arrivals,
      weeksToZero: weekly > arrivals ? backlog / (weekly - arrivals) : null,
      paceToHold: arrivals,
      endNoAction: last.noAction,
      endWithPlan: last.withPlan,
      avoided: last.noAction - last.withPlan,
    };
  },

  /** Findings a week needed to clear `backlog` in `weeks`, arrivals included. */
  paceFor(backlog, debtRate, weeks) {
    if (!weeks || weeks <= 0) return Infinity;
    return backlog / weeks + Math.max(0, debtRate);
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
    if (weeks < 9) return `${Math.ceil(weeks)} weeks`;
    if (weeks < 105) return `${Math.round(weeks)} weeks (~${(weeks / 52).toFixed(1)} years)`;
    return `${(weeks / 52).toFixed(1)} years`;
  },
};
