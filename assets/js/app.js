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
    modes: Object.assign({}, CxModel.DEFAULTS.modes),
    assumptions: {
      triageCredits: CxModel.DEFAULTS.triageCredits,
      remediationCredits: CxModel.DEFAULTS.remediationCredits,
      truePositiveRate: Object.assign({}, CxModel.DEFAULTS.truePositiveRate),
    },
    lookback: CxModel.DEFAULTS.lookbackWeeks,
    horizon: CxModel.DEFAULTS.horizonWeeks,
    pace: null,            // null until the data can set a sensible default
    deadlineWeeks: 26,
    creditPrice: null,
    stats: null,
    scenarios: null,
    forecast: null,
  };

  /* ------------------------------------------------------------- utilities -- */

  const money = (credits) => {
    if (!state.creditPrice || !isFinite(credits)) return null;
    return (credits * state.creditPrice)
      .toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  };

  const severityDot = (severity, colors) =>
    `<span class="sev-dot" style="background:${colors[severity]}"></span>`;

  const slug = (text) =>
    (text || 'customer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function showMessages(items) {
    $('input-messages').innerHTML = items
      .map((m) => `<div class="callout ${m.kind}">${m.text}</div>`).join('');
  }

  /* ---------------------------------------------------------------- inputs -- */

  function renderModeControls() {
    const colors = CxBrand.severityColors();
    const counts = state.stats ? state.stats.bySeverity : null;

    $('scope-modes').innerHTML = SEVERITIES.map((s) => {
      const mode = state.modes[s];
      const open = counts ? `${CxModel.int(counts[s].backlog)} open` : '';
      return `<div class="mode-row">
        <span class="name">${severityDot(s, colors)}${s}<span class="hint">${open}</span></span>
        <div class="segmented" role="group" aria-label="Plan for ${s}">
          ${CxModel.MODES.map((m) => `<button type="button" data-severity="${s}" data-mode="${m}"
             class="${mode === m ? 'is-on' : ''}" aria-pressed="${mode === m}">${CxModel.MODE_LABEL[m]}</button>`).join('')}
        </div>
      </div>`;
    }).join('');

    $('scope-modes').querySelectorAll('button[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.modes[button.dataset.severity] = button.dataset.mode;
        state.pace = null;                 // let the pace re-default to the new plan
        renderModeControls();
        recompute();
      });
    });
  }

  function renderTruePositiveRows() {
    const colors = CxBrand.severityColors();
    $('tp-rows').innerHTML = SEVERITIES.map((s) => {
      const value = Math.round(state.assumptions.truePositiveRate[s] * 100);
      return `<div class="assumption-row">
        <span class="name">${severityDot(s, colors)}${s}</span>
        <input type="range" min="0" max="100" step="1" value="${value}" data-tp="${s}"
               aria-label="True-positive rate for ${s}">
        <output data-tp-out="${s}">${value}%</output>
      </div>`;
    }).join('');

    $('tp-rows').querySelectorAll('input[data-tp]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const severity = slider.dataset.tp;
        state.assumptions.truePositiveRate[severity] = Number(slider.value) / 100;
        $('tp-rows').querySelector(`[data-tp-out="${severity}"]`).textContent = `${slider.value}%`;
        if (state.frames) recompute();
      });
    });
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
    const negatives = CxModel.scoped(state.frames.introduced, state.modes)
      .filter((v) => v !== null && v < 0).length;
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
    const current = Math.max(0, state.stats.scope.avgFixed);
    return current > 0 ? Math.round(current) : Math.max(1, Math.round(state.stats.scope.backlog / 52));
  }

  function recompute() {
    state.customer = $('customer-name').value.trim();
    state.preparedBy = $('prepared-by').value.trim();

    const ready = state.totals && state.fixed;
    $('card-assumptions').classList.toggle('hidden', !ready);
    $('results').classList.toggle('hidden', !ready);
    $('btn-export').disabled = !ready;

    if (!ready) { state.frames = null; showMessages(dataMessages()); return; }

    state.frames = CxModel.align(state.totals, state.fixed);
    showMessages(dataMessages());

    state.stats = CxModel.stats(state.frames, state.modes, state.lookback);
    if (state.pace === null) state.pace = defaultPace();

    const totalInflux = Math.max(0, state.stats.scope.avgIntroduced);
    const required = CxModel.requiredProcessing(state.stats.scope.backlog, totalInflux, state.deadlineWeeks);

    // Keep the pace slider useful: top out above whatever the deadline demands.
    const paceMax = Math.max(10, Math.ceil(Math.max(required, state.stats.scope.avgFixed * 2, 1) / 10) * 10);
    const paceInput = $('pace');
    paceInput.max = String(paceMax);
    paceInput.step = String(Math.max(1, Math.round(paceMax / 200)));
    paceInput.value = String(Math.min(state.pace, paceMax));
    state.pace = Number(paceInput.value);

    state.scenarios = CxModel.scenarios(state.stats, state.modes, state.assumptions, {
      horizonWeeks: state.horizon,
      allocation: CxModel.DEFAULTS.allocation,
      startWeek: state.stats.lastWeek,
      targetWeeks: state.deadlineWeeks,
      targetProcessing: state.pace,
      targetLabel: 'Chosen pace',
    });
    state.forecast = state.scenarios.find((s) => s.id === 'target').result;

    render();
  }

  /* ------------------------------------------------------------- rendering -- */

  function render() {
    const colors = CxBrand.severityColors();
    const flow = CxBrand.flowColors();
    const scenarioColors = CxBrand.scenarioColors();
    const stats = state.stats;

    renderModeCounts();
    renderKpis(stats);
    renderHeadline(stats);
    renderBacklogChart(colors);
    renderFlowChart(flow);
    renderScenarioChart(scenarioColors);
    renderProjectionChart(colors);
    renderCost(colors);
    renderSpendChart(flow);
    renderBudget();

    $('pace-out').textContent = CxModel.int(state.pace);
    $('horizon-out').textContent = String(state.horizon);
    $('lookback-out').textContent = String(state.lookback);

    const required = CxModel.requiredProcessing(
      stats.scope.backlog, Math.max(0, stats.scope.avgIntroduced), state.deadlineWeeks);
    $('deadline-hint').textContent = `Needs ${CxModel.int(required)} findings worked through per week.`;
    $('pace-hint').textContent =
      `Measured pace is ${CxModel.int(stats.scope.avgFixed)}/week; ` +
      `${CxModel.int(Math.max(0, stats.scope.avgIntroduced))}/week arrive.`;
    $('trend-sub').textContent =
      `${stats.weeksOfData} weeks of history, ${stats.firstWeek} → ${stats.lastWeek}.`;
    $('projection-sub').textContent =
      `Working through ${CxModel.int(state.pace)} findings a week for ${state.horizon} weeks.`;

    CxCharts.bind(document);
  }

  /** Refresh only the open-count hints on the mode rows, without rebuilding them. */
  function renderModeCounts() {
    $('scope-modes').querySelectorAll('.mode-row').forEach((row, i) => {
      const hint = row.querySelector('.name .hint');
      if (hint) hint.textContent = `${CxModel.int(state.stats.bySeverity[SEVERITIES[i]].backlog)} open`;
    });
  }

  const trendClass = (value) => (Math.abs(value) < 1 ? 'flat' : (value > 0 ? 'up' : 'down'));

  function renderKpis(stats) {
    const net = stats.scope.netWeekly;
    const doubling = stats.scope.backlog > 0 && net < 0 ? stats.scope.backlog / -net : null;

    $('kpis').innerHTML = `
      <div class="kpi accent">
        <div class="label">Open findings in the plan</div>
        <div class="value">${CxModel.compact(stats.scope.backlog)}</div>
        <div class="note">${CxModel.int(stats.scope.backlog)} as of ${stats.lastWeek}</div>
      </div>
      <div class="kpi">
        <div class="label">Arriving each week</div>
        <div class="value">${CxModel.compact(Math.max(0, stats.scope.avgIntroduced))}</div>
        <div class="note">${state.lookback}-week average</div>
      </div>
      <div class="kpi">
        <div class="label">Closed each week</div>
        <div class="value">${CxModel.compact(stats.scope.avgFixed)}</div>
        <div class="note">${state.lookback}-week average</div>
      </div>
      <div class="kpi">
        <div class="label">Net movement</div>
        <div class="value small trend ${trendClass(-net)}">${CxModel.signed(-net)}/week</div>
        <div class="note">${net > 0
          ? `Shrinking — clear in ${CxModel.weeksAsDuration(stats.scope.backlog / net)} at this rate.`
          : (doubling ? `Growing — it doubles in ${CxModel.weeksAsDuration(doubling)}.` : 'Holding steady.')}</div>
      </div>`;
  }

  function currentBacklogCost() {
    const counts = {};
    for (const s of SEVERITIES) counts[s] = state.stats.bySeverity[s].backlog;
    return CxModel.cost(counts, state.assumptions, state.modes);
  }

  function renderHeadline(stats) {
    const cost = currentBacklogCost();
    const net = stats.scope.netWeekly;
    const who = state.customer ? `<b>${esc(state.customer)}</b>` : 'This tenant';
    const direction = net > 0
      ? `fixes are outpacing arrivals by <b>${CxModel.int(net)} a week</b>, so the backlog is shrinking`
      : `arrivals are outpacing fixes by <b>${CxModel.int(-net)} a week</b>, so the backlog keeps growing ` +
        `even while ${CxModel.int(stats.scope.avgFixed)} a week are closed`;
    const priced = money(cost.total);
    const leftInPlace = cost.leftInPlace > 1
      ? ` ${CxModel.int(cost.leftInPlace)} true positives stay on the books by design, in the severities set to triage only.`
      : '';

    $('headline').innerHTML =
      `${who} is carrying <b>${CxModel.int(stats.scope.backlog)}</b> open findings in the severities the plan covers. ` +
      `Over the last ${state.lookback} weeks ${direction}. ` +
      `Working through what is on the books today costs <b>${CxModel.int(cost.total)} Checkmarx credits</b>` +
      (priced ? ` (about <b>${priced}</b>)` : '') +
      ` — ${CxModel.int(cost.triage)} to triage every finding and ${CxModel.int(cost.remediation)} to remediate the ` +
      `${CxModel.int(cost.truePositives)} expected to be real.${leftInPlace}`;
  }

  /* --- backlog trend + projection ------------------------------------------ */

  function renderBacklogChart(colors) {
    const frames = state.frames;
    const history = frames.weeks;
    const forecastWeeks = state.forecast.weeks;
    const labels = history.concat(forecastWeeks.map((w) => w.date));
    const inScope = CxModel.scopeList(state.modes);

    const series = inScope.map((s) => ({
      key: s, label: s, color: colors[s],
      values: frames.open[s].map((v) => v || 0).concat(forecastWeeks.map((w) => w.open[s] || 0)),
    }));

    const tips = labels.map((week, i) => {
      const rows = series.map((s) =>
        `<div class="t-row"><span><span class="t-dot" style="background:${s.color}"></span>${s.label}</span><span>${CxModel.int(s.values[i])}</span></div>`);
      const total = series.reduce((a, s) => a + s.values[i], 0);
      return `<div class="t-title">${i < history.length ? 'Week ending ' : 'Projected '}${CxCharts.shortDate(week)}</div>` +
        rows.join('') +
        `<div class="t-row t-total"><span>Total</span><span>${CxModel.int(total)}</span></div>`;
    });

    $('chart-backlog').innerHTML = CxCharts.stackedArea({
      id: 'backlog',
      labels: labels.map(CxCharts.shortDate),
      series,
      splitAt: history.length - 1,
      tipRows: tips,
      height: 320,
    });
    $('legend-backlog').innerHTML = series.map((s) =>
      `<span class="item"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`).join('') +
      `<span class="item"><span class="swatch" style="background:var(--brand);opacity:.25"></span>Projection at ${CxModel.int(state.pace)}/week</span>`;

    $('table-backlog').innerHTML = weeklyBacklogTable(colors);
  }

  function weeklyBacklogTable(colors) {
    const frames = state.frames;
    const scoped = CxModel.scoped(frames.open, state.modes);
    const rows = frames.weeks.map((week, i) =>
      `<tr><td>${week}</td>` +
      SEVERITIES.map((s) => `<td>${CxModel.int(frames.open[s][i])}</td>`).join('') +
      `<td>${CxModel.int(scoped[i])}</td></tr>`);
    return '<table><thead><tr><th>Week ending</th>' +
      SEVERITIES.map((s) => `<th>${severityDot(s, colors)}${s}</th>`).join('') +
      '<th>In plan</th></tr></thead>' +
      `<tbody>${rows.join('')}</tbody></table>`;
  }

  /* --- weekly flow --------------------------------------------------------- */

  function renderFlowChart(flow) {
    const frames = state.frames;
    const introduced = CxModel.scoped(frames.introduced, state.modes);
    const cleared = CxModel.scoped(frames.fixed, state.modes);
    const net = introduced.map((v, i) => (v === null || cleared[i] === null ? null : cleared[i] - v));

    const tips = frames.weeks.map((week, i) =>
      `<div class="t-title">Week ending ${CxCharts.shortDate(week)}</div>` +
      `<div class="t-row"><span><span class="t-dot" style="background:${flow.introduced}"></span>New findings</span><span>${CxModel.int(introduced[i])}</span></div>` +
      `<div class="t-row"><span><span class="t-dot" style="background:${flow.cleared}"></span>Closed</span><span>${CxModel.int(cleared[i])}</span></div>` +
      `<div class="t-row t-total"><span>Net</span><span>${CxModel.signed(net[i])}</span></div>`);

    $('chart-flow').innerHTML = CxCharts.flow({
      id: 'flow',
      labels: frames.weeks.map(CxCharts.shortDate),
      groups: [
        { label: 'New findings', color: flow.introduced, values: introduced },
        { label: 'Closed', color: flow.cleared, values: cleared },
      ],
      line: { label: 'Net', color: flow.backlog, values: net },
      tipRows: tips,
      height: 300,
    });
    $('legend-flow').innerHTML =
      `<span class="item"><span class="swatch" style="background:${flow.introduced}"></span>New findings arriving</span>` +
      `<span class="item"><span class="swatch" style="background:${flow.cleared}"></span>Findings closed</span>` +
      `<span class="item"><span class="swatch line" style="background:${flow.backlog}"></span>Net — above zero means the backlog shrank</span>`;

    const open = CxModel.scoped(frames.open, state.modes);
    $('table-flow').innerHTML =
      '<table><thead><tr><th>Week ending</th><th>New</th><th>Closed</th><th>Net</th><th>Backlog</th></tr></thead><tbody>' +
      frames.weeks.map((week, i) =>
        `<tr><td>${week}</td><td>${CxModel.int(introduced[i])}</td><td>${CxModel.int(cleared[i])}</td>` +
        `<td class="trend ${trendClass(-(net[i] || 0))}">${CxModel.signed(net[i])}</td>` +
        `<td>${CxModel.int(open[i])}</td></tr>`).join('') +
      '</tbody></table>';
  }

  /* --- scenarios ----------------------------------------------------------- */

  function renderScenarioChart(scenarioColors) {
    const scenarios = state.scenarios;
    const labels = scenarios[0].result.weeks.map((w) => w.date);
    const series = scenarios.map((sc) => ({
      key: sc.id,
      color: scenarioColors[sc.id],
      values: sc.result.weeks.map((w) => w.remaining),
      endLabel: CxModel.compact(sc.result.endTotal),
      dashed: sc.id === 'nothing',
    }));

    const tips = labels.map((week, i) =>
      `<div class="t-title">${CxCharts.shortDate(week)} — week ${i + 1}</div>` +
      scenarios.map((sc, k) =>
        `<div class="t-row"><span><span class="t-dot" style="background:${series[k].color}"></span>${esc(sc.name)}</span><span>${CxModel.int(series[k].values[i])}</span></div>`).join(''));

    $('chart-scenarios').innerHTML = CxCharts.lines({
      id: 'scenarios', labels: labels.map(CxCharts.shortDate), series, tipRows: tips, yZero: true, height: 300,
    });
    $('legend-scenarios').innerHTML = scenarios.map((sc, k) =>
      `<span class="item"><span class="swatch line" style="background:${series[k].color}"></span>${esc(sc.name)}</span>`).join('');

    const priced = state.creditPrice;
    $('table-scenarios').innerHTML =
      '<table><thead><tr><th>Scenario</th><th>Findings / week</th>' +
      `<th>Backlog after ${state.horizon}w</th><th>Reaches zero in</th><th>Credits over ${state.horizon}w</th>` +
      (priced ? '<th>Approx. value</th>' : '') + '</tr></thead><tbody>' +
      scenarios.map((sc) => `<tr>
        <td>${esc(sc.name)}<div class="hint">${esc(sc.note)}</div></td>
        <td>${CxModel.int(sc.processing)}</td>
        <td>${CxModel.int(sc.result.endTotal)}</td>
        <td>${CxModel.weeksAsDuration(sc.result.weeksToZero)}</td>
        <td>${CxModel.int(sc.result.totalCredits)}</td>
        ${priced ? `<td>${money(sc.result.totalCredits) || '—'}</td>` : ''}
      </tr>`).join('') + '</tbody></table>' +
      (state.forecast.neverZeroReason
        ? `<p class="hint" style="margin-top:8px">Zero is out of reach while ${esc(state.forecast.neverZeroReason)}.</p>`
        : '');
  }

  /* --- projection by severity ---------------------------------------------- */

  function renderProjectionChart(colors) {
    const weeks = state.forecast.weeks;
    const inScope = CxModel.scopeList(state.modes);
    const labels = weeks.map((w) => w.date);
    const series = inScope.map((s) => ({
      key: s, label: s, color: colors[s], values: weeks.map((w) => w.open[s] || 0),
    }));

    const tips = labels.map((week, i) =>
      `<div class="t-title">Week ${i + 1} — ${CxCharts.shortDate(week)}</div>` +
      series.map((s) =>
        `<div class="t-row"><span><span class="t-dot" style="background:${s.color}"></span>${s.label}</span><span>${CxModel.int(s.values[i])}</span></div>`).join('') +
      `<div class="t-row t-total"><span>Credits spent to date</span><span>${CxModel.int(weeks[i].cumulativeCredits)}</span></div>`);

    $('chart-projection').innerHTML = CxCharts.stackedArea({
      id: 'projection', labels: labels.map(CxCharts.shortDate), series, tipRows: tips, height: 280,
    });
    $('legend-projection').innerHTML = series.map((s) =>
      `<span class="item"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`).join('') +
      '<span class="item">Worst first: Critical is worked before High, and so on down.</span>';
  }

  /* --- cost ---------------------------------------------------------------- */

  function renderCost(colors) {
    const cost = currentBacklogCost();
    const stats = state.stats;

    const influxCounts = {};
    for (const s of SEVERITIES) influxCounts[s] = Math.max(0, stats.bySeverity[s].avgIntroduced);
    const runRate = CxModel.cost(influxCounts, state.assumptions, state.modes);
    const horizonCredits = state.forecast.totalCredits;

    const priceNote = (credits) => {
      const value = money(credits);
      return value ? `<div class="note">${value}</div>` : '';
    };

    $('cost-kpis').innerHTML = `
      <div class="kpi accent">
        <div class="label">Clear today's backlog</div>
        <div class="value">${CxModel.compact(cost.total)}</div>
        <div class="note">credits, one off</div>
        ${priceNote(cost.total)}
      </div>
      <div class="kpi">
        <div class="label">Keep up with new arrivals</div>
        <div class="value">${CxModel.compact(runRate.total)}</div>
        <div class="note">credits per week · ${CxModel.compact(runRate.total * 52)} a year</div>
      </div>
      <div class="kpi">
        <div class="label">Spend over ${state.horizon} weeks at the chosen pace</div>
        <div class="value">${CxModel.compact(horizonCredits)}</div>
        <div class="note">backlog and new arrivals combined</div>
        ${priceNote(horizonCredits)}
      </div>
      <div class="kpi">
        <div class="label">Blended cost per finding</div>
        <div class="value">${cost.blendedCreditsEach.toFixed(2)}</div>
        <div class="note">${state.assumptions.triageCredits} triage + ${state.assumptions.remediationCredits} × true-positive rate</div>
      </div>`;

    const rows = CxModel.scopeList(state.modes).map((s) => ({
      label: s,
      color: colors[s],
      count: cost.bySeverity[s].count,
      triage: cost.bySeverity[s].triage,
      remediation: cost.bySeverity[s].remediation,
      total: cost.bySeverity[s].total,
    }));

    $('chart-cost').innerHTML = CxCharts.costBars({ rows });
    $('legend-cost').innerHTML =
      '<span class="item"><span class="swatch" style="background:var(--muted);opacity:.45"></span>Triage — every finding</span>' +
      '<span class="item"><span class="swatch" style="background:var(--muted)"></span>Remediation — true positives only</span>';

    const priced = state.creditPrice;
    $('table-cost').innerHTML =
      '<table><thead><tr><th>Severity</th><th>Plan</th><th>Open</th><th>True positive %</th><th>Expected real</th>' +
      '<th>Triage credits</th><th>Remediation credits</th><th>Credits each</th><th>Total credits</th>' +
      (priced ? '<th>Approx. value</th>' : '') + '</tr></thead><tbody>' +
      SEVERITIES.map((s) => {
        const row = cost.bySeverity[s];
        const off = row.mode === 'none';
        return `<tr${off ? ' style="opacity:.45"' : ''}>
          <td>${severityDot(s, colors)}${s}</td>
          <td>${CxModel.MODE_LABEL[row.mode]}</td>
          <td>${CxModel.int(stats.bySeverity[s].backlog)}</td>
          <td>${CxModel.pct(state.assumptions.truePositiveRate[s])}</td>
          <td>${CxModel.int(row.truePositives)}</td>
          <td>${CxModel.int(row.triage)}</td>
          <td>${CxModel.int(row.remediation)}</td>
          <td>${row.creditsEach.toFixed(2)}</td>
          <td>${CxModel.int(row.total)}</td>
          ${priced ? `<td>${money(row.total) || '—'}</td>` : ''}
        </tr>`;
      }).join('') +
      `</tbody><tfoot><tr><td>In plan</td><td>—</td><td>${CxModel.int(cost.count)}</td><td>—</td>` +
      `<td>${CxModel.int(cost.truePositives)}</td><td>${CxModel.int(cost.triage)}</td>` +
      `<td>${CxModel.int(cost.remediation)}</td><td>${cost.blendedCreditsEach.toFixed(2)}</td>` +
      `<td>${CxModel.int(cost.total)}</td>${priced ? `<td>${money(cost.total) || '—'}</td>` : ''}</tr></tfoot></table>`;
  }

  function renderSpendChart(flow) {
    const weeks = state.forecast.weeks;
    const labels = weeks.map((w) => w.date);
    const series = [{
      key: 'spend', color: flow.backlog,
      values: weeks.map((w) => w.cumulativeCredits),
      endLabel: CxModel.compact(state.forecast.totalCredits),
    }];
    const tips = labels.map((week, i) =>
      `<div class="t-title">Week ${i + 1} — ${CxCharts.shortDate(week)}</div>` +
      `<div class="t-row"><span>Credits this week</span><span>${CxModel.int(weeks[i].weekCredits)}</span></div>` +
      `<div class="t-row"><span>Cumulative</span><span>${CxModel.int(weeks[i].cumulativeCredits)}</span></div>` +
      `<div class="t-row"><span>Backlog left</span><span>${CxModel.int(weeks[i].remaining)}</span></div>`);

    $('chart-spend').innerHTML = CxCharts.lines({
      id: 'spend', labels: labels.map(CxCharts.shortDate), series, tipRows: tips, yZero: true, height: 240,
    });
    $('legend-spend').innerHTML =
      `<span class="item"><span class="swatch line" style="background:${flow.backlog}"></span>Cumulative credits at ${CxModel.int(state.pace)} findings/week</span>`;
  }

  function renderBudget() {
    const raw = Number($('budget-credits').value);
    if (!raw || raw <= 0) {
      $('budget-result').innerHTML = 'Enter a budget to see how far it goes.';
      return;
    }
    const backlog = {};
    for (const s of SEVERITIES) backlog[s] = state.stats.bySeverity[s].backlog;
    const result = CxModel.budget(raw, backlog, state.assumptions, state.modes);
    const colors = CxBrand.severityColors();
    const breakdown = CxModel.scopeList(state.modes)
      .filter((s) => result.processed[s] > 0.5)
      .map((s) => `${severityDot(s, colors)}${CxModel.int(result.processed[s])} ${s}`)
      .join(' · ');

    $('budget-result').innerHTML =
      `<strong>${CxModel.int(raw)} credits</strong> works through <strong>${CxModel.int(result.total)}</strong> findings — ` +
      `${CxModel.pct(result.coverage)} of the backlog in the plan, removing ${CxModel.int(result.removed)} of them.` +
      (breakdown ? `<div style="margin-top:6px">${breakdown}</div>` : '') +
      (result.leftover > 1
        ? `<div class="hint" style="margin-top:6px">${CxModel.int(result.leftover)} credits left over — the backlog in the plan runs out first.</div>`
        : '');
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
      modes: state.modes,
      assumptions: state.assumptions,
      creditPrice: state.creditPrice,
      lookback: state.lookback,
      horizon: state.horizon,
      pace: state.pace,
      deadlineWeeks: state.deadlineWeeks,
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
    const introduced = CxModel.scoped(frames.introduced, state.modes);
    const cleared = CxModel.scoped(frames.fixed, state.modes);
    const open = CxModel.scoped(frames.open, state.modes);
    const header = ['week_ending']
      .concat(SEVERITIES.map((s) => `open_${s.toLowerCase()}`))
      .concat(SEVERITIES.map((s) => `fixed_${s.toLowerCase()}`))
      .concat(['open_in_plan', 'introduced_in_plan', 'closed_in_plan', 'net_in_plan']);

    const lines = frames.weeks.map((week, i) => [week]
      .concat(SEVERITIES.map((s) => frames.open[s][i] ?? ''))
      .concat(SEVERITIES.map((s) => frames.fixed[s][i] ?? ''))
      .concat([
        open[i] ?? '',
        introduced[i] ?? '',
        cleared[i] ?? '',
        introduced[i] === null || cleared[i] === null ? '' : cleared[i] - introduced[i],
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

    const bindNumber = (id, apply) => $(id).addEventListener('input', () => {
      apply(Number($(id).value));
      if (state.frames) recompute();
    });

    bindNumber('rate-triage', (v) => { state.assumptions.triageCredits = Math.max(0, v || 0); });
    bindNumber('rate-remediation', (v) => { state.assumptions.remediationCredits = Math.max(0, v || 0); });
    bindNumber('credit-price', (v) => { state.creditPrice = v > 0 ? v : null; });
    bindNumber('lookback', (v) => { state.lookback = v; });
    bindNumber('pace', (v) => { state.pace = v; });
    bindNumber('horizon', (v) => { state.horizon = v; });

    $('deadline').addEventListener('change', () => {
      state.deadlineWeeks = Number($('deadline').value);
      if (state.frames) recompute();
    });
    $('btn-match-deadline').addEventListener('click', () => {
      if (!state.frames) return;
      state.pace = Math.ceil(CxModel.requiredProcessing(
        state.stats.scope.backlog, Math.max(0, state.stats.scope.avgIntroduced), state.deadlineWeeks));
      recompute();
    });
    $('budget-credits').addEventListener('input', () => { if (state.frames) renderBudget(); });

    $('btn-sample').addEventListener('click', loadSample);
    $('btn-export').addEventListener('click', doExport);
    $('btn-export-2').addEventListener('click', doExport);
    $('btn-csv').addEventListener('click', doCsv);

    $('btn-theme').addEventListener('click', () => {
      const next = CxBrand.currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cx-theme', next); } catch (_) { /* private mode */ }
      redrawForTheme();
    });
    CxBrand.onThemeChange(redrawForTheme);

    function redrawForTheme() {
      renderModeControls();
      renderTruePositiveRows();
      if (state.frames) render();
    }

    try {
      const saved = localStorage.getItem('cx-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (_) { /* private mode */ }

    renderModeControls();
    renderTruePositiveRows();
    CxCharts.bind(document);
  }

  wire();
})();
