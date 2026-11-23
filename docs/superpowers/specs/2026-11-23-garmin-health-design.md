# Garmin: health data and activities (subproject 4)

Date: 2026-11-23
Status: approved in conversation ("Good. Go ahead and implement.")
Branch: `garmin-4`, on top of `intervals-3b` (it uses 3b's external rides, merge rule and hidden rides).

## Intent

The rider uses a Garmin watch that records HRV overnight. Garmin's Personal API (October 2026) lets the account server read the rider's own health data and activities with a key the rider creates. 4 brings both into Auuki:

- health data for a readiness view (the verdict itself is subproject 5)
- Garmin activities as a history source next to intervals.icu

It also makes sure every workout gets a training load, whether it has power, only heart rate, or neither.

### Decisions made with the rider

- For the rider alone now; later for every account holder, each with their own key and a terms note.
- intervals.icu stays (other apps' rides, two-way plan); Garmin is added.
- When the same ride arrives from several sources it counts once: Auuki, then Garmin, then imported `.fit`, then intervals.icu.
- The first health sync goes back 90 days.
- Load fallbacks: power, then heart rate (hrTSS), then the rider's rating (session RPE), then an estimate from sport and duration. Each is marked.

## Garmin Personal API (from Garmin's official client, github.com/garmin/connect-personal-api-python)

- **Base:** `https://personal.connectapi.garmin.com`.
- **Token:** `POST /personalapitoken-service/personal-api/personal-api-key/token` with the header `Authorization: ApiKey <key>`. The body is a JWT whose `exp` is the expiry (24 h at most). Renew one hour before it runs out. There is no refresh token: renewing is the same call.
- **Requests:** `GET` with `Authorization: Bearer <token>`. Read-only.
- **Endpoints used:**
  - HRV: `/hrv-service/hrv/daily/{start}/{end}`
  - daily summaries: `/usersummary-service/v2/dailysummaries?startDate=&endDate=`, `{data: [...]}`, with resting heart rate
  - sleep: `/sleep-service/sleep/dailySleepSummariesByDate?startDate=&endDate=`
  - Body Battery: `/wellness-service/wellness/bodyBattery/reports/daily?startDate=&endDate=`
  - stress: `/usersummary-service/stats/stress/daily/{start}/{end}`
  - weight: `/weight-service/weight/range/{start}/{end}?includeAll=true`
  - VO2max: `/metrics-service/metrics/maxmet/daily/{start}/{end}`
  - heart-rate zones (threshold heart rate per sport): `/biometric-service/heartRateZones/v2`
  - activities: `/activitylist-service/activities/search/activities?start=&limit=&startDate=&endDate=`
- **Unknown until the live check:** response field names (read defensively, confirmed and fixed with tests at the live check), per-call date-range limits (third parties report 28 to 31 days for some daily endpoints, so requests use 28-day windows), and rate limits (pace like intervals.icu: 200 ms apart, wait on 429, give up after 3).
- **Terms:** for the key owner's own use, with tools they run themselves. The key form says so.

## 1. Server

### Connection

- `PUT /api/me/connections/garmin {apiKey, expiresOn?}`:
  - checks the key by getting a token (400 with a clear message when Garmin refuses it)
  - stores `{apiKey, expiresOn}` in `connections` (service `garmin`)
  - starts a sync
- `DELETE /api/me/connections/garmin` removes it. Stored rides and health data stay.
- **Status** in `GET /api/me/connections`, under `garmin`:
  - `connected`
  - `expiresOn`
  - `sync: {lastRun, activities, days, error}`
  - `thresholds: {cycling, running}` (threshold heart rate from Garmin's zones, or null)
- **A refused token (401/403) during a sync:** the connection is removed and the error reads "Garmin no longer accepts the API key (expired or deleted). Create a new one on Garmin Connect and paste it here." Rides and health data stay.

### Sync

- **When:** every 15 minutes per connected account, on `POST /api/me/garmin/sync`, and after connecting. One run per account at a time.
- **Health:**
  - The first run fetches 90 days; later runs fetch from 3 days before the newest stored day (late HRV and sleep fill in).
  - Requests go in 28-day windows.
  - Stored in `wellness (user_id, day, data JSON, updated_at)`, one row per day merged across endpoints. Each day holds:
    - `hrv` (last night's average)
    - `hrvWeekly`
    - `hrvBaseline: {low, high}`
    - `hrvStatus`
    - `restingHr`
    - `sleepSeconds`, `sleepScore`
    - `bodyBattery` (the morning high)
    - `stress` (average)
    - `weight` (kg)
    - `vo2max`
- **Activities:**
  - The first run fetches 2 years; later runs fetch from 7 days before the newest stored activity, paged with `start` and `limit` (100).
  - Stored in `external_rides` with id `garmin-<activityId>` and `source: 'garmin'`. Unchanged activities are skipped (fingerprint, as in 3b).
  - The original `.fit` file is not downloaded in 4. Ride analysis (subproject 7) fetches it when it needs it.
- **Thresholds:** read once per run from the heart-rate-zone settings, keeping the rider's lactate threshold heart rate per sport (cycling and running) when present.

### Activity → ride summary (summary `version` 1, as 3b)

| Field | From (Garmin activity search entry, read defensively) |
|---|---|
| `id`, `source`, `remote` | `garmin-<activityId>`, `'garmin'`, `{source: 'garmin', externalId: activityId}` |
| `sport` | `activityType.typeKey`: road_biking, indoor_cycling, virtual_ride, cycling, mountain_biking, gravel_cycling, track_cycling and e-bike types → `cycling`; running types → `run`; walking → `walk`; hiking → `hike`; swimming types → `swim`; strength_training → `weighttraining`; yoga → `yoga`; others as given |
| `start`, `day` | `startTimeGMT` (UTC), `startTimeLocal` (date part) |
| `duration` | `movingDuration`, else `duration` (seconds) |
| `distance`, `name` | `distance` (m), `activityName` |
| `tss`, `if`, `np`, `avgPower`, `kj` | `trainingStressScore`, `intensityFactor`, `normPower`, `avgPower`, work from `avgPower × duration` (cycling with power only; else null) |
| `best` | `maxAvgPower_5/_60/_300/_1200/_3600` (cycling with power only) |
| `zoneSeconds` | `powerTimeInZone_1…7` when all 7 exist (cycling); else zeros |
| `avgHr`, `maxHr` | `averageHR`, `maxHR` |
| `ftp`, `weight` | the activity's own values when present, else null |

## 2. App

### Load for every workout (`src/training/load-sources.js`)

`effectiveLoad(summary, {rating, thresholds, restingHr})` returns `{tss, loadSource}`, picking the first that applies:

1. **`power`:** `summary.tss` is a number and the summary has power, or it comes from intervals.icu with a load (intervals.icu's own load already falls back to heart rate).
2. **`hr`:** `avgHr` is known and the sport's threshold heart rate is known. `IF = (avgHr − rest) / (threshold − rest)`, clamped to 0–1.2, and `tss = hours × IF² × 100`.
   - `rest` is the rider's resting heart rate on that day from Garmin (nearest earlier day within 7 days), else 60.
   - `threshold` is the rider's setting for the sport (cycling, or running for run/walk/hike), else Garmin's.
3. **`rpe`:** the rider rated the workout 1–10: `tss = hours × rating²`. That is session RPE scaled so that RPE 10 for an hour is 100.
4. **`estimate`:** `hours × perHour[sport]`. Defaults:
   - cycling: 50
   - run: 60
   - swim: 50
   - walk: 20
   - hike: 35
   - weighttraining: 30
   - yoga: 15
   - other: 40

`history.summaries()` applies it: each summary carries `tss` (effective) and `loadSource`, and the original stays in `rawTss`. Auuki's own rides get `avgHr` in their summary from now on, so a ride without a power meter falls back to heart rate. `.fit` imports get it too.

### Ratings

- A one-tap "How hard was it?" (1–10) in the day dialog, for workouts whose load is `rpe` or `estimate`.
- Stored in IndexedDB store `rideRatings` and on the server, table `ride_ratings (user_id, ride_id, rpe, updated_at)`.
- Routes:
  - `GET /api/me/ride-ratings` → `{ratings: {id: rpe}}`
  - `PUT /api/me/ride-ratings/:id {rpe}` (1–10)
  - `DELETE /api/me/ride-ratings/:id`
- Synced with the plan, like hidden rides.

### Sources and duplicates

`mergeRides` keeps Auuki's own rides, then drops external rides that duplicate a ride already kept, in priority order: `garmin`, then `fit`, then `intervals`. Duplicate means the same `auukiRideId`, or an overlap of at least 80 % of the shorter one (3b's rule).

### Health data in the app

- `GET /api/me/wellness?since=` → `{days: [...], now}`, stored in IndexedDB store `wellness` and pulled with the external rides.
- **`<health-card>` on the Training page** (hidden when there's no health data):
  - last night's HRV against the normal range (Garmin's baseline, else the rider's own 60-day mean ± 1 SD), marked *in range*, *below* or *above*
  - resting heart rate against its 30-day average
  - sleep (hours and score)
  - Body Battery
  - a 60-day chart of HRV with the normal-range band, and resting heart rate

### Settings

"Threshold heart rate" for cycling and running in the rider's settings (per rider, on this device, synced as part of the profile when signed in). Empty means Garmin's value, which is shown as a placeholder.

### Rider menu

- **The Garmin card** (Account) gets:
  - "Paste your Personal API key": Garmin Connect web, Settings, Personal API Key
  - an optional "expires on" date
  - the terms note: "For your own use: Garmin's personal key is for the account holder's own data."
  - once connected: the sync status, a warning a week before the key expires, and *Sync now* and *Disconnect*
- *Send to Garmin* stays as it is.

### Calendar and day dialog

Workouts whose load isn't from power show a tag: **HR**, **RPE** or **est.**

## 3. Testing

- **Server (node:test, fake Garmin like 3b's fake intervals.icu):**
  - token exchange and renewal before expiry
  - a refused key removes the connection and keeps the data
  - 90-day health backfill in 28-day windows, then incremental
  - days merged across endpoints
  - activities: 2 years, paged, then incremental, mapped per sport, unchanged ones skipped
  - 429 handling
  - routes per user
  - ratings routes
- **App (Jest):**
  - `effectiveLoad` for every step, including resting heart rate taken from health data and the rider's own threshold winning over Garmin's
  - duplicates across Garmin, `.fit` and intervals.icu
  - ratings change the load and sync
  - the health card (in range / below, no data → hidden)
  - load tags on the calendar
  - Auuki summaries carry `avgHr`
- **Live check:** with the rider's own Garmin key, a run that only reads (all of the API is read-only), to confirm the field names and date-range limits, fixing the mapping with a test for every real shape that differs.
- **Visual check:** the Training page with the health card and load tags at every size and in both themes.

## Out of scope

- The readiness verdict and the plan swap: subproject 5.
- Downloading Garmin `.fit` files: subproject 7.
- Garmin's business programme (OAuth, push) for many users: later, behind the same module boundary (`server/garmin-sync.js`).
- Heart-rate zones as their own progress card.
