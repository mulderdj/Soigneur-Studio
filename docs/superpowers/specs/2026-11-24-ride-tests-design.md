# Built-in tests

Date: 2026-11-24
Status: design approved in conversation ("3+12 min and ramp", "Sim, flat
road", "Result screen + offers"; then "If other tests are easy to implement
also take those": sprint, 20 min and 2 × 8 min added).
Roadmap: subproject 9 (first part).

## Intent

The rider's outdoor rides carry no power, so the rider model (6) learns
only from indoor rides, and ERG workouts hold no all-out efforts. Guided
tests on the trainer give the efforts the model and the FTP need, in one
session, with the result offered right after.

### Goals
- Five tests in the Workouts library (category *Test*): **3 + 12 min**,
  **Ramp**, **20 min**, **2 × 8 min**, **Sprint**.
- All-out efforts in **sim mode at 1 %** (power is the rider's); warm-up,
  recoveries and cool-down in ERG.
- A **result screen** when the test ends, with one-tap offers; nothing
  changes without a tap.
- From the CP and W′ card, a way to ride the 3 + 12 min test when an effort
  is missing.

### Later (rest of subproject 9)
Power match, fuelling reminders, lap button, audio cues, calibration
reminders.

## 1. The protocols (`src/tests/protocols.js`)

Each test is a workout object as the app already runs them
(`{id, meta: {name, category: 'Test', subcategory, author, description, test},
intervals: [{duration, steps: [{duration, power | slope, messages}]}]}`),
`meta.test` one of `'3-12' | 'ramp' | '20min' | '2x8' | 'sprint'`. Power is
a fraction of FTP. All-out steps: `{slope: 1}` (sim mode, as the watch
already switches on a slope step). Messages: what comes next, pacing advice
and the time left, at the step's start and at its last 10 s.

| Test | Steps |
|---|---|
| 3 + 12 min | 10 min 0.55 · 2 × (10 s all-out, 2 min 50 s 0.5) · 3 min 0.6 · **3 min all-out** · 30 min 0.5 · **12 min all-out** · 10 min 0.45 (≈ 75 min) |
| Ramp | 5 min 0.46, then 1-min steps from 0.52 up by 0.06 to 2.02 (ERG), then 10 min 0.4 cool-down |
| 20 min | 10 min 0.55 · 3 × 1 min 1.0 with 1 min 0.5 · 5 min 0.5 · 5 min all-out · 10 min 0.5 · **20 min all-out** · 10 min 0.45 |
| 2 × 8 min | 10 min 0.55 · 3 × 1 min 1.0 with 1 min 0.5 · 5 min 0.5 · **8 min all-out** · 10 min 0.5 · **8 min all-out** · 10 min 0.45 |
| Sprint | 10 min 0.55 · 3 × (**10 s all-out**, 3 min 0.45) · 5 min 0.45 |

The existing XML *Ramp Test* is replaced by this Ramp.

## 2. The results (`src/tests/results.js`, pure)

`testResult(test, samples, workout) → {ok, values, reason}` from the ride's
1 s power samples and the workout's step boundaries (the efforts are the
all-out steps, by position).

- **3 + 12**: P3, P12 = average power of the two efforts.
  CP = (P12·720 − P3·180) / 540; W′ = (P3 − CP)·180. Usable only if P3 > P12
  and 5 kJ ≤ W′ ≤ 60 kJ, else a reason ("The 12 min was as hard as the 3 min:
  the 3 min wasn't all-out.", "W′ came out at 72 kJ: …").
- **Ramp**: FTP = 75 % of the best 60 s average in the ramp steps.
- **20 min**: FTP = 95 % of the 20-min average.
- **2 × 8 min**: FTP = 90 % of the mean of the two 8-min averages.
- **Sprint**: peak 1 s and best 5 s power (W, and W/kg with the rider's
  weight).
- An effort with missing samples (under 90 % of its seconds with power)
  gives `{ok: false, reason: 'Not enough power data in the effort.'}`.
- A test stopped before its efforts: `{ok: false, reason: 'The test was
  stopped before …'}`.

## 3. Ramp end

During the Ramp's ramp steps, when power stays below half the target for
10 s in a row, the ramp ends: the workout jumps to its cool-down step
(`watch` moves to the next interval). A pure `rampEnded(powers, targets)`
decides; the wiring calls the watch's existing next-interval action.

## 4. The result screen (`<test-result>` dialog on the Ride page)

Shown when a test workout ends (`workout:done`, or the ride is stopped
after at least the first effort), from the session's samples.
- **3 + 12**: CP and W′, the two efforts, against what W′bal uses now and
  the 90-day model; **Use for W′bal** (`modelSettings.set({use: {cp,
  wprime}})`; in *Automatically* mode it also sets mode *Ask me*, and the
  button says so).
- **Ramp / 20 min / 2 × 8**: the FTP against the current one; **Use as FTP**
  (`ui:ftp-set`).
- **Sprint**: peak and 5 s power, W/kg; no setting changes.
- Not usable: the reason and what to do next time.
- **Close** keeps everything as it was. The ride is saved as any ride, so
  its efforts also enter the 90-day model.

## 5. From the CP and W′ card

When the fit is missing an effort, the card shows **Ride the 3 + 12 min
test**: it loads the test on the Ride page as *Ride this workout* does
(never during a ride).

## Testing

- Protocols: step durations and kinds per test; all-out steps are slope
  steps; total duration.
- Results: each test from synthetic samples, good and bad; the reasons.
- `rampEnded` from synthetic power.
- Dialog: each test's content and buttons (settings and FTP writes); the
  card's button loads the test.
- Browser check with the simulator.
