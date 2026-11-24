# Running metrics: what they are, how to compute them, what the rider's watch records

Date: 2026-11-24. For roadmap subproject 13 (running). Research only; no code yet.

## 1. What the rider's Garmin runs contain

Checked on two of the rider's 33 Garmin runs (Personal API download, decoded with the app's FIT reader):

| Per second (record) | FIT field | Unit | Present |
|---|---|---|---|
| Speed | `enhanced_speed` | m/s | yes |
| Elevation (barometric) | `enhanced_altitude` | m | yes |
| Distance, GPS position | `distance`, `position_lat/long` | m, semicircles | yes |
| Heart rate | `heart_rate` | bpm | yes |
| Cadence | `cadence` + `fractional_cadence` | **strides**/min (× 2 = steps/min) | yes (≈ 86 → 172 spm) |
| Running power (Garmin, wrist) | `power` | W | yes (≈ 350–370 W) |
| Step length | `step_length` | mm | yes (≈ 1.16–1.23 m) |
| Ground contact time | `stance_time` | ms | yes (≈ 245–255 ms) |
| Vertical oscillation | `vertical_oscillation` | mm | yes (≈ 91–94 mm) |
| Vertical ratio | `vertical_ratio` | % | yes (≈ 7.6–8.0 %) |
| GCT balance | `stance_time_balance` | % | **no** (invalid value: needs an HRM-Pro / HRM 600 chest strap) |

The session also holds averages (power, normalized power, GCT, VO, VR, step length, ascent, calories). Garmin's own training stress is not filled (invalid). Grade-adjusted pace isn't in the file: we compute it.

**Note:** Garmin's running power includes air resistance and reads higher than Stryd's; power-based numbers are only comparable within one device family.

## 2. The metrics

### Pace and grade-adjusted pace (GAP)
- **Pace** = 1 / speed (min/km). Smooth speed over 5–10 s; GPS speed is noisy.
- **GAP**: the flat-ground pace with the same effort. Grade from elevation over distance, smoothed (e.g. a 30–50 m window; barometric elevation is available).
- **Minetti (2002)**, energy cost of running per kg per metre:
  `Cr(g) = 155.4g⁵ − 30.4g⁴ − 43.3g³ + 46.3g² + 19.5g + 3.6` (g = grade as a fraction; 3.6 J/kg/m on the flat).
  GAP factor = `Cr(g) / Cr(0)`; GAP speed = speed × factor. Cheapest grade ≈ −10 %.
