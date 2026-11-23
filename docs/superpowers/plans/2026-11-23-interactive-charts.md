# Interactive charts (uPlot) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the rider's earlier choice: inline, one final reviewer). Steps use checkbox (`- [ ]`) syntax.

**Goal:** All six Training-tab charts drawn with uPlot, with read-outs, zoom, linked cursors and click-through to a day.

**Architecture:**
- **What each chart shows** (series, read-out content, click target) comes from pure model functions in `src/views/training/chart-models.js` and `src/training/*.js`. These are tested in Jest.
- **`src/views/training/uplot-chart.js`** turns a model into a uPlot:
  - colours from the design tokens, resize, rebuild on a theme change
  - the read-out box, touch, range buttons, cursor sync, click
- **The six cards** become thin wrappers. The old canvas helpers go away.

**Tech stack:** uPlot 1.6.32 (MIT) bundled by Parcel 2, vanilla custom elements, Jest 30 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-23-interactive-charts-design.md`

## Global Constraints

- **uPlot** `1.6.32` as a `dependency`; `package.json` gets `"targets": {"default": {"context": "browser", "includeNodeModules": true}}`.
- **Colours** only from tokens: `--accent`, `--hr`, `--warn`, `--muted`, `--line`, `--band`, `--zone-1`…`--zone-7`. A theme change (body `class`) rebuilds the charts.
- **Read-out:** an HTML box (`.uc-tip`) next to the cursor, always inside the card (8 px margin), hidden when the pointer leaves.
- **Touch:** a tap or a horizontal slide moves the cursor, and `touch-action: pan-y` keeps vertical scrolling. On touch the read-out shows an "Open day ›" button (when the point has a day). On desktop a click on the plot dispatches `day-open` `{day}`, bubbling, as the calendar does.
- **Ranges:**
  - **Form:** `3m` (default: 90 days back plus the 28-day forecast), `1y`, `all`.
  - **Health:** `1m`, `3m` (default), `all`.
  - **Volume / FTP:** `12w` (default), `1y`.
  - **Zones:** `12w` / `52w` (weeks) or `12m` (months).
  - **Desktop:** drag-x zoom and double-click reset on Form and Health.
- **Cursor sync key** `'days'` for Form and Health only.
- **Power curve:** two series (last 6 weeks, all time) with points, on a log time axis over 5, 60, 300, 1200, 3600 s.
- **The HRV range per night:** Garmin's baseline stored with that night, else mean ± 1 SD over the 60 days before it (at least 14 nights), else none.
- **Every task ends with the gate:** the whole Jest suite passes (0 failures), `npm run test:server` passes, and `npx parcel build` succeeds.

## Review Focus

1. **No data:** a new rider, all charts empty. The cards render an empty state and the read-out never shows "undefined" or NaN (Task 2 test: models with `[]`).
2. **A single day or a single point** (one ride, one health night): uPlot gets an x range of zero width. The chart still draws and the read-out works (Task 3 test: model with one row gives a non-zero x range).
3. **Theme switch or resize while the read-out is open:** no stale box and no duplicate uPlot instances. A rebuild destroys the old one (Task 1 test on the base's `rebuild()` bookkeeping with a stubbed uPlot).
4. **W/kg with no weight on a ride:** the read-out shows "–", not "Infinity" (Task 2 test).
5. **Touch "Open day ›" on a forecast day** opens the day's dialog (planning allowed), but **on the power curve** it opens the ride's day, not the hovered duration (Task 5 test on the click-target model).

---

### Task 1: uPlot in the build and the shared chart base

**Files:**
- Modify: `package.json` (dependency + targets)
- Create: `src/views/training/uplot-chart.js`, `test/training/uplot-chart.test.js`
- Modify: `src/css/training.css` (`.uc-*` styles from the try-out's `.fu-*`)

**Interfaces — Produces:**
- `rangeWindow(xs: number[] (unix s, sorted), range: string, todaySec: number) -> [min, max]` (pure): `3m` = today − 90 days … the last x; `1m` = −30 days; `1y` = −365 days; `12w` / `52w` = the last 12 / 52 entries; `all` = first … last. Always a range at least 1 day wide.
- `tipLeft(cursorX, tipWidth, cardWidth) -> px` (pure): right of the cursor + 14, flipped left when it doesn't fit, clamped to [8, cardWidth − tipWidth − 8].
- `class UPlotCard extends HTMLElement`. Subclasses implement:
  - `model() -> {x, series: [{label, color, width?, dash?, kind?: 'line'|'bars'|'stack', values}], axes?, ranges?, defaultRange?, sync?: 'days', log?: boolean}`
  - `readout(i) -> {title, rows: [{label, color?, value, note?}], more: string[], day?: string}`

  The base handles: build, `rebuild()`, resize, theme, the range buttons (`data-range`), touch, the tip and click → `day-open`.

- [ ] **Step 1: Failing tests:**
  - `rangeWindow` for every range name, including a series of one point (width ≥ 86400 s) and empty xs → `null`
  - `tipLeft` on the left edge, the right edge and the middle
  - `rebuild()` destroys the previous instance (a stub uPlot class injected through `UPlotCard.uPlot = Stub`, counting `destroy()` calls)
- [ ] **Step 2** Run `npx jest test/training/uplot-chart.test.js` → FAIL. **Step 3** Implement (install `uplot@1.6.32`, set targets). **Step 4** PASS + gate.
- [ ] **Step 5: Commit** `charts: uPlot and a shared chart base`

### Task 2: Data the read-outs need

**Files:** Modify `src/training/progress.js`, `src/training/wellness.js`, `src/views/training/form-card.js` (`formModel(data, {pastDays})`); tests in `test/training/progress.test.js`, `test/training/wellness.test.js`, `test/training/form-model.test.js`.

**Interfaces — Produces:**
- `powerCurve(...)`:
  - `.recent.from[i]` and `.allTime.from[i]`: `{id, day, name}|null`, the ride that set each best
  - `.recent.wkg[i]`: null when that ride has no weight
- `ftpEstimates(...)`: each week adds `from: {seconds: 1200|3600, watts, day, name}|null` (the effort that decided it) and `factor` (0.95 for 20 min, 1 for 60 min)
- `weeklyVolume(..., weeks)`: unchanged rows `{week, rides, hours, tss, kj}`; `weeks` may be 52
- `hrvRangeOn(day, days) -> {low, high, source: 'garmin'|'own'}|null`
- `formModel(data, {pastDays = 90 | null})`: `null` means since the first ride

- [ ] **Step 1: Failing tests:**
  - the all-time 20-minute best names its ride and day
  - an equal best keeps the earlier ride
  - W/kg null without weight (Review Focus 4)
  - an FTP estimate from 0.95 × 20 min names that ride; a 60-minute best that beats it names the 60-minute ride
  - `hrvRangeOn`: Garmin's baseline of that night; the 60 days before (not after); null with fewer than 14 nights
  - `formModel` with `pastDays: null` starts at the first ride; empty summaries give rows with zeros, no NaN (Review Focus 1)
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS + gate.
- [ ] **Step 5: Commit** `training: what the chart read-outs need (record rides, FTP source, HRV range per night)`

### Task 3: Form and Health on uPlot

**Files:**
- Create: `src/views/training/chart-models.js` (`formChart(data, range)`, `healthChart(data, range)`), `test/training/chart-models.test.js`
- Modify: `src/views/training/form-card.js` and `health-card.js` (extend `UPlotCard`), `src/views/training/training-page.js` (no spike card)

**Interfaces — Produces:**
- `formChart(data, range) -> {model, readout(i)}`:
  - **series:** fitness, fatigue and form (solid up to today, dashed after), with a 0 line and a today marker
  - **read-out:** "Mon 23 Nov 2026 · forecast"; rows Fitness / Fatigue / Form (+ label); "Load that day: N TSS" or "Planned: name · N TSS" lines; `day`
- `healthChart(data, range) -> {model, readout(i)}`:
  - **series:** HRV, a band from `hrvRangeOn` per day (`low` / `high` series filled between), resting HR
  - **read-out:** HRV + "in / below / above your range (low–high)" or "no range yet"; resting HR; sleep h:mm + score; Body Battery; `day`

The card headline numbers (form numbers, health grid) stay as they are.

- [ ] **Step 1: Failing tests:**
  - the read-out of a past day, a forecast day with two planned workouts, and a day without load
  - a single-row model has a non-zero x range (Review Focus 2)
  - the health read-out on a night with Garmin's baseline (`in`), one below its own 60-day range, and one without a range
  - `day` is set on every read-out
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS + gate + build.
- [ ] **Step 5: Commit** `charts: Form and Health with read-outs, zoom and a shared cursor`

### Task 4: Weekly volume and time in zones

**Files:** `chart-models.js` (`volumeChart(data, option, range)`, `zonesChart(data, by, range)`), `progress-cards.js`, tests.

- **Volume:**
  - bars of the chosen metric
  - read-out "17–23 Nov": Hours h:mm, TSS, kJ, Rides
  - no `day`
- **Zones:**
  - stacked bars per period in `--zone-1…7`
  - read-out: the period, then zone names (Recovery, Endurance, Tempo, Threshold, VO2 max, Anaerobic, Neuromuscular, as the Ride page names them) with h:mm, and the total
  - no `day`
- **Toggles:** the existing metric / period toggles, plus range buttons.

- [ ] **Step 1: Failing tests:**
  - a volume read-out for a week with two rides
  - `52w` gives 52 bars
  - a zones read-out lists only zones with time, then the total
  - months: 12 periods
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS + gate + build.
- [ ] **Step 5: Commit** `charts: weekly volume and time in zones`

### Task 5: Power curve and FTP trend

**Files:** `chart-models.js` (`curveChart(data, unit)`, `ftpChart(data, range)`), `progress-cards.js`, tests.

- **Curve:**
  - log x over [5, 60, 300, 1200, 3600]
  - two lines with points: last 6 weeks (`--accent`), all time (`--muted`)
  - read-out: "20 min", then "Last 6 weeks 268 W · 4 Nov · Sweet spot" and "All time 285 W · 12 Sep · Long ride"
  - `day` = the day of the nearer series' record
- **FTP:**
  - estimated FTP per week, the set FTP dashed
  - read-out: the week, "Estimate 255 W", the source line ("95 % of 268 W over 20 min · 4 Nov"), "Set 250 W"
  - `day` = the source ride's day
  - the nudge button stays

- [ ] **Step 1: Failing tests:**
  - curve read-out values and rides
  - W/kg "–" without weight
  - the click target is the record's day (Review Focus 5)
  - an FTP week without an estimate has the read-out "No 20 or 60-minute effort in the 6 weeks before" and no `day`
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS + gate + build.
- [ ] **Step 5: Commit** `charts: power curve and FTP trend`

### Task 6: Clean-up, crash fix, docs

**Files:**
- Remove the now-unused `ChartElement` / `drawBars` / `drawLines` from `chart.js` (keep `token`)
- `src/views/workout-graph.js`: guard `render()` without a workout
- `test/views/workout-graph.test.js`
- README and walkthrough text + capture (the Training screenshots)
- `docs/superpowers/roadmap-2026-11.md` status

- [ ] **Step 1: Failing test:** `WorkoutGraph.render()` with no workout set doesn't throw (the try-out's phone crash).
- [ ] **Step 2** FAIL → **Step 3** fix → **Step 4** PASS + gate.
- [ ] **Step 5:** `npm run check:visual` at every size and theme → PASS. Read the Training screenshots and recapture the walkthrough shots.
- [ ] **Step 6: Commit** `charts: clean-up, workout graph crash fix, docs`
