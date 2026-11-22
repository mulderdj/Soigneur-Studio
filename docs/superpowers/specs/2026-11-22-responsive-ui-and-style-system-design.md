# One responsive interface and a single style system

Date: 2026-11-22
Status: approved in conversation, awaiting review of this written spec

## Intent

Auuki Desktop currently has two interfaces: the new dashboard (`desktop.css`,
only at 1200 × 680 px and up) and the original upstream layout (`flux.css`)
on everything smaller, plus dock mode. They look different, and the upstream
pages (Workouts, Settings) don't match the new parts.

Goal: one interface that works on phone, tablet, desktop and TV, with one
coherent style across every page. The phone is used both for riding (on the
handlebars) and for planning and review, so both need to work well.

This is subproject 1+2 of three. Subproject 3, the Training page (calendar,
progress, form, ride analysis), gets its own spec. It is summarised at the end
only so this design leaves room for it.

### Decisions made

- Drop the upstream layout, `flux.css` and dock mode completely.
- Own CSS (tokens + components) with a fixed scale; no CSS framework.
- Remove the upstream auuki.com account and Settings connections (intervals.icu,
  TrainingPeaks and Strava through upstream). Accounts and connections live only
  in the rider menu, through the self-hosted server. TrainingPeaks goes away.
- The Ride Report tab leaves the Workouts page; it returns as ride analysis
  on the Training page in subproject 3.

### Success criteria

- Every page is usable on a 390 px wide phone, in portrait and landscape, and
  scales up to 4K/TV with no horizontal scrolling.
- The ride screen on a phone in portrait fits one screen without scrolling.
- Every page uses the same tokens and components; page CSS adds no new
  colours, sizes or button styles.
- Bluetooth, ANT+, FIT, workout parsing and running, recording, statistics,
  the account server and sync behave exactly as before.
- The visual check script (see Testing) passes on all pages, sizes and themes.

## 1. Structure and navigation

| Page | Content |
|---|---|
| **Ride** (was Home) | Live metrics, chart, interval and stats panels, workout graph, ride controls |
| **Training** (new) | Calendar, progress, form, ride analysis. Built in subproject 3; here only a placeholder page and its tab. |
| **Workouts** | Library and workout editor |
| **Settings** | Sensors and connections to devices, profile (FTP, weight, W′), preferences, about |

Navigation:

- **Phone:** bottom tab bar with Ride, Training, Workouts, Settings. While a
  ride is running, the bar shows the ride controls (play/pause, lap, stop)
  and the tabs move behind a small menu button so they can't be tapped by
  accident.
- **Tablet and up:** one bottom bar with clock and workout name on the left,
  ride controls in the middle, tabs on the right (as the desktop has today).
- **Rider pill:** top left on every size; opens the rider menu.

## 2. Ride screen layouts

The phone layout is the base; wider layouts add to it. Power is the one
loud element and takes the colour of the current power zone.

**Phone portrait (< 600 px)**, one screen, no scrolling while riding:

1. Slim header: rider pill, connection dots for trainer and HR.
2. Power hero: big number, W/kg, zone name, target power beside it.
3. 2 × 3 metric grid: interval time, elapsed time, heart rate, cadence,
   speed, slope or distance. Tapping a tile cycles what it shows (as the
   switchable tiles do today).
4. Compact chart: last 5 min of power against target, with HR.
5. Workout strip: interval profile with progress marker.
6. Swipeable panel row: This interval → W′ balance → Load → Zones →
   Best efforts, one card at a time, with dots.
7. Bottom bar with ride controls.

**Phone landscape:** power hero on the left, metric grid on the right,
chart across the bottom; panels hidden. Replaces dock mode.

**Tablet (600–1199 px):** power hero and metric grid side by side,
full-width chart, then the panels as a two-column grid that scrolls below.

**Desktop (≥ 1200 px):** as today: metrics and chart left, sidebar with
all panels right.

**4K / TV (≥ 2200 × 1100 px):** the desktop layout scaled up, as today.

