/*
 * report.js — builds the interactive customer report as one self-contained
 * HTML file.
 *
 * The report is not a screenshot of the app. It embeds the weekly data plus a
 * serialised copy of CxModel and CxCharts, so the customer can move two
 * sliders per severity — how many findings to put through triage, and how many
 * of those they expect to come back false positive — and every number, table
 * and chart recomputes with exactly the code that produced the figures on
 * screen.
 *
 * What the customer CANNOT change is the rate card: credits per triage and
 * credits per remediation arrive baked in and are rendered read-only. The
 * scope is negotiable; the price of a unit of work is not.
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
.card>header{display:flex;align-items:baseline;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.card>header .sub{font-size:12.5px;color:var(--muted)}
.section-title{font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:26px 0 12px}
.grid{display:grid;gap:14px}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:900px){.grid.two,.grid.three,.grid.four{grid-template-columns:minmax(0,1fr)}}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.kpi .label{font-size:12px;color:var(--muted);font-weight:550}
.kpi .value{font-size:28px;font-weight:680;letter-spacing:-.02em;margin-top:2px}
.kpi .value.small{font-size:21px}
.kpi .note{font-size:12px;color:var(--ink-2);margin-top:2px}
.kpi.accent{background:var(--brand-tint);border-color:color-mix(in srgb,var(--brand) 35%,transparent)}
.kpi.accent .value{color:var(--brand)}
.kpi.good .value{color:var(--good)}
.kpi.bad .value{color:var(--bad)}
.headline{font-size:15px;line-height:1.6;color:var(--ink-2)}
.headline b,.headline strong{color:var(--ink);font-weight:650}
.callout{border-left:3px solid var(--brand);background:var(--surface-2);border-radius:0 9px 9px 0;padding:11px 14px;font-size:13px}
.callout.warn{border-left-color:var(--warn)}
.callout.good{border-left-color:var(--good)}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left;font-variant-numeric:normal}
thead th{font-size:11.5px;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-bottom-color:var(--border-strong)}
tfoot td{font-weight:650;border-top:1px solid var(--border-strong);border-bottom:none}
.table-scroll{overflow-x:auto}
details{border-top:1px solid var(--border);margin-top:14px;padding-top:10px}
summary{cursor:pointer;font-size:12.5px;color:var(--muted);font-weight:550}
.sev-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px}
.hint{font-size:12px;color:var(--muted)}
.locked{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:650;color:var(--brand);background:var(--brand-tint);border-radius:999px;padding:2px 9px;white-space:nowrap}
.sev-grid{display:grid;gap:12px;grid-template-columns:repeat(5,minmax(0,1fr))}
@media (max-width:1000px){.sev-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.sev-grid{grid-template-columns:minmax(0,1fr)}}
.sev-box{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px}
.sev-head{display:flex;align-items:center;gap:2px;font-size:13px;font-weight:650;margin-bottom:10px;flex-wrap:wrap}
.sev-open{margin-left:auto;font-size:11.5px;font-weight:550;color:var(--muted);white-space:nowrap}
.slider-row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px;color:var(--muted);margin-top:8px}
.slider-row output{font-size:13px;font-weight:650;color:var(--ink);font-variant-numeric:tabular-nums}
.sev-foot{margin:10px 0 0;padding-top:9px;border-top:2px solid var(--border);font-size:11.5px;color:var(--ink-2)}
.plan-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:end;margin-top:16px}
@media (max-width:760px){.plan-tools{grid-template-columns:minmax(0,1fr)}}
.plan-buttons{display:flex;flex-wrap:wrap;gap:8px}
.field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--muted)}
.field output{font-weight:650;color:var(--ink);font-variant-numeric:tabular-nums}
button.plain{font:inherit;font-size:12.5px;font-weight:550;border-radius:9px;border:1px solid var(--border-strong);background:var(--surface);color:var(--ink);padding:6px 12px;cursor:pointer}
button.plain:hover{background:var(--surface-2)}
button.accent{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
input[type=range]{width:100%;accent-color:var(--brand);margin:0}
.chart-wrap{width:100%;overflow-x:auto}
.cx-chart{width:100%;height:auto;display:block;min-width:520px}
.cx-grid{stroke:var(--grid);stroke-width:1}
.cx-axis{stroke:var(--axis);stroke-width:1}
.cx-tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.cx-endlabel{font-size:11.5px;font-weight:600}
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
.footnote{margin-top:30px;padding-top:14px;border-top:1px solid var(--border);font-size:11.5px;color:var(--muted)}
@media print{
 .no-print{display:none!important}
 body{background:#fff}
 .page{max-width:none;padding:0}
 .card{box-shadow:none;break-inside:avoid}
 .cx-chart{min-width:0}
 input[type=range]{display:none}
 .slider-row{color:var(--ink-2)}
 details{display:block}
 details>summary{display:none}
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

    const state = {
      plan: JSON.parse(JSON.stringify(R.plan)),
      pace: R.pace,
      horizon: R.horizon,
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
    const dot = (severity) => `<span class="sev-dot" style="background:${colors()[severity]}"></span>`;

    const stats = CxModel.stats(R.frames, R.lookback);
    let cost = null;
    let forecast = null;

    function table(head, rows, foot) {
      return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>` +
        (foot ? `<tfoot><tr>${foot.map((c) => `<td>${c}</td>`).join('')}</tr></tfoot>` : '') +
        '</table>';
    }

    /* ------------------------------------------------------- history (fixed) -- */

    function renderKpis() {
      const t = stats.total;
      const losing = t.netWeekly > 0;
      $('kpis').innerHTML = `
        <div class="kpi accent">
          <div class="label">Open findings</div>
          <div class="value">${CxModel.compact(t.backlog)}</div>
          <div class="note">${CxModel.int(t.backlog)} as of ${stats.lastWeek}</div>
        </div>
        <div class="kpi bad">
          <div class="label">Debt rate</div>
          <div class="value">${CxModel.compact(t.debtRate)}<span style="font-size:15px">/wk</span></div>
          <div class="note">new findings arriving, ${stats.weeksUsed}-week average</div>
        </div>
        <div class="kpi good">
          <div class="label">Fix rate</div>
          <div class="value">${CxModel.compact(t.fixRate)}<span style="font-size:15px">/wk</span></div>
          <div class="note">findings closed, ${stats.weeksUsed}-week average</div>
        </div>
        <div class="kpi ${losing ? 'bad' : 'good'}">
          <div class="label">Net movement</div>
          <div class="value small">${CxModel.signed(t.netWeekly)}/week</div>
          <div class="note">${losing ? 'the backlog is growing' : 'the backlog is shrinking'}</div>
        </div>`;

      const perHundred = Math.round(t.keepUp * 100);
      const doubles = t.netWeekly > 0 ? t.backlog / t.netWeekly : null;
      $('headline').innerHTML = t.netWeekly > 0
        ? `For every <strong>100</strong> findings that arrive, the team clears <strong>${perHundred}</strong>. ` +
          `The backlog grows by <strong>${CxModel.int(t.netWeekly)}</strong> a week — at that rate it doubles in about ` +
          `<strong>${CxModel.weeksAsDuration(doubles)}</strong>.`
        : `The team clears <strong>${perHundred}</strong> of every 100 findings that arrive and is ` +
          `<strong>${CxModel.int(Math.abs(t.netWeekly))}</strong> a week ahead. The backlog is shrinking on its own.`;
    }

    function renderHistoryCharts() {
      const sevColors = colors();
      const flow = flowColors();
      const weeks = R.frames.weeks;
      const labels = weeks.map(CxCharts.shortDate);

      const series = SEV.slice().reverse().map((s) => ({
        key: s, color: sevColors[s], values: R.frames.open[s].map((v) => v || 0),
      }));
      const backlogTips = weeks.map((week, i) => {
        const rows = SEV.map((s) =>
          `<div class="t-row"><span>${s}</span><span>${CxModel.int(R.frames.open[s][i])}</span></div>`).join('');
        const total = CxModel.sum(SEV.map((s) => R.frames.open[s][i] || 0));
        return `<div class="t-title">${week}</div>${rows}` +
          `<div class="t-row t-total"><span>Open</span><span>${CxModel.int(total)}</span></div>`;
      });
      $('chart-backlog').innerHTML = CxCharts.stackedArea({
        id: 'backlog', labels, series, tipRows: backlogTips, height: 280,
      });
      $('legend-backlog').innerHTML = SEV.map((s) =>
        `<span class="item"><span class="swatch" style="background:${sevColors[s]}"></span>${s}</span>`).join('');

      const introduced = CxModel.rollup(R.frames.introduced);
      const cleared = CxModel.rollup(R.frames.fixed);
      const flowTips = weeks.map((week, i) =>
        `<div class="t-title">${week}</div>` +
        `<div class="t-row"><span>Arrived</span><span>${CxModel.int(introduced[i])}</span></div>` +
        `<div class="t-row"><span>Closed</span><span>${CxModel.int(cleared[i])}</span></div>` +
        `<div class="t-row t-total"><span>Net</span><span>${CxModel.signed(
          introduced[i] === null || cleared[i] === null ? null : introduced[i] - cleared[i])}</span></div>`);
      $('chart-flow').innerHTML = CxCharts.flow({
        id: 'flow', labels, height: 260, tipRows: flowTips,
        groups: [
          { key: 'in', color: flow.introduced, values: introduced },
          { key: 'out', color: flow.cleared, values: cleared },
        ],
      });
      $('legend-flow').innerHTML =
        `<span class="item"><span class="swatch" style="background:${flow.introduced}"></span>New findings (debt rate)</span>` +
        `<span class="item"><span class="swatch" style="background:${flow.cleared}"></span>Findings closed (fix rate)</span>`;

      $('table-history').innerHTML = table(
        ['Week ending', 'Open', 'Arrived', 'Closed', 'Net'],
        weeks.map((week, i) => [
          week,
          CxModel.int(CxModel.sum(SEV.map((s) => R.frames.open[s][i] || 0))),
          CxModel.int(introduced[i]),
          CxModel.int(cleared[i]),
          CxModel.signed(introduced[i] === null || cleared[i] === null ? null : introduced[i] - cleared[i]),
        ]));
    }

    /* ------------------------------------------------------------- the plan -- */

    function renderSliders() {
      $('sev-grid').innerHTML = SEV.map((s) => {
        const backlog = Math.round(stats.bySeverity[s].backlog);
        const row = state.plan[s];
        return `<div class="sev-box">
          <div class="sev-head">${dot(s)}${s}<span class="sev-open">${CxModel.int(backlog)} open</span></div>
          <div class="slider-row"><span>To triage</span><output data-sel-out="${s}">${CxModel.int(row.selected)}</output></div>
          <input type="range" min="0" max="${backlog}" step="${Math.max(1, Math.round(backlog / 500))}"
                 value="${row.selected}" data-sel="${s}" aria-label="Findings to triage for ${s}">
          <div class="slider-row"><span>Est. false positive %</span><output data-fp-out="${s}">${row.fp}%</output></div>
          <input type="range" min="0" max="100" step="1" value="${row.fp}" data-fp="${s}"
                 aria-label="False-positive rate for ${s}">
          <p class="sev-foot" data-cost-out="${s}"></p>
        </div>`;
      }).join('');

      $('sev-grid').querySelectorAll('input[data-sel]').forEach((slider) => {
        slider.addEventListener('input', () => {
          state.plan[slider.dataset.sel].selected = Number(slider.value);
          $('sev-grid').querySelector(`[data-sel-out="${slider.dataset.sel}"]`).textContent =
            CxModel.int(Number(slider.value));
          compute();
        });
      });
      $('sev-grid').querySelectorAll('input[data-fp]').forEach((slider) => {
        slider.addEventListener('input', () => {
          state.plan[slider.dataset.fp].fp = Number(slider.value);
          $('sev-grid').querySelector(`[data-fp-out="${slider.dataset.fp}"]`).textContent = `${slider.value}%`;
          compute();
        });
      });
    }

    function syncSliders() {
      SEV.forEach((s) => {
        const row = state.plan[s];
        const sel = $('sev-grid').querySelector(`input[data-sel="${s}"]`);
        const fp = $('sev-grid').querySelector(`input[data-fp="${s}"]`);
        if (sel) { sel.value = String(row.selected); $('sev-grid').querySelector(`[data-sel-out="${s}"]`).textContent = CxModel.int(row.selected); }
        if (fp) { fp.value = String(row.fp); $('sev-grid').querySelector(`[data-fp-out="${s}"]`).textContent = `${row.fp}%`; }
      });
    }

    function setPlan(mutate) {
      SEV.forEach((s) => mutate(s, state.plan[s], Math.round(stats.bySeverity[s].backlog)));
      state.plan = CxModel.clampPlan(state.plan, stats);
      syncSliders();
      compute();
    }

    /* ------------------------------------------------------------ the numbers -- */

    function compute() {
      cost = CxModel.cost(state.plan, stats, R.assumptions);

      const ceiling = Math.max(10, stats.total.debtRate * 2, stats.total.fixRate * 2, cost.count / 13, 1);
      const paceMax = Math.ceil(ceiling / 10) * 10;
      const paceInput = $('pace');
      paceInput.max = String(paceMax);
      paceInput.step = String(Math.max(1, Math.round(paceMax / 200)));
      paceInput.value = String(Math.min(state.pace, paceMax));
      state.pace = Number(paceInput.value);

      forecast = CxModel.forecast({
        backlog: stats.total.backlog,
        debtRate: stats.total.debtRate,
        selected: cost.count,
        pace: state.pace,
        horizonWeeks: state.horizon,
        startWeek: stats.lastWeek,
      });

      renderSummary();
      renderMatrix();
      renderForecast();
    }

    function renderSummary() {
      $('summary-row').innerHTML = `
        <div class="kpi accent">
          <div class="label">Forecast cost</div>
          <div class="value">${CxModel.compact(cost.total)}</div>
          <div class="note">${CxModel.int(cost.total)} Checkmarx credits</div>
        </div>
        <div class="kpi">
          <div class="label">Findings in this plan</div>
          <div class="value">${CxModel.compact(cost.count)}</div>
          <div class="note">${CxModel.int(cost.truePositives)} expected to be real and need a fix</div>
        </div>
        <div class="kpi">
          <div class="label">Time to work through it</div>
          <div class="value small">${cost.count > 0 ? CxModel.weeksAsDuration(forecast.weeksToFinishPlan) : '—'}</div>
          <div class="note">${cost.count > 0
            ? `at ${CxModel.int(state.pace)} findings a week`
            : 'nothing selected yet'}</div>
        </div>`;

      const sevColors = colors();
      cost.rows.forEach((row) => {
        const foot = $('sev-grid').querySelector(`[data-cost-out="${row.severity}"]`);
        if (!foot) return;
        foot.innerHTML = row.selected === 0
          ? 'Not in this plan — no credits.'
          : `<strong>${CxModel.int(row.total)} credits</strong> · ${CxModel.int(row.truePositives)} to fix` +
            (row.deferred > 0 ? ` · ${CxModel.int(row.deferred)} left open` : '');
        foot.style.borderTopColor = sevColors[row.severity];
      });
    }

    function renderMatrix() {
      const head = ['Severity', 'Open', 'To triage', 'FP %', 'True positives',
        'Triage credits', 'Remediation credits', 'Total credits'];
      const rows = cost.rows.map((r) => [
        `${dot(r.severity)}${r.severity}`,
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
      const scenario = scenarioColors();
      const labels = forecast.weeks.map((w) => CxCharts.shortDate(w.date));
      const series = [
        { key: 'nothing', color: scenario.nothing, dashed: true,
          values: forecast.weeks.map((w) => w.noAction), endLabel: CxModel.compact(forecast.endNoAction) },
        { key: 'plan', color: scenario.target,
          values: forecast.weeks.map((w) => w.withPlan), endLabel: CxModel.compact(forecast.endWithPlan) },
      ];
      const tips = forecast.weeks.map((w) =>
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

      $('pace-out').textContent = CxModel.int(state.pace);
      $('horizon-out').textContent = String(state.horizon);

      if (forecast.scope <= 0) {
        $('forecast-note').innerHTML =
          'Nothing is selected, so this plan costs nothing and moves nothing — the backlog keeps taking ' +
          `<strong>${CxModel.int(forecast.arrivals)}</strong> new findings a week. ` +
          'Move a slider above to build a plan.';
        return;
      }

      const holds = forecast.pace >= forecast.arrivals;
      $('forecast-note').innerHTML =
        `<strong>${CxModel.int(forecast.pace)} findings a week</strong> works through the ` +
        `${CxModel.int(forecast.scope)} selected above in <strong>${CxModel.weeksAsDuration(forecast.weeksToFinishPlan)}</strong>, ` +
        `for <strong>${CxModel.int(cost.total)} credits</strong>. ` +
        (holds
          ? `That also outruns the ${CxModel.int(forecast.arrivals)} findings arriving each week, so the whole backlog ` +
            `reaches zero in <strong>${CxModel.weeksAsDuration(forecast.weeksToZero)}</strong>.`
          : `It does not keep up with the ${CxModel.int(forecast.arrivals)} arriving each week, so the backlog keeps ` +
            `growing meanwhile: <strong>${CxModel.int(forecast.paceToHold)} a week</strong> holds the line, and ` +
            'anything above that starts killing the debt.');
    }

    /* ----------------------------------------------------------------- wiring -- */

    $('pace').addEventListener('input', () => { state.pace = Number($('pace').value); compute(); });
    $('horizon').addEventListener('change', () => { state.horizon = Number($('horizon').value); compute(); });
    $('fp-all').addEventListener('input', () => {
      const value = Number($('fp-all').value);
      $('fp-all-out').textContent = `${value}%`;
      setPlan((s, row) => { row.fp = value; });
    });
    $('btn-all').addEventListener('click', () => setPlan((s, row, backlog) => { row.selected = backlog; }));
    $('btn-none').addEventListener('click', () => setPlan((s, row) => { row.selected = 0; }));
    $('btn-ch').addEventListener('click', () => setPlan((s, row, backlog) => {
      row.selected = (s === 'Critical' || s === 'High') ? backlog : 0;
    }));
    $('btn-reset').addEventListener('click', () => {
      state.plan = JSON.parse(JSON.stringify(R.plan));
      state.pace = R.pace;
      $('pace').value = String(R.pace);
      syncSliders();
      compute();
    });
    $('btn-print').addEventListener('click', () => window.print());
    // The weekly table is collapsed on screen; a printed copy should carry it.
    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
    });
    $('btn-theme').addEventListener('click', () => {
      document.documentElement.setAttribute('data-theme', theme() === 'dark' ? 'light' : 'dark');
      renderKpis();
      renderHistoryCharts();
      renderSliders();
      compute();
    });

    renderKpis();
    renderHistoryCharts();
    renderSliders();
    compute();
    CxCharts.bind(document);
  },

  /* ---------------------------------------------------------------- build -- */

  build(context) {
    const esc = CxCharts.esc;
    const customer = context.customer || 'Your organisation';
    const generatedLabel = new Date(context.generatedAt).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const logo = context.logoDataUrl
      ? `<img src="${esc(context.logoDataUrl)}" alt="${esc(customer)}">`
      : CxBrand.logoSvg(34);

    /* The Filters tab arrives as {field, operator, value} rows, not a string. */
    const filterLabel = (filters) => {
      if (!Array.isArray(filters) || !filters.length) return '—';
      return filters
        .map((f) => [f.field, f.operator, f.value].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' · ') || '—';
    };

    const provenanceRows = ['totals', 'fixed'].map((slot) => {
      const meta = (context.provenance && context.provenance[slot]) || {};
      return `<tr><td>${slot === 'fixed' ? 'Fixed vulnerabilities' : 'Total vulnerabilities'}</td>` +
        `<td style="text-align:left">${esc(meta.fileName || '—')}</td>` +
        `<td style="text-align:left">${esc(meta.exportedAt ? String(meta.exportedAt).slice(0, 10) : '—')}</td>` +
        `<td style="text-align:left;white-space:normal">${esc(filterLabel(meta.filters))}</td></tr>`;
    }).join('');

    const body = `
<div class="page">

  <header class="masthead">
    <span class="logo">${logo}</span>
    <div>
      <div class="customer">${esc(customer)}</div>
      <h1>${esc(context.title)}</h1>
      <p class="hint" style="margin:0">
        Findings to ${esc(context.frames.weeks[context.frames.weeks.length - 1])} ·
        ${context.frames.weeks.length} weekly snapshots
      </p>
    </div>
    <div class="meta">
      ${generatedLabel}<br>
      ${context.preparedBy ? `Prepared by ${esc(context.preparedBy)}<br>` : ''}
      ${context.validity ? `Valid until ${esc(context.validity)}<br>` : ''}
      <span class="no-print" style="display:inline-flex;gap:6px;margin-top:8px">
        <button type="button" class="plain" id="btn-theme">◐</button>
        <button type="button" class="plain accent" id="btn-print">Print / save PDF</button>
      </span>
    </div>
  </header>

  <p class="section-title">Where the backlog stands</p>
  <div class="grid four" id="kpis"></div>
  <div class="card" style="margin-top:14px"><p class="headline" id="headline"></p></div>

  <section class="card">
    <header>
      <h2>Open findings over time</h2>
      <span class="sub">Measured from the weekly exports — no projection in this chart.</span>
    </header>
    <div class="chart-wrap" id="chart-backlog"></div>
    <div class="legend" id="legend-backlog"></div>
  </section>

  <section class="card">
    <header>
      <h2>Debt rate against fix rate</h2>
      <span class="sub">Findings arriving each week against findings closed each week, in counts.</span>
    </header>
    <div class="chart-wrap" id="chart-flow"></div>
    <div class="legend" id="legend-flow"></div>
    <details>
      <summary>Show the weekly figures</summary>
      <div class="table-scroll" style="margin-top:12px" id="table-history"></div>
    </details>
  </section>

  <p class="section-title">Choose what to fix</p>
  <section class="card">
    <header>
      <h2>Adjust the plan</h2>
      <span class="sub">Move the sliders. Every figure below follows.</span>
      <span class="locked" style="margin-left:auto">🔒 credit rates are fixed</span>
    </header>
    <div class="sev-grid" id="sev-grid"></div>
    <div class="plan-tools no-print">
      <label class="field">
        <span>Set the false-positive rate for every severity at once: <output id="fp-all-out">—</output></span>
        <input type="range" id="fp-all" min="0" max="100" step="1" value="30">
      </label>
      <div class="plan-buttons">
        <button type="button" class="plain" id="btn-all">Select all</button>
        <button type="button" class="plain" id="btn-none">Select none</button>
        <button type="button" class="plain" id="btn-ch">Critical + High</button>
        <button type="button" class="plain" id="btn-reset">Reset</button>
      </div>
    </div>
  </section>

  <p class="section-title">What it costs in Checkmarx credits</p>
  <div class="grid three" id="summary-row"></div>

  <section class="card" style="margin-top:14px">
    <header>
      <h2>Estimate</h2>
      <span class="sub">Triage = findings selected × ${context.assumptions.triageCredits}.
        Remediation = true positives × ${context.assumptions.remediationCredits}.</span>
    </header>
    <div class="table-scroll" id="table-cost"></div>
  </section>

  <p class="section-title">How fast the debt dies</p>
  <section class="card">
    <header>
      <h2>Backlog forecast</h2>
      <span class="sub">Both futures take the same measured arrival rate. Only the pace differs.</span>
    </header>
    <div class="grid two no-print" style="margin-bottom:8px">
      <label class="field">
        <span>Work through <output id="pace-out">0</output> findings per week</span>
        <input type="range" id="pace" min="0" max="100" step="1" value="${context.pace}">
      </label>
      <label class="field">
        <span>Forecast horizon: <output id="horizon-out">${context.horizon}</output> weeks</span>
        <input type="range" id="horizon" min="8" max="156" step="4" value="${context.horizon}">
      </label>
    </div>
    <div class="chart-wrap" id="chart-forecast"></div>
    <div class="legend" id="legend-forecast"></div>
    <div class="callout" id="forecast-note" style="margin-top:14px"></div>
  </section>

  <p class="section-title">The rate card and the method</p>
  <section class="card">
    <header>
      <h2>Fixed assumptions</h2>
      <span class="locked">🔒 read-only</span>
    </header>
    <div class="table-scroll">
      <table>
        <thead><tr><th style="text-align:left">Item</th><th>Credits</th><th style="text-align:left">Applies to</th></tr></thead>
        <tbody>
          <tr><td>Triage</td><td>${context.assumptions.triageCredits}</td>
            <td style="text-align:left">Every finding you select, true positive or not.</td></tr>
          <tr><td>Remediation</td><td>${context.assumptions.remediationCredits}</td>
            <td style="text-align:left">Only the findings that turn out to be real.</td></tr>
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:12px">
      These two rates are set by Checkmarx and cannot be changed in this report.
      What you can change is the scope: how many findings of each severity to put
      through triage, and what share of them you expect to be false positives.
      A false positive costs its triage credit and stops there.
    </p>
  </section>

  <section class="card">
    <header><h2>Where the data came from</h2></header>
    <div class="table-scroll">
      <table>
        <thead><tr><th style="text-align:left">Export</th><th style="text-align:left">File</th>
          <th style="text-align:left">Exported</th><th style="text-align:left">Filters</th></tr></thead>
        <tbody>${provenanceRows}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:12px">
      Weeks covered: ${esc(context.frames.weeks[0])} to ${esc(context.frames.weeks[context.frames.weeks.length - 1])}
      (${context.frames.weeks.length} weekly snapshots). New findings are derived from the two
      exports as open(t) − open(t−1) + closed(t). The debt and fix rates are
      ${context.lookback}-week averages, in counts of findings.
    </p>
  </section>

  <p class="footnote">
    Generated by the Checkmarx Backlog Cost Calculator on ${generatedLabel}. This
    file carries its own data and runs entirely in your browser — nothing is sent
    anywhere when you move a slider. Figures are forecasts based on the weekly
    exports named above; actual credit consumption depends on real triage outcomes,
    which is exactly what the false-positive sliders let you test.
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
