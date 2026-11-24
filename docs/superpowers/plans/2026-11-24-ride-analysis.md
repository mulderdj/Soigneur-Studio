# Ride Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open any ride (Soigneur, Garmin, intervals.icu, imported .fit) on its own page: the whole ride on one chart, its intervals and planned against actual, endurance, W′bal and durability.

**Architecture:** The account server gets and keeps each ride's FIT file (`GET /api/me/rides/:id/file`); the browser reads it (`readRide`), resamples to 1 s, and analyses it with pure functions in `src/analysis/` that feed the live ride's `SessionStats` for W′bal, matches, NP, zones and bests. A page `<ride-page>` (page `analysis`, hash `#ride=<id>`) shows it on uPlot.

**Tech Stack:** Node built-ins (http, sqlite, zlib) on the server; vanilla JS custom elements, uPlot 1.6.32, Jest 30 + jsdom; node:test for the server.

**Spec:** `docs/superpowers/specs/2026-11-24-ride-analysis-design.md`

## Global Constraints

- No new runtime dependency.
- API keys never reach the browser; server errors carry a `reason`: `not-connected`, `strava`, `refused`, `unreadable`, `not-found`.
- Kept files ≤ 500 MB per rider, oldest fetch removed first; disconnecting a source deletes its kept files.
- Missing values are `null`, never 0, in the analysis; rides without power show no power analysis.
- Tap targets ≥ 44 px, both themes, `npm run check:visual` passes with the ride page.

## Findings from the key check (2026-11-24, the rider's own rides)

- Garmin `GET /download-service/files/activity/<n>` → `application/x-zip-compressed`, one deflated entry `<n>_ACTIVITY.fit`.
- Garmin records use `enhanced_speed` / `enhanced_altitude`; laps present; timestamps decode to ms.
- intervals.icu `GET /api/v1/activity/<n>/fit-file` → FIT (gzip transfer-encoding, fetch decodes it).
- Recording is not always 1 s (Edge smart recording: ~6.6 s) and may lack HR: resample with a hold for short gaps.

## Review Focus

1. **A ride recorded with smart recording (points every few seconds) and a pause:** durations, NP and best efforts are right; the pause is a gap, not a flat line or zeros (Task 2 test).
2. **A ride without power (most outdoor rides):** the page shows HR, speed and elevation and no NaN, empty power cards hidden (Task 4/6 tests).
3. **A source refusing or a Strava-sourced intervals.icu ride:** the page shows the summary and the reason, never a blank page (Task 1 + Task 4 tests).
4. **A Soigneur ride with its workout:** intervals line up with the steps even when the rider paused mid-workout (Task 3 test).
5. **Opening `#ride=<id>` for a ride that doesn't exist:** a plain "ride not found" with a way back (Task 4 test).

---

### Task 1: Getting and keeping ride files (server)

**Files:** Create `server/zip.js`, `server/ride-files.js`; Modify `server/app.js` (mount route), `server/garmin-sync.js` and `server/intervals-sync.js` (expose `download(userId, n)`; delete kept files on disconnect); Test `server/zip.spec.mjs`, `server/ride-files.spec.mjs`; add both to `test:server` in `package.json`.

**Interfaces — Produces:**
- `firstFitInZip(buf) → Buffer|null` (stored and deflated entries via the central directory).
- `createRideFiles({db, garmin, intervals, ownFit, now, capBytes = 500 MB})` with `get(userId, id) → {fit} | {reason, status?}` and `forget(userId, prefix)`; table `ride_files(user_id, id, fit, bytes, fetched_at)`.
- Route `GET /api/me/rides/:id/file` → 200 `application/vnd.ant.fit` or 4xx JSON `{error, reason}`.

- [ ] Tests first: zip stored/deflated/no-.fit/corrupt; route per prefix with fakes (own row, Garmin zip, icu FIT); second request served from the table without calling the source; `not-connected`, `strava` (intervals.icu activity `source: 'STRAVA'` or empty body), `refused` (403), `not-found`; the cap evicts the oldest; `forget('garmin-')` on disconnect. FAIL → implement → PASS → commit `ride files: get and keep each ride's .fit`.

### Task 2: Reading a ride

**Files:** Modify `src/training/fit-records.js`; Test `test/training/fit-records.test.js`

**Interfaces — Produces:** `readRide(view) → {start, sport, samples: [{t, power, heartRate, cadence, speed, distance, altitude}], laps: [{start, end}], steps: [...], recorded: number}`; samples at 1 s from 0 to the last record, a value held across gaps ≤ 15 s, `null` in longer gaps (pauses); `speed`/`altitude` from `enhanced_*` when the plain field is missing. `fitToSamples` keeps its shape (0 defaults) for its callers.

