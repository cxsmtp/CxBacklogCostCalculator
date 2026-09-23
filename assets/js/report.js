/*
 * report.js — builds the interactive customer report as one self-contained
 * HTML file.
 *
 * The report is not a screenshot of the app. It embeds the weekly data plus a
 * serialised copy of CxModel and CxCharts, so the customer can change the plan
 * — remediate a severity, triage it only, drop it, move the weekly pace — and
 * every number and chart recomputes with exactly the code that produced the
 * figures on screen.
 *
 * What the customer CANNOT change is the pricing: credits per triage, credits
 * per remediation, and the true-positive rates. Those arrive baked in and are
 * rendered read-only, so the scope is negotiable and the rate card is not.
 *
 * No network, no libraries: the file opens from disk and prints straight to PDF.
 */
window.CxReport = {

  /**
   * Emit a plain object of pure functions as JavaScript source.
   * Methods keep their shorthand form, which is valid inside an object literal;
   * data properties go through JSON. This is why model.js and charts.js are
   * written as self-referential objects with no closure state.
   */
  serialise(name, object) {
    const parts = Object.keys(object).map((key) => {
      const value = object[key];
      if (typeof value === 'function') return value.toString();
      return `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    });
    return `window.${name} = {\n${parts.join(',\n')}\n};`;
  },

  /* Guard against a customer name or filename closing the script block early. */
  json(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  },

  /* ------------------------------------------------------------------ css -- */

  css() {
    return `
:root{color-scheme:light;
--brand:#6B34FC;--brand-strong:#121185;--brand-tint:#EFEDFF;--brand-ink:#FFFFFF;
--page:#F6F5FB;--surface:#FFFFFF;--surface-2:#F3F1FD;
--ink:#0D0B1F;--ink-2:#4A4763;--muted:#78748F;
--grid:#E7E4F3;--axis:#CFCAE4;--border:rgba(13,11,31,.10);--border-strong:rgba(13,11,31,.18);
--good:#0B7A4B;--warn:#A96B00;--bad:#B3261E;
--shadow:0 1px 2px rgba(13,11,31,.06),0 8px 24px rgba(13,11,31,.06);
--font:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;
--brand:#9480EB;--brand-strong:#B9A9FF;--brand-tint:#1C1940;--brand-ink:#0B0A1C;
--page:#08081A;--surface:#111129;--surface-2:#171734;
--ink:#FFFFFF;--ink-2:#C8C4E0;--muted:#948FB4;
--grid:#22224A;--axis:#33325C;--border:rgba(255,255,255,.10);--border-strong:rgba(255,255,255,.20);
--good:#35C88A;--warn:#E0A73A;--bad:#FF7B7B;
--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}}
:root[data-theme="dark"]{color-scheme:dark;
--brand:#9480EB;--brand-strong:#B9A9FF;--brand-tint:#1C1940;--brand-ink:#0B0A1C;
--page:#08081A;--surface:#111129;--surface-2:#171734;
--ink:#FFFFFF;--ink-2:#C8C4E0;--muted:#948FB4;
--grid:#22224A;--axis:#33325C;--border:rgba(255,255,255,.10);--border-strong:rgba(255,255,255,.20);
--good:#35C88A;--warn:#E0A73A;--bad:#FF7B7B;
--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font-family:var(--font);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.page{max-width:1060px;margin:0 auto;padding:28px 22px 70px}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:17px;margin:0;font-weight:650;letter-spacing:-.01em}
h3{font-size:14px;margin:0 0 6px;font-weight:650}
p{margin:0 0 10px}
.masthead{display:flex;align-items:flex-start;gap:18px;border-bottom:2px solid var(--brand);padding-bottom:18px;margin-bottom:22px}
.masthead .logo{flex:none}
.masthead .logo img{height:34px;width:auto;display:block}
.masthead .meta{margin-left:auto;text-align:right;font-size:12.5px;color:var(--muted);white-space:nowrap}
.masthead .customer{font-size:13px;font-weight:650;color:var(--brand);letter-spacing:.04em;text-transform:uppercase}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:18px;margin-bottom:18px}
.card>header{display:flex;align-items:baseline;gap:12px;margin-bottom:14px}
.card>header .sub{font-size:12.5px;color:var(--muted)}
.section-title{font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:26px 0 12px}
.grid{display:grid;gap:14px}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:860px){.grid.two,.grid.four{grid-template-columns:minmax(0,1fr)}}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.kpi .label{font-size:12px;color:var(--muted);font-weight:550}
.kpi .value{font-size:28px;font-weight:680;letter-spacing:-.02em;margin-top:2px}
.kpi .value.small{font-size:21px}
.kpi .note{font-size:12px;color:var(--ink-2);margin-top:2px}
.kpi.accent{background:var(--brand-tint);border-color:color-mix(in srgb,var(--brand) 35%,transparent)}
.kpi.accent .value{color:var(--brand)}
.headline{font-size:15px;line-height:1.6;color:var(--ink-2)}
.headline b{color:var(--ink);font-weight:650}
.callout{border-left:3px solid var(--brand);background:var(--surface-2);border-radius:0 9px 9px 0;padding:11px 14px;font-size:13px;margin-bottom:12px}
.callout.warn{border-left-color:var(--warn)}
.callout.good{border-left-color:var(--good)}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left;font-variant-numeric:normal}
thead th{font-size:11.5px;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-bottom-color:var(--border-strong)}
tfoot td{font-weight:650;border-top:1px solid var(--border-strong);border-bottom:none}
.table-scroll{overflow-x:auto}
.sev-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px}
.hint{font-size:12px;color:var(--muted)}
.locked{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:650;color:var(--brand);background:var(--brand-tint);border-radius:999px;padding:2px 9px;white-space:nowrap}
.segmented{display:inline-flex;border:1px solid var(--border-strong);border-radius:999px;overflow:hidden;background:var(--surface)}
.segmented button{font:inherit;border:none;background:transparent;padding:5px 11px;font-size:12px;font-weight:550;color:var(--ink-2);cursor:pointer;white-space:nowrap}
.segmented button+button{border-left:1px solid var(--border)}
.segmented button.is-on{background:var(--brand);color:var(--brand-ink)}
button.plain{font:inherit;font-weight:550;border-radius:9px;border:1px solid var(--border-strong);background:var(--surface);color:var(--ink);padding:7px 13px;cursor:pointer}
button.plain:hover{background:var(--surface-2)}
button.accent{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
input[type=range]{width:100%;accent-color:var(--brand)}
select{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--border-strong);border-radius:9px;padding:7px 10px;width:100%}
.chart-wrap{width:100%;overflow-x:auto}
.cx-chart{width:100%;height:auto;display:block;min-width:520px}
.cx-grid{stroke:var(--grid);stroke-width:1}
.cx-axis{stroke:var(--axis);stroke-width:1}
.cx-tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.cx-endlabel{font-size:11.5px;font-weight:600}
.cx-barvalue{fill:var(--ink-2);font-size:11.5px;font-weight:600}
.cx-split{stroke:var(--brand);stroke-width:1.5}
.cx-split-label{fill:var(--brand);font-size:10.5px;font-weight:650}
.cx-forecast-wash{fill:var(--brand);opacity:.05}
.cx-crosshair{stroke:var(--brand);stroke-width:1;pointer-events:none}
.cx-hit{fill:transparent}
.cx-empty{color:var(--muted);font-size:13px;padding:12px 0}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12.5px;color:var(--ink-2)}
.legend .item{display:inline-flex;align-items:center;gap:6px}
.legend .swatch{width:11px;height:11px;border-radius:3px;flex:none}
.legend .swatch.line{height:3px;border-radius:2px;width:15px}
.cx-tooltip{position:fixed;z-index:100;pointer-events:none;opacity:0;transition:opacity 90ms ease;background:var(--surface);color:var(--ink);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);padding:9px 11px;font-size:12.5px;max-width:280px}
.cx-tooltip.is-visible{opacity:1}
.cx-tooltip .t-title{font-weight:650;margin-bottom:4px}
.cx-tooltip .t-row{display:flex;justify-content:space-between;gap:14px}
.cx-tooltip .t-row span:last-child{font-variant-numeric:tabular-nums;font-weight:600}
.cx-tooltip .t-row.t-total{border-top:1px solid var(--border);margin-top:4px;padding-top:4px}
.cx-tooltip .t-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.plan-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:9px 0}
.plan-row+.plan-row{border-top:1px solid var(--border)}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.footnote{margin-top:30px;padding-top:14px;border-top:1px solid var(--border);font-size:11.5px;color:var(--muted)}
.trend.up{color:var(--bad);font-weight:600}
.trend.down{color:var(--good);font-weight:600}
.trend.flat{color:var(--muted);font-weight:600}
.print-only{display:none}
@media print{
 .no-print{display:none!important}
 body{background:#fff}
 .page{max-width:none;padding:0}
 .card{box-shadow:none;break-inside:avoid}
 .cx-chart{min-width:0}
 .segmented{display:none}
 .print-only{display:inline;font-weight:600}
 th,td{white-space:normal;padding:6px 7px;font-size:11.5px}
 .table-scroll{overflow:visible}
 .legend{font-size:11px}
}
`;
  },

  /* -------------------------------------------------------------- runtime -- */

  /**
   * The report's own script. Written as a real function so it can use template
   * literals freely; it is serialised with toString() at build time and reads
   * everything it needs from window.REPORT.
   */
  runtime: function () {
    const R = window.REPORT;
    const $ = (id) => document.getElementById(id);
    const SEV = CxModel.SEVERITIES;
    const esc = CxCharts.esc;

    const state = {
      modes: Object.assign({}, R.modes),
      pace: R.pace,
      horizon: R.horizon,
      deadlineWeeks: R.deadlineWeeks,
    };

    const theme = () => {
      const stamped = document.documentElement.getAttribute('data-theme');
      if (stamped === 'dark' || stamped === 'light') return stamped;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    };
    const colors = () => R.palette.severity[theme()];
    const flowColors = () => R.palette.flow[theme()];
    const scenarioColors = () => R.palette.scenario[theme()];

    const money = (credits) => {
      if (!R.creditPrice || !isFinite(credits)) return null;
      return (credits * R.creditPrice)
        .toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    };
    const dot = (severity) => `<span class="sev-dot" style="background:${colors()[severity]}"></span>`;

    let stats = null;
    let scenarios = null;
    let forecast = null;
    let cost = null;

    function compute() {
      stats = CxModel.stats(R.frames, state.modes, R.lookback);

      const counts = {};
      for (const s of SEV) counts[s] = stats.bySeverity[s].backlog;
      cost = CxModel.cost(counts, R.assumptions, state.modes);

      scenarios = CxModel.scenarios(stats, state.modes, R.assumptions, {
        horizonWeeks: state.horizon,
        allocation: 'severity-first',
        startWeek: stats.lastWeek,
        targetWeeks: state.deadlineWeeks,
        targetProcessing: state.pace,
        targetLabel: 'Your chosen pace',
      });
      forecast = scenarios.find((sc) => sc.id === 'target').result;
    }

    /* ----------------------------------------------------------- sections -- */

    function renderKpis() {
      const net = stats.scope.netWeekly;
      const doubling = stats.scope.backlog > 0 && net < 0 ? stats.scope.backlog / -net : null;
      const trend = Math.abs(net) < 1 ? 'flat' : (net < 0 ? 'up' : 'down');

      $('kpis').innerHTML = `
        <div class="kpi accent">
          <div class="label">Open findings in the plan</div>
          <div class="value">${CxModel.compact(stats.scope.backlog)}</div>
          <div class="note">${CxModel.int(stats.scope.backlog)} as of ${stats.lastWeek}</div>
        </div>
        <div class="kpi">
          <div class="label">Arriving each week</div>
          <div class="value">${CxModel.compact(Math.max(0, stats.scope.avgIntroduced))}</div>
          <div class="note">${R.lookback}-week average</div>
        </div>
        <div class="kpi">
          <div class="label">Closed each week today</div>
          <div class="value">${CxModel.compact(stats.scope.avgFixed)}</div>
          <div class="note">${R.lookback}-week average</div>
        </div>
        <div class="kpi">
          <div class="label">Net movement</div>
          <div class="value small trend ${trend}">${CxModel.signed(-net)}/week</div>
          <div class="note">${net > 0
            ? `Shrinking — clear in ${CxModel.weeksAsDuration(stats.scope.backlog / net)} at today's pace.`
            : (doubling ? `Growing — it doubles in ${CxModel.weeksAsDuration(doubling)}.` : 'Holding steady.')}</div>
        </div>`;
    }

    function renderHeadline() {
      const net = stats.scope.netWeekly;
      const priced = money(cost.total);
      const direction = net > 0
        ? `fixes are outpacing new findings by <b>${CxModel.int(net)} a week</b>`
        : `new findings are outpacing fixes by <b>${CxModel.int(-net)} a week</b>`;
      const leftInPlace = cost.leftInPlace > 1
        ? ` A further <b>${CxModel.int(cost.leftInPlace)}</b> real findings stay on the books by choice, in the severities set to triage only.`
        : '';

      $('headline').innerHTML =
        `The plan below covers <b>${CxModel.int(stats.scope.backlog)}</b> open findings. ` +
        `Over the last ${R.lookback} weeks ${direction}, while ${CxModel.int(stats.scope.avgFixed)} a week were closed. ` +
        `Working through today's backlog costs <b>${CxModel.int(cost.total)} Checkmarx credits</b>` +
        (priced ? ` (about <b>${priced}</b>)` : '') +
        `: ${CxModel.int(cost.triage)} to triage every finding, and ${CxModel.int(cost.remediation)} to remediate the ` +
        `${CxModel.int(cost.truePositives)} expected to be real.${leftInPlace}`;
    }

    function renderPlan() {
      const priced = R.creditPrice;
      const rows = SEV.map((s) => {
        const row = cost.bySeverity[s];
        const off = row.mode === 'none';
        return `<tr${off ? ' style="opacity:.5"' : ''}>
          <td>${dot(s)}${s}</td>
          <td style="text-align:left">
            <span class="segmented" role="group" aria-label="Plan for ${s}">
              ${CxModel.MODES.map((m) => `<button type="button" data-severity="${s}" data-mode="${m}"
                class="${row.mode === m ? 'is-on' : ''}" aria-pressed="${row.mode === m}">${CxModel.MODE_LABEL[m]}</button>`).join('')}
            </span>
            <span class="print-only">${CxModel.MODE_LABEL[row.mode]}</span>
          </td>
          <td>${CxModel.int(stats.bySeverity[s].backlog)}</td>
          <td>${CxModel.pct(R.assumptions.truePositiveRate[s])}</td>
          <td>${off ? '—' : row.creditsEach.toFixed(2)}</td>
          <td>${CxModel.int(row.total)}</td>
          ${priced ? `<td>${money(row.total) || '—'}</td>` : ''}
        </tr>`;
      });

      $('plan-table').innerHTML =
        '<table><thead><tr><th>Severity</th><th style="text-align:left">What we will do</th><th>Open now</th>' +
        '<th>TP&nbsp;%</th><th>Credits each</th><th>Line total</th>' +
        (priced ? '<th>Approx. value</th>' : '') + '</tr></thead><tbody>' +
        rows.join('') +
        `</tbody><tfoot><tr><td>Total in plan</td><td style="text-align:left">—</td>` +
        `<td>${CxModel.int(cost.count)}</td><td>—</td><td>${cost.blendedCreditsEach.toFixed(2)}</td>` +
        `<td>${CxModel.int(cost.total)}</td>${priced ? `<td>${money(cost.total) || '—'}</td>` : ''}</tr></tfoot></table>`;

      $('plan-table').querySelectorAll('button[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          state.modes[button.dataset.severity] = button.dataset.mode;
          rerender();
        });
      });
    }

    function renderCostTiles() {
      const influx = {};
      for (const s of SEV) influx[s] = Math.max(0, stats.bySeverity[s].avgIntroduced);
      const runRate = CxModel.cost(influx, R.assumptions, state.modes);
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
          <div class="label">Keep up with new findings</div>
          <div class="value">${CxModel.compact(runRate.total)}</div>
          <div class="note">credits per week · ${CxModel.compact(runRate.total * 52)} a year</div>
        </div>
        <div class="kpi">
          <div class="label">Total over ${state.horizon} weeks</div>
          <div class="value">${CxModel.compact(forecast.totalCredits)}</div>
          <div class="note">backlog and new findings combined</div>
          ${priceNote(forecast.totalCredits)}
        </div>
        <div class="kpi">
          <div class="label">Backlog left at the end</div>
          <div class="value">${CxModel.compact(forecast.endTotal)}</div>
          <div class="note">${forecast.weeksToZero !== null
            ? `Reaches zero in ${CxModel.weeksAsDuration(forecast.weeksToZero)}.`
            : 'Zero is out of reach with triage-only lines in the plan.'}</div>
        </div>`;
    }

    function renderPace() {
      const totalInflux = Math.max(0, stats.scope.avgIntroduced);
      const required = CxModel.requiredProcessing(stats.scope.backlog, totalInflux, state.deadlineWeeks);
      const paceMax = Math.max(10, Math.ceil(Math.max(required, stats.scope.avgFixed * 2, 1) / 10) * 10);

      const slider = $('pace');
      slider.max = String(paceMax);
      slider.step = String(Math.max(1, Math.round(paceMax / 200)));
      if (Number(slider.value) !== Math.min(state.pace, paceMax)) {
        slider.value = String(Math.min(state.pace, paceMax));
      }
      state.pace = Number(slider.value);

      $('pace-out').textContent = CxModel.int(state.pace);
      $('pace-note').innerHTML =
        `At ${CxModel.int(state.pace)} findings a week the backlog in the plan ` +
        (forecast.weeksToZero !== null
          ? `reaches zero in <b>${CxModel.weeksAsDuration(forecast.weeksToZero)}</b>.`
          : `settles at <b>${CxModel.int(forecast.endTotal)}</b> — the triage-only lines keep their real findings.`) +
        ` Today's measured pace is ${CxModel.int(stats.scope.avgFixed)} a week, against ` +
        `${CxModel.int(totalInflux)} arriving.`;
      $('deadline-note').textContent =
        `Clearing in ${state.deadlineWeeks} weeks needs ${CxModel.int(required)} findings a week.`;
    }

    /* -------------------------------------------------------------- charts -- */

    function renderBacklogChart() {
      const c = colors();
      const history = R.frames.weeks;
      const forecastWeeks = forecast.weeks;
      const labels = history.concat(forecastWeeks.map((w) => w.date));
      const inScope = CxModel.scopeList(state.modes);

      if (!inScope.length) {
        $('chart-backlog').innerHTML = '<p class="cx-empty">Nothing is in the plan — every severity is set to "Not in plan".</p>';
        $('legend-backlog').innerHTML = '';
        return;
      }

      const series = inScope.map((s) => ({
        key: s, label: s, color: c[s],
        values: R.frames.open[s].map((v) => v || 0).concat(forecastWeeks.map((w) => w.open[s] || 0)),
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
        id: 'backlog', labels: labels.map(CxCharts.shortDate), series,
        splitAt: history.length - 1, tipRows: tips, height: 320,
      });
      $('legend-backlog').innerHTML = series.map((s) =>
        `<span class="item"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`).join('') +
        `<span class="item"><span class="swatch" style="background:var(--brand);opacity:.25"></span>Projected at ${CxModel.int(state.pace)}/week</span>`;

      const scoped = CxModel.scoped(R.frames.open, state.modes);
      $('table-backlog').innerHTML =
        '<table><thead><tr><th>Week ending</th>' +
        SEV.map((s) => `<th>${dot(s)}${s}</th>`).join('') + '<th>In plan</th></tr></thead><tbody>' +
        history.map((week, i) => `<tr><td>${week}</td>` +
          SEV.map((s) => `<td>${CxModel.int(R.frames.open[s][i])}</td>`).join('') +
          `<td>${CxModel.int(scoped[i])}</td></tr>`).join('') +
        '</tbody></table>';
    }

    function renderFlowChart() {
      const f = flowColors();
      const introduced = CxModel.scoped(R.frames.introduced, state.modes);
      const cleared = CxModel.scoped(R.frames.fixed, state.modes);
      const net = introduced.map((v, i) => (v === null || cleared[i] === null ? null : cleared[i] - v));

      const tips = R.frames.weeks.map((week, i) =>
        `<div class="t-title">Week ending ${CxCharts.shortDate(week)}</div>` +
        `<div class="t-row"><span><span class="t-dot" style="background:${f.introduced}"></span>New findings</span><span>${CxModel.int(introduced[i])}</span></div>` +
        `<div class="t-row"><span><span class="t-dot" style="background:${f.cleared}"></span>Closed</span><span>${CxModel.int(cleared[i])}</span></div>` +
        `<div class="t-row t-total"><span>Net</span><span>${CxModel.signed(net[i])}</span></div>`);

      $('chart-flow').innerHTML = CxCharts.flow({
        id: 'flow', labels: R.frames.weeks.map(CxCharts.shortDate),
        groups: [
          { label: 'New findings', color: f.introduced, values: introduced },
          { label: 'Closed', color: f.cleared, values: cleared },
        ],
        line: { label: 'Net', color: f.backlog, values: net },
        tipRows: tips, height: 290,
      });
      $('legend-flow').innerHTML =
        `<span class="item"><span class="swatch" style="background:${f.introduced}"></span>New findings arriving</span>` +
        `<span class="item"><span class="swatch" style="background:${f.cleared}"></span>Findings closed</span>` +
        `<span class="item"><span class="swatch line" style="background:${f.backlog}"></span>Net — above zero means the backlog shrank</span>`;
    }

    function renderScenarioChart() {
      const sc = scenarioColors();
      const labels = scenarios[0].result.weeks.map((w) => w.date);
      const series = scenarios.map((scenario) => ({
        key: scenario.id,
        color: sc[scenario.id],
        values: scenario.result.weeks.map((w) => w.remaining),
        endLabel: CxModel.compact(scenario.result.endTotal),
        dashed: scenario.id === 'nothing',
      }));

      const tips = labels.map((week, i) =>
        `<div class="t-title">${CxCharts.shortDate(week)} — week ${i + 1}</div>` +
        scenarios.map((scenario, k) =>
          `<div class="t-row"><span><span class="t-dot" style="background:${series[k].color}"></span>${esc(scenario.name)}</span><span>${CxModel.int(series[k].values[i])}</span></div>`).join(''));

      $('chart-scenarios').innerHTML = CxCharts.lines({
        id: 'scenarios', labels: labels.map(CxCharts.shortDate), series, tipRows: tips, yZero: true, height: 290,
      });
      $('legend-scenarios').innerHTML = scenarios.map((scenario, k) =>
        `<span class="item"><span class="swatch line" style="background:${series[k].color}"></span>${esc(scenario.name)}</span>`).join('');

      const priced = R.creditPrice;
      $('table-scenarios').innerHTML =
        '<table><thead><tr><th>Scenario</th><th>Findings / week</th>' +
        `<th>Backlog after ${state.horizon}w</th><th>Reaches zero in</th><th>Credits over ${state.horizon}w</th>` +
        (priced ? '<th>Approx. value</th>' : '') + '</tr></thead><tbody>' +
        scenarios.map((scenario) => `<tr>
          <td>${esc(scenario.name)}<div class="hint">${esc(scenario.note)}</div></td>
          <td>${CxModel.int(scenario.processing)}</td>
          <td>${CxModel.int(scenario.result.endTotal)}</td>
          <td>${CxModel.weeksAsDuration(scenario.result.weeksToZero)}</td>
          <td>${CxModel.int(scenario.result.totalCredits)}</td>
          ${priced ? `<td>${money(scenario.result.totalCredits) || '—'}</td>` : ''}
        </tr>`).join('') + '</tbody></table>';
    }

    function renderSpendChart() {
      const f = flowColors();
      const weeks = forecast.weeks;
      const labels = weeks.map((w) => w.date);
      const series = [{
        key: 'spend', color: f.backlog,
        values: weeks.map((w) => w.cumulativeCredits),
        endLabel: CxModel.compact(forecast.totalCredits),
      }];
      const tips = labels.map((week, i) =>
        `<div class="t-title">Week ${i + 1} — ${CxCharts.shortDate(week)}</div>` +
        `<div class="t-row"><span>Credits this week</span><span>${CxModel.int(weeks[i].weekCredits)}</span></div>` +
        `<div class="t-row"><span>Cumulative</span><span>${CxModel.int(weeks[i].cumulativeCredits)}</span></div>` +
        `<div class="t-row"><span>Backlog left</span><span>${CxModel.int(weeks[i].remaining)}</span></div>`);

      $('chart-spend').innerHTML = CxCharts.lines({
        id: 'spend', labels: labels.map(CxCharts.shortDate), series, tipRows: tips, yZero: true, height: 230,
      });
      $('legend-spend').innerHTML =
        `<span class="item"><span class="swatch line" style="background:${f.backlog}"></span>Cumulative credits at ${CxModel.int(state.pace)} findings/week</span>`;
    }

    function renderCostBars() {
      const c = colors();
      const rows = CxModel.scopeList(state.modes).map((s) => ({
        label: s, color: c[s],
        count: cost.bySeverity[s].count,
        triage: cost.bySeverity[s].triage,
        remediation: cost.bySeverity[s].remediation,
        total: cost.bySeverity[s].total,
      }));
      $('chart-cost').innerHTML = CxCharts.costBars({ rows });
      $('legend-cost').innerHTML =
        '<span class="item"><span class="swatch" style="background:var(--muted);opacity:.45"></span>Triage — every finding</span>' +
        '<span class="item"><span class="swatch" style="background:var(--muted)"></span>Remediation — true positives only</span>';
    }

    /* ------------------------------------------------------------- wire-up -- */

    function rerender() {
      compute();
      renderKpis();
      renderHeadline();
      renderPlan();
      renderCostTiles();
      renderCostBars();
      renderPace();
      renderBacklogChart();
      renderFlowChart();
      renderScenarioChart();
      renderSpendChart();
      CxCharts.bind(document);
    }

    $('pace').addEventListener('input', () => {
      state.pace = Number($('pace').value);
      rerender();
    });
    $('deadline').addEventListener('change', () => {
      state.deadlineWeeks = Number($('deadline').value);
      rerender();
    });
    $('horizon').addEventListener('change', () => {
      state.horizon = Number($('horizon').value);
      rerender();
    });
    $('btn-match-deadline').addEventListener('click', () => {
      state.pace = Math.ceil(CxModel.requiredProcessing(
        stats.scope.backlog, Math.max(0, stats.scope.avgIntroduced), state.deadlineWeeks));
      $('pace').value = String(state.pace);
      rerender();
    });
    $('btn-print').addEventListener('click', () => window.print());
    $('btn-reset').addEventListener('click', () => {
      state.modes = Object.assign({}, R.modes);
      state.pace = R.pace;
      state.horizon = R.horizon;
      state.deadlineWeeks = R.deadlineWeeks;
      $('horizon').value = String(state.horizon);
      $('deadline').value = String(state.deadlineWeeks);
      rerender();
    });
    $('btn-theme').addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', theme() === 'dark' ? 'light' : 'dark');
      rerender();
    });

    rerender();
  },

  /* ------------------------------------------------------------- assembly -- */

  build(context) {
    const esc = CxCharts.esc;
    const customer = context.customer || 'Customer';
    const logo = context.logoDataUrl
      ? `<img src="${context.logoDataUrl}" alt="${esc(customer)}">`
      : CxBrand.logoSvg(34);
    const generated = new Date(context.generatedAt);
    const generatedLabel = generated.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const provenanceRows = ['totals', 'fixed'].map((slot) => {
      const meta = context.provenance[slot];
      if (!meta) return '';
      const filters = (meta.filters || [])
        .map((f) => `${esc(f.field)} ${esc(f.operator)} ${esc(f.value)}`).join('; ');
      return `<tr><td>${slot === 'fixed' ? 'Fixed vulnerabilities' : 'Total vulnerabilities'}</td>` +
        `<td style="text-align:left">${esc(meta.fileName || '—')}</td>` +
        `<td style="text-align:left">${meta.exportedAt ? esc(String(meta.exportedAt).slice(0, 10)) : '—'}</td>` +
        `<td style="text-align:left">${filters || '—'}</td></tr>`;
    }).join('');

    const assumptionRows = CxModel.SEVERITIES.map((s) => `
      <tr>
        <td><span class="sev-dot" style="background:${context.palette.severity.light[s]}"></span>${s}</td>
        <td>${CxModel.pct(context.assumptions.truePositiveRate[s])}</td>
        <td>${context.assumptions.triageCredits.toFixed(2)}</td>
        <td>${(context.assumptions.truePositiveRate[s] * context.assumptions.remediationCredits).toFixed(2)}</td>
        <td>${CxModel.unitCost(s, context.assumptions, 'full').toFixed(2)}</td>
        <td>${CxModel.unitCost(s, context.assumptions, 'triage').toFixed(2)}</td>
      </tr>`).join('');

    const body = `
<div class="page">

  <header class="masthead">
    <span class="logo">${logo}</span>
    <span>
      <div class="customer">${esc(customer)}</div>
      <h1>${esc(context.title)}</h1>
      <div class="hint">Checkmarx credit forecast for triage and remediation</div>
    </span>
    <span class="meta">
      ${generatedLabel}<br>
      ${context.preparedBy ? `Prepared by ${esc(context.preparedBy)}<br>` : ''}
      ${context.validity ? `Valid until ${esc(context.validity)}` : ''}
    </span>
  </header>

  <div class="toolbar no-print">
    <button type="button" class="plain accent" id="btn-print">Save as PDF</button>
    <button type="button" class="plain" id="btn-reset">Reset to the proposed plan</button>
    <button type="button" class="plain" id="btn-theme" title="Switch light / dark">◐</button>
    <span class="locked">🔒 Credit rates and true-positive assumptions are fixed</span>
  </div>

  <div class="callout no-print">
    <strong>This page is live.</strong> Change what you want to do with each
    severity, and move the weekly pace — the credit totals, the burn-down and
    every chart update as you go. The rate card behind them
    (${context.assumptions.triageCredits} credit per triage,
    ${context.assumptions.remediationCredits} per remediation, and the
    true-positive rates) is fixed and cannot be edited here.
  </div>

  <p class="section-title">Where the backlog stands</p>
  <div class="grid four" id="kpis"></div>
  <div class="card" style="margin-top:14px"><p class="headline" id="headline"></p></div>

  <p class="section-title">Choose what to fix</p>
  <section class="card">
    <header>
      <h2>The plan, line by line</h2>
      <span class="sub">Every line is yours to change. The credits per finding are not.</span>
    </header>
    <div class="table-scroll" id="plan-table"></div>
    <p class="hint" style="margin-top:10px">
      <strong>Triage + remediate</strong> pays to disposition every finding and fix
      the real ones, so the line can reach zero.
      <strong>Triage only</strong> pays to disposition them, which removes the false
      positives and leaves the real findings open by choice.
      <strong>Not in plan</strong> spends nothing and changes nothing.
    </p>
  </section>

  <p class="section-title">What it costs</p>
  <div class="grid four" id="cost-kpis"></div>

  <section class="card" style="margin-top:14px">
    <header>
      <h2>Cost to clear today's backlog</h2>
      <span class="sub">Lighter segment = triage, solid segment = remediation.</span>
    </header>
    <div class="chart-wrap" id="chart-cost"></div>
    <div class="legend" id="legend-cost"></div>
  </section>

  <p class="section-title">How fast the debt goes away</p>
  <section class="card">
    <header><h2>Set the pace</h2></header>
    <div class="grid two">
      <label>
        <span class="hint">Work through <output id="pace-out">0</output> findings per week</span>
        <input type="range" id="pace" min="0" max="100" step="1" value="${Math.round(context.pace)}">
      </label>
      <div>
        <label>
          <span class="hint">Or aim at a deadline</span>
          <select id="deadline">
            ${[13, 26, 52, 104].map((w) =>
              `<option value="${w}"${w === context.deadlineWeeks ? ' selected' : ''}>Clear the backlog in ${w} weeks</option>`).join('')}
          </select>
        </label>
        <p class="hint" id="deadline-note" style="margin-top:6px"></p>
        <button type="button" class="plain no-print" id="btn-match-deadline"
                style="padding:5px 11px;font-size:12px">Set the pace to meet it</button>
      </div>
    </div>
    <p id="pace-note" style="margin-top:12px"></p>
    <label class="no-print">
      <span class="hint">Forecast horizon</span>
      <select id="horizon" style="max-width:220px">
        ${[26, 52, 78, 104, 156].map((w) =>
          `<option value="${w}"${w === context.horizon ? ' selected' : ''}>${w} weeks</option>`).join('')}
      </select>
    </label>
  </section>

  <section class="card">
    <header>
      <h2>Open findings: measured, then projected</h2>
      <span class="sub">The divider marks where the data ends and the forecast begins.</span>
    </header>
    <div class="chart-wrap" id="chart-backlog"></div>
    <div class="legend" id="legend-backlog"></div>
    <div class="table-scroll" style="margin-top:14px" id="table-backlog"></div>
  </section>

  <section class="card">
    <header>
      <h2>Arrivals against closures, week by week</h2>
      <span class="sub">New findings are derived: open(t) − open(t−1) + closed(t).</span>
    </header>
    <div class="chart-wrap" id="chart-flow"></div>
    <div class="legend" id="legend-flow"></div>
  </section>

  <section class="card">
    <header>
      <h2>Four paces compared</h2>
      <span class="sub">Same arrival rate throughout — only the pace changes.</span>
    </header>
    <div class="chart-wrap" id="chart-scenarios"></div>
    <div class="legend" id="legend-scenarios"></div>
    <div class="table-scroll" style="margin-top:14px" id="table-scenarios"></div>
  </section>

  <section class="card">
    <header>
      <h2>Credit spend over time</h2>
      <span class="sub">Cumulative credits at the pace set above.</span>
    </header>
    <div class="chart-wrap" id="chart-spend"></div>
    <div class="legend" id="legend-spend"></div>
  </section>

  <p class="section-title">The rate card and the method</p>
  <section class="card">
    <header>
      <h2>Fixed assumptions</h2>
      <span class="locked">🔒 read-only</span>
    </header>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Severity</th><th>True positive %</th><th>Triage credits</th>
          <th>Expected remediation credits</th><th>Credits each, fully fixed</th><th>Credits each, triage only</th></tr></thead>
        <tbody>${assumptionRows}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:12px">
      Every finding costs ${context.assumptions.triageCredits} credit to triage.
      Only the findings that turn out to be real cost a further
      ${context.assumptions.remediationCredits} to remediate, so the expected cost
      of one finding is ${context.assumptions.triageCredits} +
      ${context.assumptions.remediationCredits} × its true-positive rate. False
      positives stop after triage. The true-positive rates above are estimates
      until replaced with measured triage history.
    </p>
  </section>

  <section class="card">
    <header><h2>Where the data came from</h2></header>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Export</th><th style="text-align:left">File</th>
          <th style="text-align:left">Exported</th><th style="text-align:left">Filters</th></tr></thead>
        <tbody>${provenanceRows}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:12px">
      Weeks covered: ${esc(context.frames.weeks[0])} to ${esc(context.frames.weeks[context.frames.weeks.length - 1])}
      (${context.frames.weeks.length} weekly snapshots). Arrival and closure rates
      are ${context.lookback}-week averages. Capacity is spent worst severity
      first: Critical before High, and so on down.
    </p>
  </section>

  <p class="footnote">
    Generated by the Checkmarx Backlog Cost Calculator on ${generatedLabel}. This
    file contains its own data and runs entirely in your browser — nothing is sent
    anywhere when you change the plan. Figures are forecasts based on the weekly
    exports named above and the fixed assumptions in the rate card; actual credit
    consumption depends on real triage outcomes.
  </p>

</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(customer)} — ${esc(context.title)}</title>
<style>${CxReport.css()}</style>
</head>
<body>
${body}
<script>
${CxReport.serialise('CxModel', CxModel)}
${CxReport.serialise('CxCharts', CxCharts)}
window.REPORT = ${CxReport.json(context)};
(${CxReport.runtime.toString()})();
</` + `script>
</body>
</html>`;
  },
};
