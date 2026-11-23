# Training page: calendar, plan, form and progress (subproject 3a)

Date: 2026-11-23
Status: approved in conversation, awaiting review of this written spec

## Intent

The Training page (a placeholder since the responsive redesign) becomes the
rider's overview of their training: what they rode, what they plan to ride,
how fit and fresh they are now and in the coming weeks, and whether they
are improving.

This is part 3a of three:

- **3a (this spec):** ride summaries, calendar, plan, form with forecast,
  progress statistics.
- **3b (later):** intervals.icu history and plan on the same calendar (covers
  Garmin and other devices), de-duplication.
- **3c (later):** ride analysis: open any ride for charts, zones, best efforts,
  plan versus actual, comparison with earlier rides of the same workout.

3a must be useful on its own, including for riders without an account.

### Decisions made

- Statistics are computed in the app from small per-ride summaries, using the
  same statistics engine as the live dashboard (`src/analytics.js`).
- Progress shows weekly volume, power curve, FTP trend and time in zones.
- On a day with a planned workout, the Ride page selects it automatically.
- Planning happens in Auuki; the plan is stored per rider and synced through
  the account server.
- No goal or event days for now.

### Success criteria

- A rider with months of rides sees correct fitness, fatigue and form (as
  defined below), a 4-week forecast from their plan, and all four progress
  cards, on phone, tablet and desktop.
- Old rides get summaries automatically (backfill) without the rider doing
  anything; rides whose `.fit` is gone from the device but kept on the account
  server are included.
- Riders without an account keep their full ride history in the Training page,
  even though the device keeps only the last 7 `.fit` files.
- Planning a workout on a day, riding it, and seeing it marked done with
  planned versus actual TSS works end to end.
- The Training page passes the visual check at every size and theme.

## 1. Data

### Ride summary

One per ride:

