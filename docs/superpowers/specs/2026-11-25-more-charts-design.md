# More charts

Date: 2026-11-25
Status: approved in conversation ("Can you make all?" — the seven charts
proposed; plus "elevation in dark mode is hard to see").
Roadmap: 7 (ride analysis) and 10 (insights).

## Ride page (per ride)

1. **Rep by rep** — a bar per effort: average power, the target as a line,
   average and max heart rate on a right-hand scale. Efforts are the work
   intervals; for a ride analysed from laps, laps at ≥ 88 % FTP.
2. **Heart-rate recovery** — per effort of ≥ 30 s: heart rate at its end
   (the highest of its last 5 s) and 60 s later; the drop as a bar. Not
   shown when the next 60 s are paused or have no heart rate, or with fewer
   than 2 efforts.
3. **This ride's power curve against the last 90 days** — best power at the
   rider-model durations, this ride against the 90-day best (other rides),
   log time axis; the read-out gives % of the 90-day best.
4. **Power against heart rate** — 30 s averages as points, first half and
   second half of the ride in two colours (drift shows as the second half
   lying higher). Rides of ≥ 20 min with power and heart rate.

## Training page (trends)

5. **Aerobic efficiency** — efficiency factor (NP ÷ average heart rate) of
   steady rides (cycling, ≥ 30 min, power and heart rate, IF ≤ 0.85), with a
   28-day rolling mean. Rising = more power for the same heart rate.
6. **Readiness and performance** — for each steady ride with that
   morning's HRV and its normal range: x = HRV against the middle of the
   range (%), y = the ride's efficiency against the 42-day median before it
   (%). Points, Pearson r and the number of rides; "not enough rides yet"
   under 8. Sleep as a second option for x (hours).
7. **Intensity distribution** — the Time in zones card gets a third option,
   *3 zones*: per week the share of easy (Z1–Z2), middle (Z3–Z5) and hard
   (Z6–Z7) riding, as 100 % stacked bars.

New Training cards are tiles (Edit layout), shown by default in saved
layouts too.

## Elevation

The ride chart's elevation uses the muted ink colour with a translucent fill
(it used the border colour, nearly invisible on the dark theme).

## Testing

Pure functions (`src/analysis/insights.js`) with tests for each chart's
numbers and edge cases (no HR, pauses, laps, too few rides); card tests for
content; the browser check with the dev seed.
