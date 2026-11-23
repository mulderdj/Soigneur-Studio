# Garmin health data and activities: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: inline, one final reviewer). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Garmin health data and activities on the Training page, and a training load for every workout (power, HR, RPE, estimate).

**Architecture:**
- **Server:** a pure mapping module (`server/garmin.js`) and a sync module (`server/garmin-sync.js`, modelled on `server/intervals-sync.js`). They store into 3b's `external_rides` and a new `wellness` table.
- **App:** the effective load is worked out in `src/training/load-sources.js` and applied in `history.summaries()`. Duplicates are resolved by source priority in `merge.js`. Health data shows in a new `<health-card>`.

**Tech stack:** Node 24 (`node:sqlite`, `node:test`), vanilla JS custom elements, Jest 30 + jsdom + fake-indexeddb, Parcel 2.

**Spec:** `docs/superpowers/specs/2026-11-23-garmin-health-design.md`

## Global Constraints

- **Garmin base:** `https://personal.connectapi.garmin.com` (option `base` in tests).
- **Token:** `POST /personalapitoken-service/personal-api/personal-api-key/token` with the header `Authorization: ApiKey <key>`. The body is a JWT, and its `exp` (seconds) is the expiry. Renew when less than 3600 s is left. Data requests use `Authorization: Bearer <token>`.
- **Pacing:** at least 200 ms between requests (option `pauseMs`); on 429 wait `Retry-After` (capped by `maxWaitMs`); give up after 3 in a row. 401/403 on the token or on data → the connection is removed, and the error message contains "Garmin no longer accepts the API key".
- **Windows:**
  - health: first run 90 days, then from the newest stored day − 3 days, in 28-day requests
  - activities: first run 730 days, then from the newest stored activity day − 7 days, `limit=100` per page
- **Ids:** `garmin-<activityId>`; summary `version` 1, `source: 'garmin'`.
- **Source priority:** own Auuki rides, then `garmin`, then `fit`, then `intervals`.
- **Load:** see the spec §2. `perHour` = {cycling 50, run 60, swim 50, walk 20, hike 35, weighttraining 30, yoga 15, other 40}. Rest heart rate defaults to 60. IF is clamped to [0, 1.2]. RPE load = hours × rpe².
- **Every task ends with the gate:** Jest has exactly the 50 inherited failures, and `npm run test:server` passes.

## Review Focus

1. **A Garmin field missing or renamed** (e.g. no `movingDuration`, `startTimeGMT` absent) → the activity is still stored with what is known and never crashes the run (Task 1 test: a minimal activity).
2. **The key expires mid-sync, or a day's endpoint returns 404/empty** → the other endpoints still fill that day, and a 404 isn't fatal (Task 2 test).
3. **A ride on Garmin and intervals.icu, plus an Auuki recording** → one ride, Auuki's (Task 4 test).
4. **A workout with HR but its sport has no threshold** (e.g. a swim with HR) → falls to rpe/estimate, not to a bogus HR load (Task 3 test).
5. **Clock and timezone:** Garmin's `startTimeLocal` date decides `day`, while `start` comes from `startTimeGMT` with Z (Task 1 test using a late-evening local start).

---

### Task 1: Garmin activity and health mapping (pure)

**Files:** Create `server/garmin.js`, `server/garmin.spec.mjs`; Modify `package.json` (`test:server` gains both new specs).

**Interfaces — Produces:**
- `sportOf(typeKey) -> string`
- `toSummary(activity) -> Summary|null` (null when there is no id and no start)
- `wellnessFrom({hrv, daily, sleep, bodyBattery, stress, weight, vo2}) -> Map<day, data>`, where each argument is a raw response (array or `{data: []}` or null)
- `thresholdsFrom(zonesResponse) -> {cycling, running}`
- `WINDOW_DAYS = 28`