| Field | Meaning |
|---|---|
| `id` | the ride's id (same as the activity record) |
| `start` | start time, ms since epoch |
| `day` | local calendar day of the start, `YYYY-MM-DD` |
| `name` | workout name or "Free ride" |
| `workoutId` | id of the workout ridden, if any |
| `duration` | ride time as the clock shows it (pauses excluded), s |
| `distance` | m, if known |
| `tss`, `if`, `np`, `avgPower`, `kj` | as computed by `SessionStats`; `null` when the ride has no power |
| `zoneSeconds` | seconds in each of the 7 power zones |
| `best` | best average power for 5, 60, 300, 1200 and 3600 s (`null` where the ride is shorter) |
| `ftp`, `weight` | the values used for these numbers (the rider's settings on that day) |
| `version` | summary format version, for later recomputation |

Rules:

- TSS and zones use the FTP the rider had when the ride was saved. Changing FTP
  later does not change past summaries.
- A ride that crosses midnight belongs to the day it started.
- Rides without power keep duration and distance; their load fields are `null`
  and they count as 0 TSS.

### Where summaries live

- **Device:** a new IndexedDB store `rideSummaries` in the rider's database.
  It is never trimmed (the existing `activity` store keeps only 7 `.fit` files).
- **Account server:** the existing `activities.summary` JSON of each ride gets
  the summary fields. Summaries sync both ways with the rider's rides.

### Backfill

When the Training page opens, every ride without a summary of the current
`version` gets one:

1. rides with a `.fit` on the device: read the `.fit` back into samples;
2. rides only on the account server: download the `.fit`, then as above.

Progress shows on the page ("Reading 23 of 140 rides…"). A `.fit` that can't be
read is skipped and listed once; it doesn't stop the backfill.

### Plan

A plan entry:

| Field | Meaning |
|---|---|
| `id` | uuid |
| `day` | `YYYY-MM-DD` |
| `workout` | a copy of the workout (so removing it from the library doesn't break the plan) |
| `rideId` | the ride matched to this entry, or `null` |
| `updatedAt`, `deleted` | for sync |

Stored on the device per rider (IndexedDB store `plan`) and synced through a new
server table with the same incremental pattern as workouts (deletions
included).

Planned TSS comes from the workout's intervals and the rider's current FTP:
for each interval, `duration × (relative power)² / 36`, ramps using the mean of
the squared power along the ramp. Slope-only intervals without a power target
count as 0.65 relative power. Status of an entry:

- **done**: `rideId` set;
- **missed**: day is before today and no ride matched;
- **planned**: today or later and no ride matched.

## 2. The Training page

Order on a phone, top to bottom. From 600 px wide the same cards form a grid
(calendar spanning the full width; progress cards two per row; from 1200 px the
form card and "this week" sit side by side above the calendar).

### Form card

- Today's **Fitness** (CTL, 42-day exponentially weighted daily TSS),
  **Fatigue** (ATL, 7-day) and **Form** (TSB = yesterday's CTL − yesterday's
  ATL, the TrainingPeaks convention).
- Daily update: `CTL_d = CTL_{d−1} + (TSS_d − CTL_{d−1}) / 42`, ATL the same
  with 7; history starts at 0 on the day of the first ride.
- A label for Form: above +25 "Very fresh", +5 to +25 "Fresh", −10 to +5
  "Neutral", −30 to −10 "Building", below −30 "Overreaching".
- Chart: the last 90 days of CTL, ATL and TSB, and a dashed forecast for the
  next 28 days from planned TSS (days without a plan count as 0).

### Calendar

- Phone: a week list (Monday to Sunday) with previous/next week; "Today" jumps
  back. Tablet and up: a month grid with the same navigation by month.
- Each day shows its rides (name, duration, TSS) and plan entries with their
  status: planned, done (planned versus actual TSS) or missed.
- Tapping a day opens a day dialog: its rides; "Plan a workout" with a
  searchable list of the library; and for each plan entry, move to another day
  or remove.

### This week

Rides, hours, TSS and kJ for the current week (Monday to today) against the
same days of last week.

### Progress

- **Weekly volume:** the last 12 weeks as bars; a segmented control switches
  between hours, TSS and kJ.
- **Power curve:** best power at 5 s, 1, 5, 20 and 60 min, the last 6 weeks
  against all time; switch W or W/kg (W/kg uses each ride's weight).
- **FTP trend:** estimated FTP per week (the higher of 95 % of the best 20 min
  and the best 60 min, over the 6 weeks ending that week) against the FTP the
  rider has set. When the latest estimate differs from the set FTP by more than
  5 %, a note offers "Use 268 W" which updates FTP like the Settings page does.
- **Time in zones:** stacked bars per week (last 12 weeks) or per month (last
  12 months) in the zone colours.

Empty states: no rides yet → one empty state with a hint to ride or load
`.fit` history via the account; fewer than 6 weeks → curves and FTP trend show
what there is.

### Riding the plan

- On app start, and when the day changes while the app is open, if today has a
  plan entry with status *planned*, no ride is running, and the rider hasn't
  picked a workout by hand today, the Ride page selects that workout.
- When a ride is saved, it is matched to the first unmatched plan entry of its
  day with the same workout id, else the first unmatched entry of that day. A
  ride on a day without plan entries stays unmatched.

## 3. Code

```
src/training/
  summary.js       rideSummary(samples, {ftp, weight, start, name, workoutId}) → summary
  fit-records.js   fitToSamples(arrayBuffer) → [{t, power, heartRate, cadence, speed, distance}]
  load.js          dailyTss(summaries), pmc(tssByDay, from, to), forecast(pmcToday, plannedTssByDay, days), formLabel(tsb)
  progress.js      weeklyVolume, powerCurve, ftpEstimates, zoneTotals (pure functions over summaries)
  plan.js          plannedTss(workout, ftp), planStatus(entry, today), matchRide(summary, entries)
  dates.js         localDay(ms), weekStart(day), addDays(day, n) — local calendar days, DST-safe
  history.js       storage (IndexedDB), backfill, sync with the account server
src/views/training/
  training-page.js, form-card.js, calendar.js, day-dialog.js, week-card.js,
  progress-cards.js (canvas charts in the style of the live chart)
src/css/training.css  layout only (tokens and components)
server/app.js     plan table + GET/PUT/DELETE /api/me/plan (incremental, like workouts);
                  PATCH /api/me/activities/:id/summary for backfilled summaries
```

- The ride save path (`models.activity.createFromCurrent`) also writes the
  summary from the live session.
- Development: `?simulate&history` on the dev server fills the current rider
  with 4 months of generated rides and a plan, so the page can be tried and
  checked without real data. Production builds leave it out, like `?simulate`.

## 4. Testing

- Unit tests with known values:
  - `pmc`: constant 100 TSS per day converges CTL towards 100 with the 42-day
    constant; one 100 TSS day gives ATL 100/7 that day; TSB uses yesterday.
  - dates: weeks start Monday in local time; a ride at 23:30 stays on its day;
    days across a DST change are 1 apart.
  - `plannedTss`: 1 h at 100 % FTP = 100; ramps; slope-only intervals.
  - `ftpEstimates`, `powerCurve` (last 6 weeks versus all time), `weeklyVolume`,
    `zoneTotals` over a small fixed set of summaries.
  - `matchRide`: same-workout preference, first-unmatched fallback, no plan.
  - `rideSummary` agrees with `SessionStats` for the same samples;
    `fitToSamples` round-trips a `.fit` the app itself encoded.
- Server tests (node:test): plan sync (create, change, delete, incremental),
  summary PATCH (own rides only).
- Visual check: the Training page with `?simulate&history` at every size and
  theme; the day dialog on phone and desktop.
- Done when unit, server and visual checks pass and the rider has looked at the
  screenshots.
