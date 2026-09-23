# Checkmarx Backlog Cost Calculator

Turn two Checkmarx One exports into a credit forecast: what the security-debt
backlog costs to work through, how fast it can be killed, and an interactive
report you can hand to the customer.

Everything runs in the browser. No build step, no dependencies, no network
calls — customer data never leaves the machine it is opened on.

```
open index.html            # or, to enable the bundled sample data:
python3 -m http.server 8080 && open http://localhost:8080/
```

---

## What it does

1. **Takes the customer name** and, optionally, their logo and a "prepared by".
2. **Reads the two weekly exports** — dropped in together or one at a time.
3. **Derives the arrival rate**, which neither export contains, and charts it
   against the fix rate so the gap is unmissable.
4. **Prices a plan in Checkmarx credits** — 1 per triage, 3 per remediation,
   with the false positives paying only the triage credit.
5. **Projects the backlog forward** against doing nothing, with a time-to-zero.
6. **Exports one self-contained interactive HTML file** the customer can play
   with: they change *what* gets fixed, never *what it costs*.

## The two input files

| File | Shape it may arrive in |
|---|---|
| **Total vulnerabilities by severity** — the open backlog at each week end | wide (`Week End Date \| Info \| Low \| Medium \| High \| Critical`) |
| **Fixed vulnerabilities by severity** — what closed during each week | long (`Week End Date \| Severity \| Total Vulnerabilities`) |

Both layouts are detected automatically, in either file, and either way round —
files are routed to the right slot by name and by the `Status = Fixed` filter
row that Checkmarx One writes into the export's *Filters* tab. Severity labels
keep their sort prefixes (`E. Critical`), extra columns are ignored, duplicate
week/severity rows are summed, and `.csv`/`.tsv` work too.

`.xlsx` parsing is done by `assets/js/xlsx-lite.js`, ~250 lines that unzip the
container with the platform's own `DecompressionStream` and read the parts with
`DOMParser`. That is deliberate: no SheetJS, so nothing third-party and nothing
with an open advisory ships inside a tool that handles customer data. It needs
Chrome/Edge 80+, Firefox 113+ or Safari 16.4+.

Two sample files sit in `samples/` — the **Load sample data** button uses them,
which needs the folder served over HTTP rather than opened from disk.

---

## The model

### Deriving what the exports don't say

The exports give a stock (open findings) and a flow (findings closed). The
missing flow — how fast new findings arrive — falls out of conservation:

```
introduced(t) = open(t) − open(t−1) + fixed(t)
```

Everything downstream keys off that number, so the calculator flags the two
ways it can go wrong: weeks present in only one export, and weeks where the
implied arrival rate is negative (which means projects left the scope, or the
two exports were filtered differently — compare their *Filters* tabs).

### The plan: two sliders per severity

Everything the customer decides comes down to two numbers per severity, and
nothing else:

| Slider | What it sets |
|---|---|
| **To triage** | how many of the open findings to put through triage, `0 … open` |
| **Est. false positive %** | how many of those are expected to come back false |

A global control sets the false-positive rate across all five at once, and four
presets — *select all*, *select none*, *Critical + High*, *reset* — cover the
usual opening positions.

That is deliberately narrower than it could be. An earlier version modelled a
tri-state plan per severity (*triage + remediate* / *triage only* / *not in
plan*); it was more expressive and much harder to hold in your head in front of
a customer. A volume slider subsumes "not in plan" — set it to zero — and the
severities that would have been triage-only are better handled by admitting a
high false-positive rate, which is what "triage only" was really encoding.

### Pricing

Every selected finding is triaged. Only the ones that turn out to be real are
remediated:

```
triage       = selected × 1                     (credits per triage)
truePositive = selected × (100 − fp) / 100
remediation  = truePositive × 3                 (credits per remediation)
total        = triage + remediation
```

So 1,000 Criticals at 15% false positive cost `1,000 + 850 × 3 = 3,550`
credits, and the same 1,000 at 60% cost `1,000 + 400 × 3 = 2,200`. Both credit
rates are editable in the app and **frozen read-only into the export** — the
scope is the customer's to negotiate, the rate card is not.

The false-positive defaults (15 / 25 / 40 / 60 / 90%) are typical AppSec
figures, not measurements. They are a starting position for the sliders, and
the report says so.

### The two rates that actually matter

Both headline indicators are **counts per week**, averaged over the chosen
window:

```
debt rate = mean(introduced)      new findings arriving each week
fix rate  = mean(fixed)           findings closed each week
```

They are never expressed as a percentage of the backlog. On the sample data the
backlog grows from ~1.9M to ~2.9M over twelve weeks, and a rate drawn against
that moving base produces an axis running from −44% to 2,065% with every real
week flattened into the floor — which is exactly the defect this version was
built to fix. The one ratio that survives a moving base is `fixRate / debtRate`,
stated in words: *"for every 100 findings that arrive, the team clears 39."*