- [ ] **Step 1: Failing tests:**
  - a road ride maps to `cycling` with tss, np, if, best 5/60/300/1200/3600, 7 power zones, avgHr, maxHr, start (UTC) and day (local)
  - a run maps to `run` with avgHr and null power fields and zeros for zones
  - `strength_training` → `weighttraining`
  - a minimal activity `{activityId: 9, startTimeLocal: '2026-11-20 21:30:00'}` gives `day '2026-11-20'`, `duration 0`, and no throw (Review Focus 1)
  - a late-evening local start keeps its local day (Review Focus 5)
  - `wellnessFrom` merges hrv (`lastNightAvg`, `weeklyAvg`, `baseline.balancedLow/High`, `status`), resting HR, sleep (`sleepTimeSeconds`, `sleepScores.overall.value`), body battery (the day's high), stress (`overallStressLevel`), weight (grams → kg) and vo2max into one record per `calendarDate`
  - `thresholdsFrom` reads `lactateThresholdHeartRateUsed` per sport (`CYCLING`, `RUNNING`, or `DEFAULT` as a fallback for both)
- [ ] **Step 2: Run** `node --test server/garmin.spec.mjs` → FAIL. **Step 3: Implement**, reading every field defensively (several candidate names where third parties disagree). **Step 4:** PASS.
- [ ] **Step 5: Commit** `server: map Garmin activities and health data`

### Task 2: Garmin sync, connection and routes

**Files:** Create `server/garmin-sync.js`, `server/garmin-sync.spec.mjs`; Modify `server/app.js` (create, routes, close, status into connections, `options.garmin`), `server/connections.js` (`garmin` block: connected, expiresOn, sync, thresholds), `server/index.js` (start the timer).

**Interfaces:**
- **Consumes:** Task 1, 3b's `external_rides` table.
- **Produces:**
  - `createGarminSync({db, options}) -> {run(userId), status(userId), start(), close(), routes(route, {fail, validId})}`
  - routes:
    - `PUT /api/me/connections/garmin`
    - `DELETE /api/me/connections/garmin`
    - `POST /api/me/garmin/sync` (409 without a connection, 202 with one)
    - `GET /api/me/wellness?since=` → `{days: [{day, ...data}], now}`

- [ ] **Step 1: Failing tests** (fake Garmin: token endpoint issuing JWTs with an `exp`, data endpoints filtered by date, a 429 switch, a revoke switch, a request log):
  - **connect:** a good key → 200, a token was requested, the status shows connected; a bad key → 400 "Garmin didn't accept this key"
  - **first run:** health requested from today − 90 days in 28-day windows (4 windows, no gaps or overlap); activities from today − 730 days, paged until a page has fewer than 100; stored as `garmin-<id>`; `GET /api/me/external-rides` returns them; `/api/me/wellness` returns merged days
  - **token reuse:** a second run with a token still valid for more than 1 h requests no new token; with less than 1 h left, it requests one
  - **incremental:** later windows start from newest − 3 (health) and newest − 7 (activities); an unchanged activity isn't rewritten (its `updated_at` stays)
  - **one endpoint failing:** a 404 on sleep still stores the HRV for that day; the run reports no fatal error (Review Focus 2)
  - **revoked:** the run's error contains "Garmin no longer accepts the API key"; the connection is removed; rides and wellness stay
  - **429:** one 429 is waited out; three give up with "rate limit"
  - **per user:** a second user sees no rides or wellness; `DELETE` removes the connection
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm run test:server` → PASS.
- [ ] **Step 5: Commit** `server: sync Garmin health data and activities`

### Task 3: A training load for every workout

**Files:**
- Create: `src/training/load-sources.js`, `test/training/load-sources.test.js`
- Modify:
  - `src/training/summary.js` (adds `avgHr`, `maxHr`)
  - `src/training/history.js` (ratings store + sync; `summaries()` applies `effectiveLoad` with ratings, thresholds and wellness)
  - `server/app.js` + `server/app.spec.mjs` (`ride_ratings` table and routes)
  - `src/db.js` (IndexedDB v5 stores gain `wellness`, `rideRatings`)
  - `test/training/history.test.js`

**Interfaces — Produces:**
- `effectiveLoad(summary, {rating, thresholds: {cycling, running}, restingHr}) -> {tss, loadSource}`
- `PER_HOUR`
- `history.rateRide(id, rpe|null)`
- `history.ratings() -> Map`
- `history.connect({thresholds: () => ({cycling, running})})`

- [ ] **Step 1: Failing tests:**
  - power wins
  - intervals.icu with a load → `power`
  - **HR:** avgHr 150, threshold 170, rest 50, 1 h → IF 0.8333, tss ≈ 69.4, `hr`; uses that day's resting HR from wellness when given
  - **a swim with avgHr** → no threshold → `estimate` 50/h (Review Focus 4)
  - **rated 6, 1 h strength** → 36, `rpe`
  - **unrated strength** 1 h → 30, `estimate`
  - IF clamped
  - the rider's threshold beats Garmin's
  - Auuki summary has `avgHr`
  - `summaries()` returns `tss` effective plus `loadSource` and `rawTss`
  - ratings sync (push then pull) through a fake api
  - **server:** ratings routes store per user, `rpe` outside 1–10 → 400
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS (+ gate).
- [ ] **Step 5: Commit** `training: a load for every workout (power, HR, RPE, estimate)`

### Task 4: Sources, duplicates and health data in the app

**Files:** Modify `src/training/merge.js`, `src/training/history.js` (`pullWellness()`, `wellnessDays()`, `pullExternal` also pulls wellness), `src/training/wiring.js` (Garmin sync request on start, thresholds from settings + Garmin), `src/account/sync.js`; tests in `test/training/merge.test.js` and `test/training/history.test.js`.

**Interfaces — Produces:**
- `mergeRides(own, external)` with the priority rule
- `history.wellnessDays() -> Day[]` sorted by day
- `history.garminThresholds()` (cached from `/me/connections`)

- [ ] **Step 1: Failing tests:**
  - garmin + intervals copies of one ride → the garmin one is kept
  - garmin + intervals + an Auuki recording → Auuki only (Review Focus 3)
  - fit + intervals → fit
  - two different rides from garmin and intervals on the same day → both kept
  - wellness pulled with a cursor and stored
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS (+ gate).
- [ ] **Step 5: Commit** `training: Garmin rides and health data in the app`

### Task 5: UI — Garmin card, thresholds, health card, ratings and load tags

**Files:**
- Create: `src/views/training/health-card.js`, `src/training/wellness.js` (`hrvRange(days)`, `hrvState(day, range)`, `restingTrend(days)`)
- Modify:
  - `src/views/rider-menu.js` + `src/css/rider-menu.css` (Garmin card)
  - `src/views/training/training-page.js` (health card)
  - `src/views/training/calendar.js` and `day-dialog.js` (load tags; rating buttons)
  - `src/views/training/format.js`
  - the Settings profile (threshold heart rate inputs, stored per rider)
  - `src/css/training.css`
- Tests: `test/training/wellness.test.js`, `test/training/views.test.js`

- [ ] **Step 1: Failing tests:**
  - `hrvRange` prefers Garmin's baseline, else mean ± SD over 60 days (needs at least 14 days, else null)
  - `hrvState` gives `below`, `in` or `above`
  - the health card renders HRV with its state, resting HR, sleep 7:12 and score, Body Battery; hidden without data
  - calendar items show `HR`, `RPE` or `est.` tags
  - the day dialog's rating buttons call `rateRide(id, n)`
  - `syncCounts`-style Garmin status text: "Synced …: 120 activities · 90 days of health data"
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** PASS (+ gate, build).
- [ ] **Step 5: Commit** `ui: Garmin connection, health card, ratings and load tags`

### Task 6: Seed, docs, visual check

**Files:** `src/dev/history-seed.js` (90 days of wellness, a Garmin strength session without HR, a run with HR only), `test/training/history-seed.test.js`, `README.md`, `docs/walkthrough/README.md` + capture (health card shot), `docs/superpowers/roadmap-2026-11.md` (status).

- [ ] **Step 1:** seed test for wellness and the new sessions → FAIL. **Step 2:** implement → PASS.
- [ ] **Step 3:** `npm run check:visual` at every size and theme → PASS; read the Training screenshots.
- [ ] **Step 4: Commit** `docs: Garmin health and loads; seed`

### Task 7: Live check (needs the rider)

- [ ] **Stop and ask the rider** to paste their Garmin Personal API key into the rider menu of the local dev account server. Never into chat or files.
- [ ] Log the field shapes of one HRV day, one daily summary, one sleep day, one body battery day, one activity and the zones; fix the mapping with a test for each real shape that differs.
- [ ] **Final gate:** Jest, server tests, build and the visual check. Commit.
