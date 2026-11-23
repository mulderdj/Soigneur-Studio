# Training Page (3b): intervals.icu History and Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring intervals.icu activities (all sports) and planned workouts onto the Training page, keep the plan the same in Auuki and intervals.icu both ways, and add a `.fit` import fallback.

**Architecture:** The account server owns the intervals.icu connection: a pure mapping module (`server/intervals.js`) turns API data into Auuki ride summaries, a sync module (`server/intervals-sync.js`) fetches activities, power curves and events on a timer and keeps the `plan` table and intervals.icu events in step. The app reads external rides from a new endpoint, de-duplicates them against its own summaries, counts other sports for load only, parses plan entries' `.zwo`, and imports `.fit` files.

**Tech Stack:** Node built-ins (`node:sqlite`, fetch), node:test with a fake intervals.icu HTTP server, vanilla JS custom elements, IndexedDB, Jest + jsdom + fake-indexeddb, the Playwright visual check.

**Spec:** `docs/superpowers/specs/2026-11-23-intervals-icu-training-design.md`

## Global Constraints

- intervals.icu: base `https://intervals.icu` (injectable `intervalsBase`), basic auth `API_KEY:<key>`, athlete `0`.
- Paths: activities `GET /api/v1/athlete/0/activities?oldest=&newest=`; power curve `GET /api/v1/activity/<id>/power-curve`; events `GET /api/v1/athlete/0/events?oldest=&newest=&category=WORKOUT&ext=zwo`; create `POST /api/v1/athlete/0/events?upsertOnUid=true`; update `PUT /api/v1/athlete/0/events/<id>`; delete `DELETE /api/v1/athlete/0/events/<id>`.
- Event body for an Auuki entry: `{uid: 'auuki-<entryId>', category: 'WORKOUT', type: 'Ride', name, start_date_local: '<day>T00:00:00', filename: '<safe name>.zwo', file_contents: <zwo>}`.
- Pacing: ≥ 200 ms between requests (≤ 5/s); on 429 wait `Retry-After` seconds (default 60, capped by option `maxWaitMs` in tests); give up the run after 3 consecutive 429s (resume next run).
- Sync cadence: every 15 min per connected account (option `syncEveryMs`), on `POST /api/me/intervals/sync`, one run per account at a time.
- Activity window: first run 730 days back; later runs from 7 days before the newest stored activity day. Plan window: 14 days back to 90 days ahead.
- Cycling types: `Ride`, `VirtualRide`, `GravelRide`, `MountainBikeRide`, `EBikeRide`, `TrackRide` → `sport: 'cycling'`; others → `type.toLowerCase()`.
- External ride id: `icu-<activity id>`; summary `version` 1, `source: 'intervals'`.
- Duplicate rule (app): drop an external ride if its `auukiRideId` equals an Auuki summary id, or an Auuki summary starts within 120 000 ms and its duration is within 10 % of the external one.
- Plan conflicts: newer change wins — event `updated` (ISO) vs plan row `updated_at`; each entry remembers `intervalsSyncedAt`.
- Non-cycling rides: count in `dailyTss`, weekly hours/TSS/kJ and the calendar; excluded from `powerCurve`, `ftpEstimates`, `zoneTotals`.
- Every task ends with the gate: Jest = exactly the 50 inherited failures; `npm run test:server` passes. Server tests must close their servers in `finally`.

## Review Focus

