/*
 * app.js — UI wiring for the Backlog Cost Calculator.
 *
 * Everything happens in the browser: the workbooks are read locally, the model
 * runs locally, and the exported report is assembled locally. No network call
 * is made at any point, which is what makes it safe to drop customer data in.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SEVERITIES = CxModel.SEVERITIES;
  const esc = CxCharts.esc;

  const state = {
    customer: '',
    preparedBy: '',
    logoDataUrl: null,
    totals: null,
    fixed: null,
    frames: null,
    plan: null,            // { severity: { selected, fp } } — null until data lands
    planTouched: false,
    assumptions: {
      triageCredits: CxModel.DEFAULTS.triageCredits,
      remediationCredits: CxModel.DEFAULTS.remediationCredits,
      falsePositive: Object.assign({}, CxModel.DEFAULTS.falsePositive),
    },
    lookback: CxModel.DEFAULTS.lookbackWeeks,
    horizon: CxModel.DEFAULTS.horizonWeeks,
    pace: null,            // null until the data can set a sensible default
    stats: null,
    cost: null,
    forecast: null,
  };

  /* ------------------------------------------------------------- utilities -- */

  const severityDot = (severity, colors) =>
    `<span class="sev-dot" style="background:${colors[severity]}"></span>`;

  const slug = (text) =>
    (text || 'customer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function showMessages(items) {
    $('input-messages').innerHTML = items
      .map((m) => `<div class="callout ${m.kind}">${m.text}</div>`).join('');
  }

  /* ------------------------------------------------------------ file intake -- */

  let pendingKind = null;

  async function ingest(file, kind) {
    const slot = kind === 'fixed' ? 'fixed' : 'totals';
    const zone = kind === 'fixed' ? $('drop-fixed') : $('drop-total');
    const label = kind === 'fixed' ? $('file-fixed') : $('file-total');
    label.textContent = `Reading ${file.name}…`;
    try {
      const sheets = await CxXlsx.readFile(file);
      const parsed = CxParse.parseWorkbook(sheets, file.name);
      state[slot] = parsed;
      state.planTouched = false;            // new data, new default plan
      zone.classList.add('is-loaded');
      label.innerHTML =
        `<span class="status">✓ ${esc(file.name)}</span><br>` +
        `${parsed.weeks.length} weeks, ${esc(parsed.weeks[0])} → ${esc(parsed.weeks[parsed.weeks.length - 1])}` +
        `<br><button type="button" class="ghost" data-clear="${kind}" style="margin-top:8px;padding:4px 10px;font-size:12px">Replace</button>`;
      label.querySelector('[data-clear]').addEventListener('click', (event) => {
        event.stopPropagation();
        clearSlot(kind);
      });
    } catch (error) {
      zone.classList.remove('is-loaded');
      label.textContent = 'Drop the .xlsx here, or click to choose';
      showMessages([{ kind: 'bad', text: esc(error.message) }]);
      return;
    }
    recompute();
  }

  function clearSlot(kind) {
    state[kind === 'fixed' ? 'fixed' : 'totals'] = null;
    state.planTouched = false;
    const zone = kind === 'fixed' ? $('drop-fixed') : $('drop-total');
    const label = kind === 'fixed' ? $('file-fixed') : $('file-total');
    zone.classList.remove('is-loaded');
    label.textContent = 'Drop the .xlsx here, or click to choose';
    recompute();
  }

  /** Route files by filename and content, so both can be dropped at once. */
  async function routeFiles(files, forcedKind) {
    const list = Array.from(files);
    for (const file of list) {
      let kind = list.length > 1 ? null : forcedKind;
      if (!kind) {
        let sheets = null;
        try { sheets = await CxXlsx.readFile(file); } catch (_) { /* fall back to the name */ }
        kind = CxParse.guessKind(file.name, sheets) || forcedKind || (state.totals ? 'fixed' : 'total');
      }
      await ingest(file, kind === 'fixed' ? 'fixed' : 'total');
    }
  }

  function wireDropzone(zone, kind) {
    const open = () => {
      if (zone.classList.contains('is-loaded')) return;
      pendingKind = kind;
      $('file-input').click();
    };
    zone.addEventListener('click', open);
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((type) =>
      zone.addEventListener(type, () => zone.classList.remove('is-over')));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      if (event.dataTransfer.files.length) routeFiles(event.dataTransfer.files, kind);
    });
  }

  async function loadSample() {
    const files = [
      ['samples/Total_Vulnerabilities_by_Severity.xlsx', 'total'],
      ['samples/Fixed_Vulnerabilities_by_Severity.xlsx', 'fixed'],
    ];
    try {
      for (const [path, kind] of files) {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${path} (${response.status})`);
        const blob = await response.blob();
        await ingest(new File([blob], path.split('/').pop()), kind);
      }
      if (!$('customer-name').value) $('customer-name').value = 'Sample Customer';
      recompute();
    } catch (error) {
      showMessages([{
        kind: 'warn',
        text: `Could not load the bundled sample (${esc(error.message)}). Opening index.html ` +
          'straight from disk blocks it — serve the folder with ' +
          '<code>python3 -m http.server</code>, or upload the two files by hand.',
      }]);
    }
  }

  /* ------------------------------------------------------------ computation -- */

  function dataMessages() {
    const items = [];
    for (const [slot, name] of [['totals', 'Total vulnerabilities'], ['fixed', 'Fixed vulnerabilities']]) {
      for (const warning of (state[slot] && state[slot].warnings) || []) {
        items.push({ kind: 'warn', text: `<strong>${name}:</strong> ${esc(warning)}` });
      }
    }
    if (!state.frames) return items;

    if (state.frames.missingTotals.length) {
      items.push({
        kind: 'warn',
        text: `${state.frames.missingTotals.length} week(s) appear only in the fixed export ` +
          `(${esc(state.frames.missingTotals.slice(0, 3).join(', '))}). They are charted but skipped in the rate averages.`,
      });
    }
    if (state.frames.missingFixed.length) {
      items.push({
        kind: 'warn',
        text: `${state.frames.missingFixed.length} week(s) appear only in the totals export ` +
          `(${esc(state.frames.missingFixed.slice(0, 3).join(', '))}).`,
      });
    }

    // A negative implied influx means more was closed than the backlog fell by:
    // usually a rescope, a deleted project, or mismatched filters between exports.
    const negatives = CxModel.rollup(state.frames.introduced).filter((v) => v !== null && v < 0).length;
    if (negatives) {
      items.push({
        kind: 'warn',
        text: `${negatives} week(s) imply a negative arrival rate — more findings were closed ` +
          'than the backlog fell by. That usually means projects left the scope, or the two ' +
          'exports were filtered differently. Compare the Filters tab of both files.',
      });
    }

    const provenance = [];
    for (const slot of ['totals', 'fixed']) {
      const meta = state[slot] && state[slot].meta;
      if (meta && meta.exportedAt) {
        provenance.push(`${slot === 'fixed' ? 'Fixed' : 'Totals'} exported ${esc(String(meta.exportedAt).slice(0, 10))}`);
      }
    }
    if (provenance.length) items.push({ kind: 'good', text: provenance.join(' · ') });
    return items;
  }

  function defaultPace() {
    const measured = Math.max(0, state.stats.total.fixRate);
    return measured > 0 ? Math.round(measured) : Math.max(1, Math.round(state.stats.total.backlog / 52));
  }

  function syncPaceSlider() {
    const selected = state.cost.count;
    const ceiling = Math.max(
      10, state.stats.total.debtRate * 2, state.stats.total.fixRate * 2, selected / 13, 1);
    const paceMax = Math.ceil(ceiling / 10) * 10;
    const input = $('pace');
    input.max = String(paceMax);
    input.step = String(Math.max(1, Math.round(paceMax / 200)));
    input.value = String(Math.min(state.pace, paceMax));
    state.pace = Number(input.value);
  }

  function recompute() {
    state.customer = $('customer-name').value.trim();
    state.preparedBy = $('prepared-by').value.trim();

    const ready = state.totals && state.fixed;
    $('results').classList.toggle('hidden', !ready);
    $('btn-export').disabled = !ready;

    if (!ready) { state.frames = null; showMessages(dataMessages()); return; }

    state.frames = CxModel.align(state.totals, state.fixed);
    showMessages(dataMessages());
    state.stats = CxModel.stats(state.frames, state.lookback);

    if (!state.plan || !state.planTouched) {
      state.plan = CxModel.defaultPlan(state.stats, state.assumptions);
    } else {
      state.plan = CxModel.clampPlan(state.plan, state.stats);
    }
    if (state.pace === null) state.pace = defaultPace();

    renderSevGrid();
    computePlan();
    renderHistory();

    $('horizon-out').textContent = String(state.horizon);
    $('lookback-out').textContent = String(state.lookback);
  }

  /** Everything downstream of the sliders — cheap enough to run on every drag. */
  function computePlan() {
    state.cost = CxModel.cost(state.plan, state.stats, state.assumptions);
    syncPaceSlider();
    state.forecast = CxModel.forecast({
      backlog: state.stats.total.backlog,
      debtRate: state.stats.total.debtRate,
      selected: state.cost.count,
      pace: state.pace,
      horizonWeeks: state.horizon,
      startWeek: state.stats.lastWeek,
    });

    renderCostKpis();
    renderCostTable();
    renderForecast();
    $('pace-out').textContent = CxModel.int(state.pace);
    $('pace-hint').textContent =
      `Measured pace is ${CxModel.int(state.stats.total.fixRate)}/week. ` +
      `${CxModel.int(state.stats.total.debtRate)}/week arrive, so anything below that loses ground.`;
  }

  /* ---------------------------------------------------------- plan sliders -- */

  function renderSevGrid() {
    const colors = CxBrand.severityColors();
    $('sev-grid').innerHTML = SEVERITIES.map((s) => {
      const backlog = Math.round(state.stats.bySeverity[s].backlog);
      const row = state.plan[s];
      return `<div class="sev-box">
        <div class="sev-head">
          ${severityDot(s, colors)}<strong>${s}</strong>
          <span class="sev-open">${CxModel.int(backlog)} open</span>
        </div>
        <div class="slider-row">
          <span>To triage</span><output data-sel-out="${s}">${CxModel.int(row.selected)}</output>
        </div>
        <input type="range" min="0" max="${backlog}" step="${Math.max(1, Math.round(backlog / 500))}"
               value="${row.selected}" data-sel="${s}" aria-label="Findings to triage for ${s}">
        <div class="slider-row">
          <span>Est. false positive %</span><output data-fp-out="${s}">${row.fp}%</output>
        </div>
        <input type="range" min="0" max="100" step="1" value="${row.fp}" data-fp="${s}"
               aria-label="False-positive rate for ${s}">
        <p class="sev-foot" data-cost-out="${s}"></p>
      </div>`;
    }).join('');

    $('sev-grid').querySelectorAll('input[data-sel]').forEach((slider) => {
      slider.addEventListener('input', () => {
        state.planTouched = true;
        state.plan[slider.dataset.sel].selected = Number(slider.value);
        $('sev-grid').querySelector(`[data-sel-out="${slider.dataset.sel}"]`).textContent =
          CxModel.int(Number(slider.value));
        computePlan();
      });
    });
    $('sev-grid').querySelectorAll('input[data-fp]').forEach((slider) => {
      slider.addEventListener('input', () => {
        state.planTouched = true;
        state.plan[slider.dataset.fp].fp = Number(slider.value);
        $('sev-grid').querySelector(`[data-fp-out="${slider.dataset.fp}"]`).textContent = `${slider.value}%`;
        computePlan();
      });
    });
  }

  /** Push plan values back into the sliders after a bulk change. */
  function syncSevGrid() {
    SEVERITIES.forEach((s) => {
      const row = state.plan[s];
      const sel = $('sev-grid').querySelector(`input[data-sel="${s}"]`);
      const fp = $('sev-grid').querySelector(`input[data-fp="${s}"]`);
      if (sel) { sel.value = String(row.selected); $('sev-grid').querySelector(`[data-sel-out="${s}"]`).textContent = CxModel.int(row.selected); }
      if (fp) { fp.value = String(row.fp); $('sev-grid').querySelector(`[data-fp-out="${s}"]`).textContent = `${row.fp}%`; }
    });
  }

  function setPlan(mutate) {
    state.planTouched = true;
    SEVERITIES.forEach((s) => mutate(s, state.plan[s], Math.round(state.stats.bySeverity[s].backlog)));
    state.plan = CxModel.clampPlan(state.plan, state.stats);
    syncSevGrid();
    computePlan();
  }

  /* ------------------------------------------------------ history rendering -- */

  function renderHistory() {
    const colors = CxBrand.severityColors();
    const flow = CxBrand.flowColors();
    const stats = state.stats;

    renderKpis(stats);
    renderHeadline(stats);
    renderBacklogChart(colors);
    renderFlowChart(flow);

    $('trend-sub').textContent =
      `${stats.weeksOfData} weeks of history, ${stats.firstWeek} → ${stats.lastWeek}.`;
  }

  function kpiCard(label, value, sub, tone) {
    return `<div class="kpi ${tone || ''}">
      <span class="label">${label}</span>
      <span class="value">${value}</span>
      <span class="sub">${sub}</span>
    </div>`;
  }

  function renderKpis(stats) {
    const t = stats.total;
    const losing = t.netWeekly > 0;
    $('kpis').innerHTML = [
      kpiCard('Open findings', CxModel.int(t.backlog), `as of ${stats.lastWeek}`),
      kpiCard('Debt rate', `${CxModel.int(t.debtRate)}/wk`,
        `new findings arriving, ${stats.weeksUsed}-week average`, 'bad'),
      kpiCard('Fix rate', `${CxModel.int(t.fixRate)}/wk`,
        `findings closed, ${stats.weeksUsed}-week average`, 'good'),
      kpiCard('Net movement', `${CxModel.signed(t.netWeekly)}/wk`,
        losing ? 'the backlog is growing' : 'the backlog is shrinking', losing ? 'bad' : 'good'),
    ].join('');
  }

  function renderHeadline(stats) {
    const t = stats.total;
    const perHundred = Math.round(t.keepUp * 100);
    const doubles = t.netWeekly > 0 ? t.backlog / t.netWeekly : null;
    $('headline').innerHTML = t.netWeekly > 0
      ? `For every <strong>100</strong> findings that arrive, the team clears <strong>${perHundred}</strong>. ` +
        `The backlog grows by <strong>${CxModel.int(t.netWeekly)}</strong> a week — it doubles in about ` +
        `<strong>${CxModel.weeksAsDuration(doubles)}</strong> if nothing changes.`
      : `The team clears <strong>${perHundred}</strong> of every 100 findings that arrive and is ` +
        `${CxModel.int(Math.abs(t.netWeekly))} a week ahead. The backlog is shrinking on its own.`;
  }

  function renderBacklogChart(colors) {
    const frames = state.frames;
    const labels = frames.weeks.map(CxCharts.shortDate);
    const series = SEVERITIES.slice().reverse().map((s) => ({
      key: s, color: colors[s], values: frames.open[s].map((v) => v ?? 0),
    }));
    const tips = frames.weeks.map((week, i) => {
      const rows = SEVERITIES.map((s) =>
        `<div class="t-row"><span>${s}</span><span>${CxModel.int(frames.open[s][i])}</span></div>`).join('');
      const total = CxModel.sum(SEVERITIES.map((s) => frames.open[s][i] || 0));
      return `<div class="t-title">${week}</div>${rows}` +
        `<div class="t-row t-total"><span>Open</span><span>${CxModel.int(total)}</span></div>`;
    });

    $('chart-backlog').innerHTML = CxCharts.stackedArea({
      id: 'backlog', labels, series, tipRows: tips,
    });
    $('legend-backlog').innerHTML = SEVERITIES.map((s) =>
      `<span class="item"><span class="swatch" style="background:${colors[s]}"></span>${s}</span>`).join('');

    const open = CxModel.rollup(frames.open);
    $('table-backlog').innerHTML = table(
      ['Week ending'].concat(SEVERITIES).concat(['Total open']),
      frames.weeks.map((week, i) =>
        [week].concat(SEVERITIES.map((s) => CxModel.int(frames.open[s][i]))).concat([CxModel.int(open[i])])));
  }

  function renderFlowChart(flow) {
    const frames = state.frames;
    const introduced = CxModel.rollup(frames.introduced);
    const cleared = CxModel.rollup(frames.fixed);
    const labels = frames.weeks.map(CxCharts.shortDate);

    const tips = frames.weeks.map((week, i) => {
      const arrived = introduced[i];
      const closed = cleared[i];
      const keepUp = arrived > 0 ? Math.round((closed / arrived) * 100) : null;
      return `<div class="t-title">${week}</div>` +
        `<div class="t-row"><span>Arrived</span><span>${CxModel.int(arrived)}</span></div>` +
        `<div class="t-row"><span>Closed</span><span>${CxModel.int(closed)}</span></div>` +
        `<div class="t-row t-total"><span>Net</span><span>${CxModel.signed(
          arrived === null || closed === null ? null : arrived - closed)}</span></div>` +
        (keepUp === null ? '' : `<div class="t-row"><span>Kept up with</span><span>${keepUp}%</span></div>`);
    });

    $('chart-flow').innerHTML = CxCharts.flow({
      id: 'flow',
      labels,
      groups: [
        { key: 'introduced', color: flow.introduced, values: introduced },
        { key: 'cleared', color: flow.cleared, values: cleared },
      ],
      tipRows: tips,
      height: 260,
    });
    $('legend-flow').innerHTML =
      `<span class="item"><span class="swatch" style="background:${flow.introduced}"></span>New findings (debt rate)</span>` +
      `<span class="item"><span class="swatch" style="background:${flow.cleared}"></span>Findings closed (fix rate)</span>`;

    $('table-flow').innerHTML = table(
      ['Week ending', 'Arrived', 'Closed', 'Net', 'Kept up with'],
      frames.weeks.map((week, i) => {
        const arrived = introduced[i];
        const closed = cleared[i];
        return [
          week, CxModel.int(arrived), CxModel.int(closed),
          CxModel.signed(arrived === null || closed === null ? null : arrived - closed),
          arrived > 0 ? `${Math.round((closed / arrived) * 100)}%` : '—',
        ];
      }));
  }

  /* --------------------------------------------------------- cost rendering -- */

  function renderCostKpis() {
    const cost = state.cost;
    const f = state.forecast;
    const finish = f.weeksToFinishPlan;
    $('cost-kpis').innerHTML = [
      kpiCard('Total cost', `${CxModel.int(cost.total)} cr`,
        `${CxModel.int(cost.count)} findings selected · ${cost.creditsEach.toFixed(2)} credits each`),
      kpiCard('Triage / remediation', `${CxModel.compact(cost.triage)} / ${CxModel.compact(cost.remediation)}`,
        `${CxModel.int(cost.truePositives)} true positives need a fix, ${CxModel.int(cost.falsePositives)} do not`),
      kpiCard('Time to work through it',
        cost.count > 0 ? CxModel.weeksAsDuration(finish) : '—',
        cost.count > 0 ? `at ${CxModel.int(state.pace)} findings a week` : 'nothing selected yet'),
    ].join('');

    const colors = CxBrand.severityColors();
    cost.rows.forEach((row) => {
      const foot = $('sev-grid') && $('sev-grid').querySelector(`[data-cost-out="${row.severity}"]`);
      if (!foot) return;
      foot.innerHTML = row.selected === 0
        ? 'Not in the plan — no credits.'
        : `<strong>${CxModel.int(row.total)} credits</strong> · ${CxModel.int(row.truePositives)} to fix` +
          (row.deferred > 0 ? ` · ${CxModel.int(row.deferred)} left open` : '');
      foot.style.borderTopColor = colors[row.severity];
    });
  }

  function renderCostTable() {
    const cost = state.cost;
    const colors = CxBrand.severityColors();
    const head = ['Severity', 'Open', 'To triage', 'FP %', 'True positives',
      'Triage credits', 'Remediation credits', 'Total credits'];
    const rows = cost.rows.map((r) => [
      `${severityDot(r.severity, colors)}${r.severity}`,
      CxModel.int(r.backlog), CxModel.int(r.selected), `${Math.round(r.fp)}%`,
      CxModel.int(r.truePositives), CxModel.int(r.triage), CxModel.int(r.remediation),
      `<strong>${CxModel.int(r.total)}</strong>`,
    ]);
    const foot = ['Total', CxModel.int(cost.backlog), CxModel.int(cost.count),
      cost.count > 0 ? `${Math.round((cost.falsePositives / cost.count) * 100)}%` : '—',
      CxModel.int(cost.truePositives), CxModel.int(cost.triage), CxModel.int(cost.remediation),
      `<strong>${CxModel.int(cost.total)}</strong>`];
    $('table-cost').innerHTML = table(head, rows, foot);
  }

  function renderForecast() {
    const f = state.forecast;
    const scenario = CxBrand.scenarioColors();
    const labels = f.weeks.map((w) => CxCharts.shortDate(w.date));
    const series = [
      { key: 'nothing', color: scenario.nothing, dashed: true,
        values: f.weeks.map((w) => w.noAction), endLabel: CxModel.compact(f.endNoAction) },
      { key: 'plan', color: scenario.target,
        values: f.weeks.map((w) => w.withPlan), endLabel: CxModel.compact(f.endWithPlan) },
    ];
    const tips = f.weeks.map((w) =>
      `<div class="t-title">Week ${w.week} — ${CxCharts.shortDate(w.date)}</div>` +
      `<div class="t-row"><span>Do nothing</span><span>${CxModel.int(w.noAction)}</span></div>` +
      `<div class="t-row"><span>With this plan</span><span>${CxModel.int(w.withPlan)}</span></div>` +
      `<div class="t-row t-total"><span>Difference</span><span>${CxModel.int(w.noAction - w.withPlan)}</span></div>`);

    $('chart-forecast').innerHTML = CxCharts.lines({
      id: 'forecast', labels, series, tipRows: tips, height: 280,
    });
    $('legend-forecast').innerHTML =
      `<span class="item"><span class="swatch line" style="background:${scenario.nothing}"></span>Do nothing</span>` +
      `<span class="item"><span class="swatch line" style="background:${scenario.target}"></span>This plan at ${CxModel.int(state.pace)}/week</span>`;

    $('forecast-sub').textContent =
      `Both futures take the same ${CxModel.int(f.arrivals)} new findings a week. Only the pace differs.`;

    if (f.scope <= 0) {
      $('forecast-note').innerHTML =
        'Nothing is selected, so this plan costs nothing and moves nothing — the backlog keeps taking ' +
        `<strong>${CxModel.int(f.arrivals)}</strong> new findings a week. Move a slider above to build a plan.`;
      return;
    }

    const holds = f.pace >= f.arrivals;
    $('forecast-note').innerHTML =
      `<strong>${CxModel.int(f.pace)} findings a week</strong> works through the ` +
      `${CxModel.int(f.scope)} selected in <strong>${CxModel.weeksAsDuration(f.weeksToFinishPlan)}</strong>, ` +
      `for ${CxModel.int(state.cost.total)} credits. ` +
      (holds
        ? `That also outruns the ${CxModel.int(f.arrivals)} arriving each week, so the whole backlog reaches zero in ` +
          `<strong>${CxModel.weeksAsDuration(f.weeksToZero)}</strong>.`
        : `It does not keep up with the ${CxModel.int(f.arrivals)} arriving each week, so the backlog still grows: ` +
          `sustaining <strong>${CxModel.int(f.paceToHold)}/week</strong> is what holds the line, and anything above ` +
          'that starts killing the debt.');
  }

  /* -------------------------------------------------------------- table -- */

  function table(head, rows, foot) {
    return `<table class="data"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
      `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>` +
      (foot ? `<tfoot><tr>${foot.map((c) => `<td>${c}</td>`).join('')}</tr></tfoot>` : '') +
      '</table>';
  }

  /* ----------------------------------------------------------------- export -- */

  function exportContext() {
    return {
      customer: state.customer,
      preparedBy: state.preparedBy,
      logoDataUrl: state.logoDataUrl,
      title: $('report-title').value.trim() || 'Security debt: the cost to clear it',
      validity: $('report-validity').value.trim(),
      generatedAt: new Date().toISOString(),
      frames: state.frames,
      plan: state.plan,
      assumptions: state.assumptions,
      lookback: state.lookback,
      horizon: state.horizon,
      pace: state.pace,
      palette: {
        severity: CxBrand.severity,
        flow: CxBrand.flow,
        scenario: CxBrand.scenario,
      },
      provenance: { totals: state.totals.meta, fixed: state.fixed.meta },
    };
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function doExport() {
    download(`checkmarx-backlog-cost-${slug(state.customer)}.html`,
      CxReport.build(exportContext()), 'text/html;charset=utf-8');
  }

  function doCsv() {
    const frames = state.frames;
    const introduced = CxModel.rollup(frames.introduced);
    const cleared = CxModel.rollup(frames.fixed);
    const open = CxModel.rollup(frames.open);
    const header = ['week_ending']
      .concat(SEVERITIES.map((s) => `open_${s.toLowerCase()}`))
      .concat(SEVERITIES.map((s) => `fixed_${s.toLowerCase()}`))
      .concat(['open_total', 'introduced_total', 'closed_total', 'net_total']);

    const lines = frames.weeks.map((week, i) => [week]
      .concat(SEVERITIES.map((s) => frames.open[s][i] ?? ''))
      .concat(SEVERITIES.map((s) => frames.fixed[s][i] ?? ''))
      .concat([
        open[i] ?? '',
        introduced[i] ?? '',
        cleared[i] ?? '',
        introduced[i] === null || cleared[i] === null ? '' : introduced[i] - cleared[i],
      ]).join(','));

    download(`checkmarx-backlog-${slug(state.customer)}.csv`,
      [header.join(','), ...lines].join('\n'), 'text/csv;charset=utf-8');
  }

  /* ------------------------------------------------------------------ wiring -- */

  function wire() {
    $('brandmark').innerHTML = CxBrand.logoSvg(28);

    wireDropzone($('drop-total'), 'total');
    wireDropzone($('drop-fixed'), 'fixed');

    $('file-input').addEventListener('change', (event) => {
      if (event.target.files.length) routeFiles(event.target.files, pendingKind);
      event.target.value = '';
    });

    $('logo-file').addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.logoDataUrl = reader.result;
        $('brandmark').innerHTML = `<img src="${state.logoDataUrl}" alt="${esc(state.customer || 'Logo')}">`;
      };
      reader.readAsDataURL(file);
    });

    ['customer-name', 'prepared-by'].forEach((id) =>
      $(id).addEventListener('input', () => { if (state.frames) recompute(); }));

    $('rate-triage').addEventListener('input', () => {
      state.assumptions.triageCredits = Math.max(0, Number($('rate-triage').value) || 0);
      if (state.frames) computePlan();
    });
    $('rate-remediation').addEventListener('input', () => {
      state.assumptions.remediationCredits = Math.max(0, Number($('rate-remediation').value) || 0);
      if (state.frames) computePlan();
    });
    $('lookback').addEventListener('input', () => {
      state.lookback = Number($('lookback').value);
      if (state.frames) recompute();
    });
    $('pace').addEventListener('input', () => {
      state.pace = Number($('pace').value);
      if (state.frames) computePlan();
    });
    $('horizon').addEventListener('input', () => {
      state.horizon = Number($('horizon').value);
      $('horizon-out').textContent = String(state.horizon);
      if (state.frames) computePlan();
    });

    $('fp-all').addEventListener('input', () => {
      const value = Number($('fp-all').value);
      $('fp-all-out').textContent = `${value}%`;
      if (!state.frames) return;
      setPlan((s, row) => { row.fp = value; });
    });

    $('btn-all').addEventListener('click', () => {
      if (state.frames) setPlan((s, row, backlog) => { row.selected = backlog; });
    });
    $('btn-none').addEventListener('click', () => {
      if (state.frames) setPlan((s, row) => { row.selected = 0; });
    });
    $('btn-critical-high').addEventListener('click', () => {
      if (state.frames) setPlan((s, row, backlog) => {
        row.selected = (s === 'Critical' || s === 'High') ? backlog : 0;
      });
    });
    $('btn-reset').addEventListener('click', () => {
      if (!state.frames) return;
      state.plan = CxModel.defaultPlan(state.stats, state.assumptions);
      state.planTouched = false;
      syncSevGrid();
      computePlan();
    });

    $('btn-sample').addEventListener('click', loadSample);
    $('btn-export').addEventListener('click', doExport);
    $('btn-export-2').addEventListener('click', doExport);
    $('btn-csv').addEventListener('click', doCsv);

    $('btn-theme').addEventListener('click', () => {
      const next = CxBrand.currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cx-theme', next); } catch (_) { /* private mode */ }
      if (state.frames) { renderSevGrid(); computePlan(); renderHistory(); }
    });
    CxBrand.onThemeChange(() => {
      if (state.frames) { renderSevGrid(); computePlan(); renderHistory(); }
    });

    try {
      const saved = localStorage.getItem('cx-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (_) { /* private mode */ }

    CxCharts.bind(document);
  }

  wire();
})();