All sizes: the wake lock keeps the screen on while riding, and everything
used mid-ride is at least 44 × 44 px.

## 3. Style system

Based on the current dashboard look: dark slate panels, Barlow / Barlow
Condensed, zone colours.

| File | Holds |
|---|---|
| `src/css/tokens.css` | All design values as CSS variables, dark and light |
| `src/css/base.css` | Reset, typography, page shell, bottom bar |
| `src/css/components.css` | Shared components (below) |
| `src/css/ride.css`, `workouts.css`, `settings.css`, `training.css`, `rider-menu.css` | Page layout only |

Tokens:

- Spacing: 4, 8, 12, 16, 24, 32, 48 px
- Type: 12, 14, 16, 20, 24, 32, 48 px, plus display sizes for live numbers
  that scale with the viewport (`clamp()`)
- Radii: 8 (inputs, small buttons), 12 (cards), 999 (pills)
- Colour roles: `bg`, `surface`, `surface-2`, `line`, `ink`, `muted`,
  `accent`, `good`, `warn`, `danger`; power zones 1–7; series colours for
  HR, cadence, W′bal
- Themes: dark by default; light follows the system or the Settings
  switch. Every colour role is defined in both themes.

Components: button (primary, secondary, quiet, danger, icon), card, metric
tile, panel with heading, list row, tabs, segmented control, form field,
toggle, dialog, toast / flash message, badge / pill, empty state.

Rule: page files arrange components; they don't add colours, sizes or
button styles. A missing pattern becomes a component.

Upstream custom elements (`connection-switch`, `source-switch`, workout
list, editor, data views, …) keep their behaviour and markup hooks; only
their styling moves onto these components.

## 4. Migration

Each step leaves the app working and is committed on its own. A page moves
over whole, so no page mixes old and new styling.

1. Tokens, base, components; new page shell and bottom bar.
2. Ride page, all sizes.
3. Settings, including removing the upstream account and connections.
4. Workouts; Ride Report removed.
5. Rider menu onto the shared components.
6. Delete `flux.css`, `desktop.css`, `riders.css`, dock mode, and the
   upstream auth and connection code nothing uses any more.

Removed: upstream layout and `flux.css`; dock mode; auuki.com account and the
Settings connections (intervals.icu, TrainingPeaks and Strava through upstream);
the Ride Report tab.

Kept untouched: Bluetooth, ANT+, FIT, workout parsing and running,
recording, the statistics engine (`src/analytics.js`), the account server,
sync, the simulated rider.

Stored preferences: keys for removed features (dock mode, the upstream login
token) are ignored and removed once. FTP, weight, W′, theme, units, tile
choices and everything per rider carry over.

## 5. Testing

- Existing unit tests keep passing (apart from the 50 inherited upstream
  failures); new logic gets unit tests (e.g. panel swiping, bottom bar
  riding state).
- `test/visual/check.js` (Playwright, kept in the repo) opens every page
  on the dev server with `?simulate` at:
  - phone portrait 390 × 844
  - phone landscape 844 × 390
  - tablet 820 × 1180
  - desktop 1600 × 900

  in dark and light. It fails on console errors, horizontal overflow, tap
  targets under 44 px on phone sizes, and text overflowing its tile. It
  saves a screenshot per page, size and theme.
- A step is done when the check passes for the pages it touched and the
  screenshots have been reviewed. The old CSS is deleted only after every
  page passes.

## Subproject 3, for later (own spec)

Training page: calendar with past rides and planned training; planning by
dragging library workouts onto days, stored per rider and synced, plus
intervals.icu's plan when connected; history from Auuki rides and
intervals.icu activities (which covers Garmin and other linked devices),
de-duplicated; TSS per ride (saved with new rides, read back from `.fit`
for older ones, from intervals.icu for theirs); progress statistics;
fitness / fatigue / form (CTL 42 d, ATL 7 d, TSB) with a forecast from
planned workouts; ride analysis for past rides (power, HR, cadence, W′bal
over time, zones, best efforts, load, plan versus actual), replacing Ride Report.