### The forecast

Two futures on one axis, both in open findings, both taking the same measured
arrival rate:

```
do nothing   open(w) = backlog + debtRate × w
this plan    open(w) = backlog + debtRate × w − cleared(w)
```

where `cleared(w)` accumulates at the chosen weekly pace until the selected
scope is exhausted. Arrivals do not stop because a plan started, so the two
lines run parallel again once the plan finishes; that gap is the point of the
chart.

Time-to-clear has a closed form, so the answer survives past the charted
horizon:

```
weeksToFinishPlan = selected / pace
weeksToZero       = backlog / (pace − debtRate)      when pace > debtRate
paceToHold        = debtRate                          the break-even pace
```

When the pace is below the debt rate the report says so plainly rather than
drawing a line to zero that will never happen.

---

## The exported report

One HTML file, around 55 KB, that opens from disk with no network.

It embeds the weekly data *and* a serialised copy of the model and chart code,
so it is genuinely live rather than a set of pictures: drag a severity's volume
down, admit a higher false-positive rate, move the pace slider, and every
total, table and chart recomputes with exactly the code that produced the
numbers in the app.

Its shape is deliberately short — four sections and three charts:

1. **Where the backlog stands** — four figures and one sentence, then open
   findings over time and debt rate against fix rate.
2. **Choose what to fix** — the five slider boxes, each ending in its own
   running credit total.
3. **What it costs** — three summary cards and one matrix table.
4. **How fast the debt dies** — the pace slider and the two-line forecast.

What is **locked** and rendered read-only: credits per triage and credits per
remediation. The rate card is stated in full in an appendix, next to the data
provenance — file names, export dates, and the Checkmarx One filters each
export was pulled with.

**Save as PDF** prints it: the sliders disappear and leave their values behind
as plain text, the weekly table opens, and the tables reflow to the page.

---

## Design notes

**Brand.** Checkmarx Electric Violet `#6B34FC`, Deep Koamaru `#121185`, Titan
White `#EFEDFF`, per [the brand kit](https://checkmarx.com/brand-kit/).

The mark in `CxBrand.logoSvg()` is a **brand-coloured placeholder, not the
official logo** — the brand-kit assets were unreachable from the environment
this was built in. Either drop the official file in through the *Company logo*
upload (it gets embedded into the report) or replace that one function.

**Chart palettes are computed, not chosen.** Both the severity ramp and the
flow palette were generated in OKLCH and verified against the exact surfaces
the app renders on (`#FFFFFF` light, `#111129` dark):

| | light | dark |
|---|---|---|
| severity, adjacent pairs | CVD ΔE 12.5 · normal ΔE 16.1 | CVD ΔE 12.0 · normal ΔE 15.2 |
| flow, all pairs | CVD ΔE 8.6 · normal ΔE 25.6 | CVD ΔE 12.4 · normal ΔE 21.0 |

Two slots fall below 3:1 against their surface (Medium in light, Info in dark);
both carry the required relief — a legend is always present, values are direct-
labelled, and every chart has a table view under it.

**No chart library.** `assets/js/charts.js` emits SVG strings. That is what
lets the exported report be one self-contained file that works offline.

---

## Layout

```
index.html                  the app
assets/css/app.css          theme tokens, light + dark
assets/js/brand.js          brand colours, validated palettes, logo
assets/js/xlsx-lite.js      dependency-free .xlsx / .csv reader
assets/js/parse.js          both export layouts -> one weekly series
assets/js/model.js          rates, plan, cost, forecast               (pure)
assets/js/charts.js         SVG chart set + shared hover layer        (pure)
assets/js/report.js         builds the self-contained customer report
assets/js/app.js            UI wiring
samples/                    the two sample exports
```

`model.js` and `charts.js` are plain objects of pure, self-referential
functions with no closure state. That is a hard requirement, not a style
choice: `report.js` serialises them with `Function.prototype.toString()` to
embed them in the export. Keep them that way — no imports, no module-scope
variables, and refer to siblings as `CxModel.foo` / `CxCharts.foo`.

## Known limits

- Arrival and fix rates are flat averages over the chosen window. A trended
  arrival model would be better for a team whose scan coverage is still growing
  — on the sample data the window includes an onboarding spike that lifts the
  debt rate well above the steady-state figure.
- The weekly pace is one number shared across severities, and the forecast
  clears the selected scope without asking which severity goes first. That is a
  simplification: the cost table is exact, the ordering within the plan is not.
- Credit rates are per-action, not per-engine. If SAST, SCA and IaC findings
  price differently for a customer, run the calculator once per engine.
- The false-positive sliders are an estimate the customer owns. Nothing in the
  exports measures them.