- [ ] Tests first (FIT built with the app's own encoder or a minimal writer in the test): 1 s file; 6 s smart recording (held); a 2-minute pause (nulls); enhanced fields; laps in seconds from the start; garbage → empty. FAIL → implement → PASS → commit `ride files: read a ride at 1 s with laps and pauses`.

### Task 3: The analysis

**Files:** Create `src/analysis/intervals.js`, `src/analysis/ride.js`; Test `test/analysis/intervals.test.js`, `test/analysis/ride.test.js`

**Interfaces — Produces:**
- `intervalsFromSteps(steps, samples)`, `intervalsFromLaps(laps)`, `detectIntervals(samples, ftp)` → `[{start, end, kind: 'work'|'rest', target?, planned?}]`; `pickIntervals({steps, laps, samples, ftp})` in the spec's order.
- `intervalStats(samples, interval, ftp) → {duration, avgPower, np, pctFtp, avgHr, maxHr, avgCadence, avgTarget, onTarget, fade, hrDrift}` (nulls where data is missing; < 20 s: averages only).
- `plannedVsActual(intervals, samples) → [{rep, target, done, diffW, diffPct, status: 'done'|'cut-short'|'skipped'}]`.
- `analyseRide({samples, ftp, wprime, lthr, restHr, steps, laps, summaries}) → {hasPower, hasHr, intervals, reps, wbal: {series, min, matches}, decoupling, ef, powerZones, hrZones, bests: [{seconds, watts, record: 'recent'|'all'|null}], durability: [{kj, best5, best20, fresh5, fresh20}]}` — W′bal, matches, NP, power zones and bests from `SessionStats` fed the samples.

- [ ] Tests first on synthetic rides: 5 × 4 min at 110 % with 3 min rests (steps → 10 intervals; detection finds the 5 reps; planned vs actual done; a rep cut at 90 s → cut-short); a steady 2 h ride with HR drifting 5 % (decoupling ≈ 5 %, EF); a ride without power (no power fields, HR zones only); a pause inside a rep (steps still line up by elapsed time, the pause excluded); durability thresholds reached / not reached. FAIL → implement → PASS → commit `analysis: intervals, planned vs actual, endurance, W′bal, durability`.

### Task 4: The ride page

**Files:** Create `src/views/analysis/ride-page.js`, `src/views/analysis/ride-chart.js`, `src/css/analysis.css`; Modify `src/index.html` (page `analysis`, stylesheet), `src/views/views.js`, `src/views/training/day-dialog.js` (*Analyse ride*), `src/views/activity-list.js` (*Analyse*), `src/sw.js` cache version; Test `test/analysis/ride-page.test.js`

**Interfaces — Consumes:** Tasks 1–3. **Produces:** `openRide(id, from)` (sets `#ride=<id>`, page `analysis`); `<ride-page>` loading the summary at once, then the file (local `activity` store for own rides, else the server), states `loading | ready | error(reason) | not-found`; `<ride-chart>` on `UPlotCard`'s uPlot setup with power (zone colours), target, HR, cadence, W′bal, speed, elevation, interval shading, zoom, `zoomTo(start, end)`.

- [ ] Tests first: the hash opens the ride; back returns to the page it came from; the summary shows before the file; each error reason in plain words with the summary; unknown id → not found with a back button; a ride without power has no power series. FAIL → implement → PASS; browser check with a Soigneur ride and a Garmin ride; commit `analysis: the ride page`.

### Task 5: Intervals and planned against actual

**Files:** Create `src/views/analysis/interval-table.js`; Modify `ride-page.js`, `analysis.css`; Test `test/analysis/interval-table.test.js`

- [ ] Tests first: a row per interval, work reps marked; planned columns only with steps; a row click calls `zoomTo`; phone: cards. FAIL → implement → PASS → commit `analysis: intervals and planned against actual`.

### Task 6: Endurance, W′bal, durability, best efforts, zones

**Files:** Create `src/views/analysis/ride-cards.js`; Modify `ride-page.js`, `analysis.css`; Test `test/analysis/ride-cards.test.js`

- [ ] Tests first: decoupling shown only ≥ 45 min with power and HR; matches listed with time and cost; durability rows only for thresholds reached; record marks; no power → only HR zones and HR cards. FAIL → implement → PASS → commit `analysis: endurance, W′bal, durability, best efforts, zones`.

### Task 7: Docs and visual check

**Files:** `test/visual/check.js` (ride page from fixtures: a Soigneur workout ride and a no-power ride), `docs/walkthrough/` (Ride analysis section + shots), `README.md`, roadmap status.

- [ ] Visual check at every size and theme → PASS; walkthrough capture; commit `analysis: docs and visual check`.