1. **A ride recorded in Auuki and uploaded to intervals.icu** must show once (Auuki's summary), also when the upload id is unknown on this server (other device). Pinned in Task 4.
2. **Retrying an interrupted plan push** (network error after intervals.icu created the event) must not create a second event: create uses `upsertOnUid` with a stable `uid`. Pinned in Task 3.
3. **The API key is revoked** (401/403) during a sync: the sync stops, the connection is marked "enter the key again" (as uploads do), nothing is deleted locally. Pinned in Task 2.
4. **A `.zwo` from intervals.icu that the parser can't read**: the plan entry still shows (name, day) and can be removed; riding it is not offered. Pinned in Task 5.
5. **Importing the same `.fit` twice, or a `.fit` of a ride already recorded**: no duplicate ride (same start within 2 min → skipped). Pinned in Task 6.

---

### Task 1: Mapping intervals.icu data to Auuki summaries

**Files:** Create `server/intervals.js`, `server/intervals.spec.mjs`; Modify `package.json` (`test:server` includes `server/intervals.spec.mjs`)

**Interfaces — Produces (CommonJS):**
- `sportOf(type: string) -> string`
- `isStub(activity) -> boolean` (no `start_date_local`, or no `moving_time` and no `elapsed_time`)
- `bestFromPowerCurve(curve) -> {5,60,300,1200,3600: number|null}` — accepts `{secs: number[], watts: number[]}`, `{list: [{secs, watts}]}` or `[{secs, watts}]`; takes the watts at exactly 5, 60, 300, 1200 and 3600 s; a window not in the curve → `null`.
- `zonesFromZoneTimes(zoneTimes) -> number[7]` — accepts `[{id: 'Z1', secs}]`, `[secs, …]`; Z1..Z7 in order, extra zones (e.g. sweet spot `SS`) added to Z4 (Sweet Spot in Auuki's zones), missing → 0.
- `toSummary(activity, {powerCurve, auukiRideId}) -> Summary` per the spec table (`day` = `start_date_local.slice(0, 10)`, `start` = `Date.parse(start_date_local)` as local time, `tss` = `icu_training_load ?? null`, cycling only: zones and best).

- [ ] **Step 1: Failing tests** (node:test) with fixture objects: a VirtualRide with all fields → exact summary (sport cycling, day, duration from moving_time, tss, np, ftp, zones from `[{id:'Z1',secs:600},…,{id:'SS',secs:300}]` with SS added to Z4, best from `{secs:[5,60,300,1200,3600], watts:[900,450,320,280,260]}`); a Run → sport `run`, zones all 0, best all null, tss kept; a stub `{id: 'x'}` → `isStub` true; `bestFromPowerCurve` for the three accepted shapes; missing `moving_time` falls back to `elapsed_time`.
- [ ] **Step 2: Run** `node --test server/intervals.spec.mjs` — expected FAIL (module missing).
- [ ] **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `server: map intervals.icu activities to ride summaries`

---

### Task 2: Activity sync and external rides

**Files:** Create `server/intervals-sync.js`, `server/intervals-sync.spec.mjs`; Modify `server/app.js` (create the sync, routes, close), `server/connections.js` (export a `intervalsKey(userId)` accessor and `markIntervalsRevoked(userId)`; `describe()` includes `intervals.sync` status), `package.json` (`test:server` includes the new spec)

**Interfaces:**
- Consumes: Task 1; `connections` table (intervals row `data.apiKey`); `uploads` table (`service='intervals'`, `remote_id`).
- Produces:
  - Table `external_rides (user_id, id, summary TEXT, day TEXT, updated_at INTEGER, PRIMARY KEY (user_id, id))`; table `intervals_sync (user_id PRIMARY KEY, last_run INTEGER, last_error TEXT, stored INTEGER, skipped TEXT /* JSON {source: count} */)`.
  - `createIntervalsSync({db, fetchImpl, base, getKey, onRevoked, options: {syncEveryMs, pauseMs, maxWaitMs, now}})` → `{run(userId) -> Promise<{stored, skipped, events?}>, start(), close(), status(userId)}`; `start()` schedules `run` for every account with an intervals key every `syncEveryMs`; `run` is serialised per account.
  - Routes: `GET /api/me/external-rides?since=<ms>` → `{rides: Summary[], now}` (rides with `updated_at > since`); `POST /api/me/intervals/sync` → `202 {queued: true}` (runs in the background; 409 when not connected); `GET /api/me/connections` → `intervals.sync = {lastRun, stored, skipped, error}`.
- [ ] **Step 1: Failing tests** with a fake intervals.icu (pattern of `connections.spec.mjs`):
  - first run asks `oldest` 730 days back, stores 3 activities as `icu-<id>` (one cycling with power-curve call, one run without power-curve call), skips 2 stubs counted by `source` (`STRAVA: 2`);
  - second run asks `oldest` = newest stored day − 7 days; an edited activity is updated;
  - an activity whose id equals an Auuki upload's `remote_id` gets `auukiRideId`;
  - 429 with `Retry-After: 0` once → waits, then succeeds; three 429s in a row → run ends with `error` set, nothing lost;
  - 401 on the activities call → `onRevoked(userId)` called, status error "intervals.icu no longer accepts the API key. Enter it again.", stored rides kept;
  - `GET /api/me/external-rides?since=` returns only newer rows; another user sees none; `POST /api/me/intervals/sync` without a connection → 409.
- [ ] **Step 2: Run** `node --test server/intervals-sync.spec.mjs` — FAIL.
- [ ] **Step 3: Implement** (requests paced with `pauseMs`, default 200).
- [ ] **Step 4: Run** `npm run test:server` — all PASS.
- [ ] **Step 5: Commit** `server: sync intervals.icu activities into external rides`

---

### Task 3: Plan sync both ways

**Files:** Modify `server/intervals-sync.js`, `server/intervals-sync.spec.mjs`

**Interfaces:**
- Consumes: the `plan` table (`data` JSON of a PlanEntry without `id`; `updated_at`; `deleted`).
- Produces: plan entry data fields `intervalsEventId` (number|null), `intervalsSyncedAt` (ms), `origin` (`'auuki'|'intervals'`), `zwo` (string|null). Option `readOnly` (used by the live check) makes `run()` pull only, never write to intervals.icu. `run()` also syncs the plan (window per Global Constraints) in this order: pull events → create/update/delete entries; push Auuki entries without `intervalsEventId` (create with uid, needs `zwo`; entries without `zwo` are skipped and counted); push changed/deleted linked entries. Server-side plan writes bump `updated_at` so the app's incremental plan sync picks them up.
- [ ] **Step 1: Failing tests:**
  - an intervals.icu event (with `workout_file_base64`) → new plan row: `origin 'intervals'`, `intervalsEventId`, `zwo` = decoded text, `day`, `workout.meta.name` = event name;
  - an Auuki plan row with `zwo` → POST `…/events?upsertOnUid=true` with `uid 'auuki-<id>'`, `start_date_local '<day>T00:00:00'`, `file_contents` = zwo; returned id stored;
  - the same push repeated after a simulated failure (fake returns 500 after creating) → the retry POST carries the same `uid` and the fake holds one event (Review Focus 2);
  - moved in Auuki (row newer) → PUT with new date; moved on intervals.icu (event `updated` newer) → row day changed;
  - deleted in Auuki → DELETE; event gone on intervals.icu → row deleted; both changed → newer wins.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm run test:server` — PASS.
- [ ] **Step 5: Commit** `server: two-way plan sync with intervals.icu`

---

### Task 4: External rides in the app

**Files:** Modify `src/training/history.js` (external rides store, pull, merge), `src/db.js` (IndexedDB version 5 adds store `externalRides`), `src/training/progress.js` (cycling-only filters), `src/training/wiring.js` (ask the server to sync on start: `POST /me/intervals/sync`, then pull), `src/account/sync.js` (pull external rides in `syncNow`); Create `src/training/merge.js`, `test/training/merge.test.js`; Modify `test/training/progress.test.js`, `test/training/history.test.js`

**Interfaces:**
- Produces:
  - `mergeRides(own: Summary[], external: Summary[]) -> Summary[]` (duplicate rule from Global Constraints; result sorted by `start`).
  - `isCycling(summary) -> boolean` (`!summary.sport || summary.sport === 'cycling'`).
  - `history.summaries()` returns `mergeRides(own, external)`; `history.pullExternal()` fetches `/me/external-rides?since=<cursor>` (cursor in rider storage `training:externalSince`), stores into `externalRides`, dispatches `training:changed`.
  - `powerCurve`, `ftpEstimates`, `zoneTotals` ignore non-cycling summaries; `weeklyVolume`, `weekCompare`, `dailyTss` include them.
- [ ] **Step 1: Failing tests:** `mergeRides` drops an external with matching `auukiRideId`; drops one starting 90 s later with duration 3% different (Review Focus 1, no upload id); keeps one starting 90 s later but 30 % longer; keeps two different rides on the same day. Progress: a 2 h run adds to weekly hours and TSS but not to zones, power curve or FTP estimates. History: external rides pulled with a fake api appear in `summaries()` merged, and a second pull uses the cursor.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `training: intervals.icu rides on the Training page`

---

### Task 5: intervals.icu plan entries in the app

**Files:** Modify `src/training/history.js` (`connect({parseWorkout, toZwo})`; pulled entries with `zwo` and no `workout` get `parseWorkout(zwo)`; entries added in Auuki store `zwo = toZwo(workout)`), `src/training/wiring.js` (inject `models.workout.parse` and `zwo.write(zwo.fromInterval(w))`), `src/views/training/calendar.js` and `day-dialog.js` (an "intervals.icu" badge for `origin === 'intervals'`; entries whose workout couldn't be parsed show name and day, remove works, no ride option), `src/training/plan.js` (`autoSelectWorkout` skips entries without a workout); Modify `test/training/history.test.js`, `test/training/plan.test.js`, `test/training/views.test.js`

**Interfaces:**
- Produces: PlanEntry fields `origin`, `zwo`, `intervalsEventId`; `addPlanEntry` sets `origin: 'auuki'` and `zwo`.
- [ ] **Step 1: Failing tests:** a pulled entry with a valid `zwo` gets a parsed `workout` and is auto-selected on its day; a pulled entry with an unreadable `zwo` keeps `workout: null`, is listed, can be removed, and is never auto-selected (Review Focus 4); `addPlanEntry` stores `zwo` from the injected writer; the calendar shows "intervals.icu" on such entries.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `training: intervals.icu plan entries, ridable and tagged`

---

### Task 6: `.fit` import

**Files:** Create `src/training/fit-import.js`, `test/training/fit-import.test.js`; Modify `src/views/training/training-page.js` (button + hidden file input, result message), `src/css/training.css`, `server/intervals-sync.js` + `server/intervals-sync.spec.mjs` (route `PUT /api/me/external-rides/:id` for imported rides: id must start with `fit-`, body `{summary}` with `source: 'fit'`; stored in `external_rides`, so every device of the rider gets it through the existing pull)

**Interfaces:**
- Consumes: `fitToSamples`, `rideSummary`, `history.saveSummary`, `history.summaries`.
- Produces: `importFitFiles(files: File[], {ftp, weight}) -> Promise<{added: string[], skipped: string[], unreadable: string[]}>` — summary id `fit-<start>`, `source: 'fit'`; skipped when any existing summary starts within 120 000 ms (Review Focus 5); unreadable when `fitToSamples` gives no samples or no start. Each added summary is saved in the device's `externalRides` store and, when signed in, sent with `PUT /me/external-rides/fit-<start>` (failures are retried on the next sync). The `.fit` itself is not kept.
- [ ] **Step 1: Failing tests:** two encoded `.fit` files → 2 added; the same files again → 2 skipped; a file 60 s after an existing ride → skipped; a broken file → unreadable. Server: `PUT /api/me/external-rides/fit-1` stores and lists it; an id without `fit-` → 400; another user can't see it.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `training: import .fit files`

---

### Task 7: Status, labels and visual check

**Files:** Modify `src/views/rider-menu.js` (intervals.icu card: last sync, activities stored, skipped by source, error), `src/views/training/calendar.js` (sport label for non-cycling rides), `src/dev/history-seed.js` (a few runs and an intervals.icu entry in the generated history), `test/visual/check.js` (nothing new beyond the seed), `README.md`

- [ ] **Step 1: Failing test** (`test/training/views.test.js`): a run on the calendar shows "Run" and its duration; the rider-menu status text for `{lastRun, stored: 412, skipped: {STRAVA: 12}}` reads "412 activities · 12 from Strava weren't available".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5:** `npm run check:visual` (dev server, `?simulate&history`) — PASS at every size and theme; read the Training screenshots.
- [ ] **Step 6: Commit** `ui: intervals.icu status and sport labels`

---

### Task 8: Live check and final verification

- [ ] **Step 1: Stop and ask the user** to paste their intervals.icu API key into the rider menu of the local dev account server (never into chat or files). Then run a read-only sync (option `readOnly: true` skips event writes): log the field shapes of one activity, one power curve and one event; fix the mapping if a shape differs (with a test for the real shape).
- [ ] **Step 2: With the user's go-ahead**, plan one test workout in Auuki for a day next week, run a sync, confirm it appears on intervals.icu, move it on intervals.icu, sync, confirm Auuki follows, delete it in Auuki, sync, confirm it's gone there.
- [ ] **Step 3:** `npx jest`, `npm run test:server`, `npm run build`, `npm run check:visual` — all pass. Commit.
