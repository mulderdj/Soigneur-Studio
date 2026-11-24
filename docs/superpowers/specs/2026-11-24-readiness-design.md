# Readiness

Date: 2026-11-24
Status: design approved in conversation ("Great. Implement").
Roadmap: subproject 5.

## Intent

Each morning, one clear verdict — *ready*, *take care* or *rest* — with
its reasons, from last night's health data and the rider's training load;
and before a hard planned workout on a take-care or rest day, a one-tap
way to ride it easier, swap it for a recovery spin, or move it.

### Goals (the rider's choice: "Today's state" and "Before you ride")

- A **Readiness** card at the top of the Training page.
- A **note on the Ride page** before a hard planned workout on a take-care
  or rest day, with one-tap changes that can be undone.

### Non-goals (later, on the roadmap)

- After-ride check-in (RPE, feel, soreness).
- Readiness beside each ride in ride analysis.
- A morning HRV measurement with the chest strap.

### Anti-goals

- Nothing in the plan changes without the rider's tap.
- No black-box score: every verdict lists its reasons.

## 1. The verdict (`src/training/readiness.js`, pure)

`readiness({today, days, summaries, plan, ftp}) → {state, reasons, signals, basis}`

- `days`: Garmin health days (`src/training/wellness.js`); last night is the
  day `today` (Garmin files the night under the morning's date), else
  `today − 1`; older data doesn't count as last night.
- Signals:
  - **HRV** against that night's normal range (`hrvRangeOn`): below / in /
    above; and how many nights in a row it has been below.
  - **Resting HR** against its 30-day average: the difference in bpm.
  - **Sleep** in hours; **Body Battery** (morning value).
  - **Form** (fitness − fatigue, `formModel`), and **yesterday's load** (TSS).
- Rules (*Balanced*):
  - **rest** if HRV below its range 2 nights or more in a row; or HRV below
    and resting HR + 5 bpm or more; or sleep < 5 h after a hard day
    (yesterday ≥ 100 TSS);
  - **take care** if one of: HRV below range; resting HR + 3 bpm or more;
    sleep < 6 h; Body Battery < 30; form < −30;
  - **ready** otherwise.
- `reasons`: plain sentences for each signal that counted, worst first; on
  *ready* the good signals ("HRV in your range (52–65)", "slept 7:40").
- `basis`: `'health'` (last night's data present) or `'form'` (none: the
  verdict from form only, with the reason "No health data from last night").

## 2. Hard workouts and easier versions (same module)

- `isHard(workout, ftp)`: ≥ 10 min at or above 88 % FTP, or ≥ 3 min above
  105 %. Step power is a fraction of FTP, or watts when ≥ `WATTS_FROM`.
- `easier(workout, ftp)`: the same workout, every step above 85 % FTP
  brought down to 85 % (units kept), name + " (easier)".
- `recoverySpin()`: 30 min at 52 % FTP, "Recovery spin".
- `nextFreeDay(plan, today)`: the first day after today, within 7, with no
  planned workout; null when there is none.

## 3. Changing a plan entry (`src/training/history.js`)

- `replacePlanWorkout(id, workout)`: the entry gets the new workout (and its
  `.zwo`, so it syncs to intervals.icu); the original workout, `.zwo` and
  name are kept once in `entry.original`.
- `restorePlanWorkout(id)`: back to `entry.original`.
- Moving uses `movePlanEntry` (exists); undo moves it back.

## 4. The Readiness card (Training page)

- At the top: the verdict in its colour (green / amber / red) with a word
  and an icon, the reasons, and today's planned workout ("Planned today:
  VO2 max 5x4 — hard").
- Without health data: the verdict from form, and "Connect Garmin in the
  rider menu for HRV, resting HR and sleep" when Garmin isn't connected.
- A card in the layout (`TRAINING_CARDS`, id `readiness`, sizes as the
  others, default *full* on phone and *wide* on large screens, first).
- **New card in an existing layout:** cards listed in `ADDED_VISIBLE`
  (`readiness`) are inserted visible at their default place when a saved
  layout lacks them (other new cards stay hidden, as before).

## 5. Before you ride (Ride page)

- `<readiness-note>` above the Ride screens, shown when: the workout on the
  Ride page is today's planned workout (plan entry for today, not done),
  it `isHard`, the verdict is *take care* or *rest*, the clock isn't
  running, and the rider hasn't chosen *Not now* today.
- Text: the verdict and its first reason.
- Buttons: *take care* → **Ride it easier**; *rest* → **Recovery spin
  instead**; both → **Move to {day}** (`nextFreeDay`) and **Not now**.
- A change updates the plan entry, loads the changed workout on the Ride
  page (as "Ride this workout" does), and shows **Undo** for 10 s.
- Hidden while riding; never shown for a workout picked by hand that isn't
  today's plan.

## Testing

- Verdict: each rule from synthetic nights; missing data; stale data.
- `isHard`, `easier` (fractions and watts), `recoverySpin`, `nextFreeDay`.
- History: replace and restore keep `original` once; `.zwo` follows.
- Card and note: each state; buttons call the right action; undo; *Not now*.
- Visual check with the dev seed's *take care* morning.
