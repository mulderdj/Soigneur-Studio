# Rider model (cycling)

Date: 2026-11-24
Status: design approved as a starting point ("Good starting point. I will evaluate. Can refine after").
Roadmap: subproject 6 (first part).

## Intent

Learn what the rider can do from their rides — best power at many
durations, critical power (CP) and W′ — and use it where the app now
relies on typed-in numbers (W′bal), with a power profile that names
strengths and limiters.

### Goals (the rider's choice: "Power curve + CP/W′", "Power profile")
- Best power at about 20 durations per ride.
- CP and W′ fitted from the last 90 days, with the efforts behind them.
- The rider chooses: **Ask me** (default; a one-tap *Use for W′bal*) or
  **Use automatically** — for W′bal live and in ride analysis. FTP stays
  the rider's own setting.
- The power curve card with the fitted curve over it; a power profile card.

### Later
Durability over time; CP and W′ trends; the running side (subproject 13).

## 1. Durations

`DURATIONS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200]` (s).
- Ride summaries (`src/training/summary.js`) keep `best[d]` for each, from
  the samples (rolling mean maxima); `SUMMARY_VERSION` 2, so own rides are
  read again from their `.fit` (the existing backfill) and resynced.
- intervals.icu rides: `best` for every duration from its power curve
  (server mapping version bumped so stored rides are mapped again).
  Garmin rides: from `maxAvgPower_<d>` where Garmin gives it.
- A duration with no data is `null`; older summaries just lack keys.

## 2. CP and W′ (`src/training/rider-model.js`, pure)

- `meanMaximal(summaries, today, days = 90)` → per duration the best watts
  with the ride (`{watts, id, day, name}`).
- `fitCp(meanMax)`: the 2-parameter model `W = CP·t + W′` by least squares
  on the points from 120 to 1200 s. Valid when: ≥ 3 points, one ≤ 300 s,
  one ≥ 720 s, CP > 0, 5 kJ ≤ W′ ≤ 60 kJ. Returns `{ok, cp, wprime, r2,
  points}` or `{ok: false, missing}` with what is missing in words.
- `effective({fit, settings, ftp, typedWprime})` → the CP and W′ W′bal
  uses, and where they come from (`'model'` or `'settings'`):
  - **auto**: the fit when valid, else FTP and the typed W′;
  - **ask**: what the rider accepted (`settings.use`), else FTP and typed W′.
- `offer({fit, effective})`: the *Use for W′bal* offer when W′ differs by
  > 1 kJ or CP by > 3 %.

## 3. Settings (per rider, this device)

`{mode: 'ask' | 'auto', use: {cp, wprime} | null, table: 'men' | 'women'}`
in the rider's storage (`rider-model-settings.js`).

## 4. W′bal

- `SessionStats` gets a CP separate from FTP (`setCp`); W′bal and matches
  use it (default: FTP, as now).
- The live session (`training-dashboard.js`) and ride analysis
  (`ride-source.js` → `analyseRide({cp, wprime})`) use `effective(…)`.

## 5. Cards (Training)

- **Power curve** (existing): all durations on the log axis; the fitted
  curve `P = CP + W′/t` (2–20 min) as a dashed line; the read-out shows
  the model's value at that duration.
- **CP and W′** (new card `model`): CP, W′, fit quality, the efforts with
  ride and date, CP against FTP, the mode setting (Ask me / Automatically)
  and, in Ask mode, *Use for W′bal* when the offer applies (and *Back to
  my settings* when in use). Without a valid fit: what is missing.
- **Power profile** (new card `profile`): 5 s, 1 min, 5 min (last 90 days)
  and FTP in W/kg, each placed in the classification (men or women,
  chosen on the card): untrained, fair, moderate, good, very good,
  excellent, exceptional, world class — lower bounds per the CTS chart
  based on Allen & Coggan; and one sentence naming the strongest and the
  relative limiter. Without weight: a pointer to Settings.

Both cards are layout cards (`TRAINING_CARDS`), new cards hidden in saved
layouts except via `ADDED_VISIBLE` (both added visible after the power
curve).

## Testing
- Best power at each duration from samples; summaries v2.
- The fit on synthetic curves (known CP/W′ recovered), each invalid case
  and its words; `effective` in both modes; `offer` thresholds.
- Profile categories at the boundaries, both tables; the sentence.
- SessionStats with a CP different from FTP.
- Cards render each state; *Use* and *Back* write settings.
