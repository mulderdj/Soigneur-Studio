# Interactive charts on the Training tab (uPlot)

Date: 2026-11-23
Status: approach chosen by the rider after a try-out ("looks amazing, make it the default driver for the plots"); the calls marked *(my call)* are proposals, including four settled after a builder check (phone tap, the HRV range per night, Health's default range, no shared zoom).
Branch: `charts-uplot`, on top of `soigneur-12a`. The try-out lives on `spike/uplot-form` and is not merged.

## Intent

The Training tab's charts are pictures: you have to estimate values from them. The rider wants them to answer when pointed at: the numbers behind a line or bar, which ride set a record, which workouts make up the forecast. They also want to zoom into a period. The try-out of the Form chart in uPlot (hover read-out, drag to zoom, double-click to zoom out, touch) is the reference for look and feel.

### Goals

- Every chart on the Training tab gets a read-out on hover (desktop) and on tap or finger-slide (phone).
- Zooming into a period on the day-based charts.
- Clicking a day or a ride's point opens that day's dialog.
- It looks like it does now: the same design tokens, fonts and dark/light themes. The read-out box is styled by our CSS.

### Non-goals

- The Ride page's live chart (it has its own hover read-out).
- The day dialog's small graphs (workout profile, zone bar).
- The calendar.
- Ride analysis charts (subproject 7).

### Anti-goals

- A library look that differs from the rest of the app.
- Charts that only work with a mouse.
- A chart whose read-out says something the data doesn't support.

## Approaches considered

1. **A shared hover layer on our own canvas charts.** No dependency and the same look, but zoom, linked cursors and selection are ours to build.
2. **uPlot** *(chosen)*:
   - small (about 50 KB), fast, MIT licence
   - zoom, cursor sync and points built in
   - colours, fonts and grid are settings, so it takes our tokens
   - the read-out box is our own HTML
   - bars and stacked bars need some custom drawing
3. **Chart.js or ECharts.** Ready-made tooltips, but heavier and a generic look to restyle. The try-out showed uPlot fits.
4. **SVG with the browser's own tooltips.** Plain, slow tooltips, and no crosshair.

## Constraints

- **uPlot 1.6.32**, an npm dependency, bundled by Parcel. `package.json` needs `"targets": {"default": {"context": "browser", "includeNodeModules": true}}`, because `engines.node` made Parcel treat the app as Node code and leave packages unbundled (found in the try-out). Docker builds and the service worker (offline) must keep working.
- **Colours** come from the design tokens (`--accent`, `--hr`, `--warn`, `--muted`, `--line`, `--zone-1…7`, `--band`). A theme change rebuilds the charts.
- **Phones:** uPlot follows the mouse only. A tap or a horizontal finger-slide moves the read-out, and vertical swipes still scroll the page. Drag-to-zoom is desktop-only, so range buttons do the zooming on every device.
- **Jest can't draw on a canvas.** What each chart shows (series, read-out text, click target) is computed in pure functions that are tested. The drawing is checked visually.

## The shared part

`src/views/training/uplot-chart.js`, a base for all six charts:
- builds the uPlot from a model `{x, series, ...}`
- resizes with its card, and rebuilds on a theme change
- **the read-out box:** HTML next to the cursor, kept inside the card, hidden when the pointer leaves
- **touch:** tap and slide
- **range buttons:** on charts that have them, plus drag-to-zoom and double-click to reset on desktop
- **linked cursors:** charts with the same day axis share a cursor (uPlot's `cursor.sync`)
- **clicking a point** dispatches `day-open` with its day, which the Training page already handles. On a phone a tap shows the read-out instead, which then has an **"Open day ›"** button that opens the dialog; on desktop a click on the chart opens it directly *(my call: on a touchscreen a tap is also a click, and opening the dialog at once would hide the read-out)*

The existing `ChartElement` / `drawBars` / `drawLines` go away once nothing uses them.

## The six charts

| Chart | Shown | Read-out | Zoom | Click |
|---|---|---|---|---|
| **Form** | fitness, fatigue, form; the forecast dashed after today; a line at 0 and at today | the day (*· forecast* after today); fitness / fatigue / form with its label; that day's load; on forecast days the planned workouts with TSS | range **3 months / 1 year / all** (*my call*: the default is 3 months back plus the 4-week forecast; "all" is every day since the first ride) | that day's dialog |
| **Health** | HRV with the normal-range band, resting heart rate | the night; HRV against that night's range (in / below / above); resting HR; sleep (h:mm, score); Body Battery | range **1 month / 3 months / all** (default 3 months) | that day's dialog |
| **Weekly volume** | bars per week of hours, TSS or kJ (the existing toggle) | the week ("17–23 Nov"); hours, TSS, kJ, number of rides | toggle **12 weeks / 1 year** *(my call)* | none (a week, not a day) |
| **Power curve** | best power at 5 s, 1, 5, 20 and 60 min, last 6 weeks against all time, in W or W/kg | the duration; for each: the value, its date and the ride's name | none | the ride of the point under the cursor (all-time or last-6-weeks, whichever is nearer) |
| **FTP trend** | estimated FTP per week, the set FTP as a dashed line | the week; the estimate and where it comes from ("95 % of 268 W over 20 min, 4 Nov" or "60 min best 255 W, 12 Oct"); the set FTP | toggle **12 weeks / 1 year** *(my call)* | the ride the estimate comes from |
| **Time in zones** | stacked bars per week or month (the existing toggle) | the period; minutes per zone (zone names) and the total | toggle **12 / 52 weeks** or **12 months** *(my call)* | none |

Further details:
- **Power curve:** *(my call)* drawn as two lines with points on a time axis (5 s … 60 min), the usual way to show a power curve, instead of today's grouped bars.
- **Linked cursors:** Form and Health share a cursor, not their zoom or range: each keeps its own *(my call; simpler, and Form's forecast days have no health data)*. Pointing at a day in one marks it in the other when that day is in view.
- **The HRV normal range per night** *(my call)*: each night is judged against its own range, Garmin's baseline stored with that night, or else the rider's own mean ± 1 SD over the 60 days before it (at least 14 nights). The band follows that range day by day, so with a year in view, a night months ago isn't judged against today's range. `src/training/wellness.js` gains `hrvRangeOn(day, days)` with tests; the card's headline keeps using the latest night.
- **Data the read-outs need that the progress functions don't return yet:**
  - which ride set each best (power curve)
  - which effort an FTP estimate comes from
  - rides per week (volume)

  `src/training/progress.js` returns these alongside the existing values. The summaries already hold each ride's bests and day, so no stored data changes.

## Also in this work

- **Fix:** the Ride page's workout graph crashes when the window resizes before a workout is loaded (`intervalsToGraph` reading `meta.duration` of nothing). Found in the try-out.
- **The walkthrough:** README and screenshots get the new charts.

## Left to the builder

- How stacked and grouped bars are drawn in uPlot (`uPlot.paths.bars`, bands or a draw hook).
- Tick formats and the exact read-out layout within the try-out's style.
- How the range buttons look (the existing segmented control).
- File split per chart.
