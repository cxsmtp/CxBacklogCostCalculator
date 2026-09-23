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

### Pick the timeline

Every rate in the report is measured over a window the user chooses, and the
choices are generated from the data rather than hard-coded:

| Offered | When |
|---|---|
| Since last week | always (two snapshots is enough) |
| 1, 3, 6, 9, 12, 18, 24 months | only when a real snapshot exists that far back |
| All data (*N* weeks) | when the full span isn't already one of the above |

A window the data cannot cover is **not offered**. That matters: the tool this
borrows the idea from always *labelled* its window "6 months" even after
silently falling back to the earliest row it had, which quietly changes what
every number in the matrix means. Here the caption states the actual span —
*"Rates measured from 2026-06-20 to 2026-09-05 — 11 weeks of movement"* — and
the forecast horizon is picked the same way, in months: 3 / 6 / 9 / 12 / 18 / 24.

### The rates, and the base each one is against

A ratio is only as honest as its denominator, so each is named:

```
debtIncrease = (current − prior) / prior          change in the backlog
clearedShare = fixedInWindow / prior              how much of it was cleared
keepUp       = fixedInWindow / introducedInWindow arrivals actually kept up with
```

The first two share a base and can be read together; the third is the only one
with arrivals in the denominator, and the only one that answers *"are we
keeping up"*. Alongside them, the two per-week **counts**:

```
debt rate = introducedInWindow / weeks    new findings arriving each week
fix rate  = fixedInWindow / weeks         findings closed each week
```

The weekly chart plots those counts, never a percentage of the backlog. On the
sample data the backlog grows from ~1.9M to ~2.9M in twelve weeks, and a rate
drawn against that moving base produces an axis running from −44% to 2,065%
with every real week flattened into the floor — the defect this version was
built to fix. The ratio that survives a moving base is stated in words:
*"for every 100 findings that arrive, the team clears 46."*

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

Its shape is deliberately short — five sections and three charts, in the order
a conversation actually goes:

1. **Where the backlog stands** — the timeline picker, four figures, one sentence.
2. **Choose what to fix** — the five slider boxes, each ending in its own
   running credit total. These sit *above* the numbers they drive, so the first
   thing in reach is the thing the customer wants to change.
3. **What it costs** — four summary cards and the matrix.
4. **How fast the debt dies** — the horizon picker, the pace slider, the
   two-line forecast.
5. **The trend behind the numbers** — the two history charts, last, because
   they are evidence rather than the argument.

What is **locked** and rendered read-only: credits per triage and credits per
remediation. They are stated in one line under the matrix, where they explain
the two credit rows directly above them, rather than in an appendix nobody
scrolls to.

### The matrix

Metrics down the side, severities across the top, Total on the right:

| Metric | Critical | High | Medium | Low | Info | Total |
|---|---|---|---|---|---|---|
| Open backlog | | | | | | |
| Debt increase *(window)* | | | | | | |
| Cleared *(window)* | | | | | | |
| Kept up with arrivals *(window)* | | | | | | |
| Selected to triage | | | | | | |
| False positive % | | | | | | |
| True positives (est.) | | | | | | |
| Triage credits | | | | | | |
| Remediation credits | | | | | | |
| **Total credits** | | | | | | |
| Backlog after this plan | | | | | | |

Reading down a column answers *"what does Critical cost"*; reading across a row
answers *"where does the money go"*. Both get asked out loud, and a
severity-per-row table only answers one of them.

"Backlog after this plan" is today's backlog minus what the plan clears — a
reduction, not a backlog at a future date. New findings keep arriving, which is
what the forecast shows; the report says so on the line under the table.

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
  — on the sample data the widest window includes an onboarding spike that
  lifts the debt rate well above the steady-state figure. Narrowing the
  timeline is the lever for that, which is part of why it is a control rather
  than a constant.
- The weekly pace is one number shared across severities, and the forecast
  clears the selected scope without asking which severity goes first. That is a
  simplification: the cost table is exact, the ordering within the plan is not.
- Credit rates are per-action, not per-engine. If SAST, SCA and IaC findings
  price differently for a customer, run the calculator once per engine.
- The false-positive sliders are an estimate the customer owns. Nothing in the
  exports measures them.

---

## Prior art, and what was wrong with it

This replaces a hand-built generator (`Checkmarx Fix Cost Forecaster v7`). Four
things in it were worth keeping, and they are all here: the two sliders per
severity, the month-based timeline picker, the metric-by-severity matrix, and
the framing of debt increase and fix rate as the headline pair.

Six things in it were wrong, and are fixed rather than copied:

1. **Mismatched denominators.** Debt increase was divided by the *opening*
   backlog, fix rate by the *closing* one, and the two were printed as adjacent
   rows — which invites a subtraction that means nothing. Both now share the
   opening backlog, and `keepUp` (fixes ÷ arrivals) is separate and labelled.
2. **"Do nothing" grew at the net rate.** The no-action forecast advanced by
   the average *net* monthly change, which already has historical fixes netted
   out. Doing nothing means not fixing, so the line must grow by arrivals —
   using net understates it by exactly the fix rate the team is sustaining, and
   makes inaction look cheaper than it is.
3. **The same double-count in the per-severity plan**, which subtracted the
   planned fixes from a growth rate that already had fixes removed.
4. **Windows that silently shrank but kept their label.** Asking for 6 months
   with 3 months of data returned 3 months of movement still captioned
   "6 months". Only supported windows are offered now, and the real span is
   printed.
5. **A rate chart on a moving base**, covered above.
6. **Info dropped entirely.** Its severity list stopped at Low, so any
   Informational findings vanished from the backlog total. All five are carried
   here.

Two further differences are choices rather than corrections: credit rates are
one global pair here rather than per-severity (Checkmarx prices triage and
remediation flat), and the sliders apply live rather than behind a per-severity
*Apply* button.
