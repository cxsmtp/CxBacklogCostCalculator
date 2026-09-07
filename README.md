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
4. **Projects the backlog forward** under four paces, with a time-to-zero.
5. **Prices it in Checkmarx credits** — 1 per triage, 3 per remediation, scaled
   by the true-positive rate, because false positives never need a fix.
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

### Pricing

Every finding in the plan is triaged. Only the ones that turn out to be real
are remediated:

```
credits(finding) = triage + truePositiveRate(severity) × remediation
                 = 1      + tp                        × 3          (defaults)
```

So a Critical at 85% true positive costs 3.55 credits and a Low at 40% costs
2.20. All three inputs — both rates and the per-severity true-positive
percentages — are editable in the app and **frozen into the export**.

The true-positive defaults (85 / 75 / 60 / 40 / 10%) are typical AppSec
figures, not measurements. Replace them with the customer's own triage history
the moment there is any; the report states plainly that they are estimates.

### Three plans per severity

This is the lever the customer actually cares about, so it is a first-class
part of the model rather than an on/off switch:

| Mode | Cost | Effect on the backlog |
|---|---|---|
| **Triage + remediate** | `count × (1 + tp × 3)` | the whole line can reach zero |
| **Triage only** | `count × 1` | false positives leave; the real findings stay, by choice |
| **Not in plan** | nothing | nothing |

"Triage only" is what most teams really do with Informational and Low: pay to
disposition them so the noise goes away, and never fund the fixes. Modelling it
honestly means the report can say *"this plan cannot reach zero, and here is the
number it settles at"* instead of implying a clean sweep.

### The forecast

Each severity holds two buckets: findings not yet triaged, and true positives
that were triaged but deliberately left unfixed. Weekly capacity is spent on
the untriaged pile, worst severity first — Critical before High, and so on —
because that is how real remediation programmes are run.

```
open(t) = open(t−1) + introduced − processed
```

Time-to-zero has a closed form, so the answer survives past the charted
horizon:

```
weeksToZero      = backlog / (processing − introduced)      when processing > introduced
requiredProcessing(weeks) = backlog / weeks + introduced
```

Four scenarios are always compared: **do nothing**, **current pace** (the rate
measured in the upload), **your chosen pace**, and **clear it by a deadline**
(which solves for the required rate).

---

## The exported report

One HTML file, typically ~70 KB, that opens from disk with no network.

It embeds the weekly data *and* a serialised copy of the model and chart code,
so it is genuinely live rather than a set of pictures: switch a severity to
triage-only, drop another, move the pace slider, and every total, table and
chart recomputes with exactly the code that produced the numbers in the app.

What is **locked** and rendered read-only: credits per triage, credits per
remediation, and the per-severity true-positive rates. The rate card is stated
in full in an appendix, next to the data provenance — file names, export dates,
and the Checkmarx One filters each export was pulled with.

**Save as PDF** prints it: the segmented controls collapse to plain text, the
interactive furniture disappears, and the tables reflow to the page.

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
assets/js/model.js          rates, cost, forecast, scenarios, budget  (pure)
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
  arrival model would be better for a team whose scan coverage is still growing.
- Capacity is one weekly number shared across severities. Separate triage and
  remediation capacities would model a team where triage is the bottleneck.
- Credit rates are per-action, not per-engine. If SAST, SCA and IaC findings
  price differently for a customer, run the calculator once per engine.
- The credit price field is a convenience multiplier for an indicative currency
  figure. It is not a quote.