- **Strava (2017)** replaced the energy model with one fitted to heart rate: it gives less benefit to steep downhills (below about −20 % the adjustment stops growing). intervals.icu has its own model.
- **Proposal:** Minetti with smoothed grade, clamped to ±30 %, and a floor on the downhill benefit (Strava's finding). Check it against Strava/intervals.icu GAP on the rider's hilly runs (La Buisse) before trusting it.

### Training load for runs
- **rTSS** (TrainingPeaks): like TSS, with **Normalized Graded Pace** (NGP: GAP speed, 30 s rolling, 4th-power mean, as NP) against **threshold pace** (the fastest pace sustainable for about an hour):
  `IF = NGP speed / threshold speed`, `rTSS = hours × IF² × 100`.
- **Power-based** (Stryd RSS): `RSS = 100 × hours × (power / CP)^K`, summed per second; K is not published (forums quote ≈ 2.4). Only sensible with one power source.
- **hrTSS**: what the app already uses for runs (heart rate against the running threshold).
- **Proposal:** rTSS from NGP as the run's load (pace is always there outdoors); hrTSS when there's no GPS (treadmill without speed); keep power-based load for later.

### Thresholds and the rider model (subproject 6, running side)
- **Critical speed (CS) and D′**: the distance–time model `d = CS · t + D′` fitted to 2–4 best efforts between about 3 and 20 minutes (linear regression of distance on time). CS ≈ the highest sustainable steady state; D′ = the distance that can be run above it (the running W′).
- **Threshold pace** ≈ CS, or the best 30–60 min GAP; **running threshold heart rate** already comes from Garmin.
- **D′ balance** during a run: like W′bal, with speed above CS spending D′.
- Best efforts from GAP (not raw pace), so hills don't hide fitness; intervals.icu works the same way.

### Efficiency and durability
- **Efficiency factor (running)**: NGP speed (m/min) ÷ average heart rate (Friel). Higher = fitter, at the same heart rate.
- **Decoupling (Pa:HR)**: GAP speed per heartbeat, second half against first, as on the bike (steady runs ≥ 45 min, first 10 min left out).
- **Running effectiveness** (with power): speed (m/s) ÷ (power / kg); typically about 0.9–1.05; higher = more speed per watt.
- **Durability**: pace or power at the same heart rate after an hour, or late-run GAP against the start.

### Running dynamics (form)
- Cadence (steps/min), step length, ground contact time, vertical oscillation, vertical ratio (VO ÷ step length), GCT balance (strap only).
- Garmin's reference bands (percentiles of Garmin runners, from the Forerunner 965 manual):

  | Band | Cadence | GCT | VO (chest) | VR (chest) |
  |---|---|---|---|---|
  | Purple (> 95 %) | > 183 spm | < 218 ms | < 6.4 cm | < 6.1 % |
  | Blue (70–95 %) | 174–183 | 218–248 | 6.4–8.1 | 6.1–7.4 % |
  | Green (30–69 %) | 164–173 | 249–277 | 8.2–9.7 | 7.5–8.6 % |
  | Orange (5–29 %) | 153–163 | 278–308 | 9.8–11.5 | 8.7–10.1 % |
  | Red (< 5 %) | < 153 | > 308 | > 11.5 | > 10.1 % |

  GCT balance: green 50.7 % L–50.7 % R, orange to 52.2 %, red beyond.
- Most useful as **trends** and **within a run** (form fading late), and against pace (GCT and cadence change with speed).

### Splits, zones, best efforts
- Splits per km (pace, GAP, heart rate, cadence, ascent) and laps.
- Pace zones from threshold pace; heart-rate zones from the running threshold (already); power zones from running CP.
- Best efforts at 400 m, 1 km, 1 mile, 5 km, 10 km, half: fastest segments, raw and GAP.

### Treadmill (indoor)
- No GPS: speed from the treadmill (FTMS Treadmill Data) or a foot pod (RSC); grade from the treadmill's incline, so GAP and NGP still work.
- Treadmill speed calibration varies; a foot pod or Stryd is usually closer. A setting for "treadmill speed is off by x %" helps.

## 3. Proposal for a first version (run analysis on the activity page)

1. Read the running fields from the FIT (above) into samples; cadence in steps/min.
2. Pace, GAP, NGP; splits per km; laps.
3. Run load: rTSS from NGP and threshold pace (from CS or the best 30-min GAP), hrTSS as the fallback.
4. Heart-rate zones (running threshold), pace zones, decoupling and efficiency factor.
5. Running dynamics: averages, the Garmin bands, and how they change over the run.
6. Best efforts (GAP) and, from them, CS and D′ (with the rider model, 6).

Open questions: which GAP model to trust on steep trail descents (check on the rider's trail runs); whether to show Garmin's power at all (device-specific); the threshold pace source until CS can be fitted.

## Sources
- Minetti et al. 2002, J Appl Physiol 93(3):1039–1046 (cost of running on slopes); summaries: fellrnr.com/wiki/Grade_Adjusted_Pace, aaron-schroeder.github.io/reverse-engineering/grade-adjusted-pace.html.
- Strava Engineering, "Improving Grade Adjusted Pace" (2017) and "An Improved GAP Model" (medium.com/strava-engineering).
- TrainingPeaks: "Running Training Stress Score (rTSS) Explained"; "Training Stress Scores (TSS) Explained" (NGP, IF).
- Stryd: "Running Stress Score" (blog.stryd.com, 2017) and help.stryd.com (RSS, critical power).
- "The Measurement and Application of Critical Speed and D′ in Running: A Scoping Review" (PMC13388421); intervals.icu forum, "Towards Grade Adjusted Best Paces and CS/D′ Computation".
- Garmin Forerunner 965 manual, "Running Dynamics" (definitions and colour bands).
- intervals.icu forum, "Working on advanced running metrics (GCT, VO, VR, step length)".
