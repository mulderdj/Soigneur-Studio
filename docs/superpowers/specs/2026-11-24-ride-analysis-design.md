# Ride analysis

Date: 2026-11-24
Status: design approved in conversation; this spec awaits the rider's review.
Roadmap: subproject 7 (was 3c).

## Intent

Open any ride — recorded in Soigneur, from Garmin, from intervals.icu, or
an imported `.fit` — and see what happened in it: the whole ride on one
chart, its intervals against what was planned, and how the body held up
(decoupling, W′bal, durability).

### Goals

- **Every ride source**, in the first version (the rider's choice): one
  path for all of them — the ride's FIT file, read in the browser.
- **The ride page:** its own page under Training (back button, its own
  link), opened from the day dialog (*Analyse ride*) and from *Workouts →
  Your rides*.
- **Contents** (all four chosen by the rider):
  1. the big ride chart and the intervals table,
  2. planned against actual per rep,
  3. endurance: decoupling, efficiency factor, zones, best efforts,
  4. W′bal with matches, and durability.

### Non-goals (later)

- Fitted CP and W′ (roadmap 6): W′bal uses the rider's FTP and W′ for now
  and switches when the model exists.
- Readiness beside the ride (roadmap 5).
- Maps / GPS tracks, comparing two rides, editing intervals by hand.
- Fetching files for rides nobody opens (no bulk download of history).

### Anti-goals

- No second implementation of the statistics on the server: the server
  only gets and keeps files.
- No guessing at missing data: a ride without power shows no power
  analysis rather than zeros.

## Approach

**The server fetches, the browser analyses.** The account server gets a
ride's FIT file from wherever the ride came from and keeps a copy; the
browser decodes it (the existing FIT reader) and computes everything
(pure functions, reusing the live ride's statistics). A Soigneur ride
still stored on the device is analysed without the server.

Rejected: computing on the server (a second copy of the statistics, no
gain at this size).

## 1. Getting a ride's file

`GET /api/me/rides/:id/file` — the ride's id says where it came from:

| id | source | how |
|---|---|---|
| plain (own rides, imported `.fit`) | the `activities` table | the stored FIT |
| `garmin-<n>` | Garmin Personal API | `GET /download-service/files/activity/<n>` → a ZIP; the FIT inside is returned |
| `icu-<n>` | intervals.icu | `GET /api/v1/activity/<n>/fit-file` |

- **Kept:** a new table `ride_files (user_id, id, fit BLOB, fetched_at)`;
  a ride's file is fetched once. Deleting the connection deletes that
  source's kept files. A rider's kept files are capped at 500 MB, oldest
  fetch removed first.
- **Answers:** 200 with the FIT bytes (`application/vnd.ant.fit`), or an
  error with a reason the page shows: `not-connected`, `strava` (intervals.icu
  doesn't hand out rides that came from Strava), `refused` (the source said
  no, with its status), `unreadable` (no FIT in the ZIP, not a FIT file),
  `not-found`.
- **ZIP:** read with Node's `zlib` (stored and deflated entries, central
  directory); the first entry ending `.fit` is used. No new dependency.
- **Tokens:** the existing Garmin token handling and intervals.icu key
  (`server/garmin-sync.js`, `server/intervals-sync.js`); a refused token is
  handled as in sync (only the token endpoint refusing means revoked).
- **First step — check with the rider's real keys** (from the test server's
  database, never printed): one Garmin ride and one intervals.icu ride
  downloaded, the ZIP holds a FIT, the FIT has records with power and heart
  rate. Findings change this section if they differ.

## 2. Reading the file

`fitToSamples` (`src/training/fit-records.js`) grows, staying never-throwing:

- per record: `t` (seconds from the start, from the record's timestamp, so
  pauses are gaps, not compressed), `power`, `heartRate`, `cadence`,
  `speed`, `distance`, `altitude`; a missing value is `null`, not 0
  (the existing callers keep their 0 defaults through a wrapper);
- `laps`: `[{start, end}]` in seconds from the start, from lap messages;
- `sport`, and the workout's steps when the file carries them
  (`workout_step` messages).

## 3. The analysis (`src/analysis/`, pure, tested on its own)

Inputs: the samples, the ride's summary, the rider's FTP, W′, LTHR and
resting HR (as stored), and the planned workout when the ride is linked to
one (plan entry, or the workout recorded with a Soigneur ride).

- **Intervals**, first source that applies:
  1. the workout's steps (Soigneur ride, or a ride linked to a plan entry):
     steps placed on the ride's time line in order from the start;
  2. the file's laps (more than one);
  3. detected from power: 30 s rolling average ≥ 88 % FTP for ≥ 30 s;
     efforts closer than 20 s merge; nothing detected without power.
  Each interval: `{start, end, kind: 'work'|'rest', target?}`.
- **Per interval:** duration, average and normalized power, % FTP,
  average and max HR, average cadence; with a target: average target and the
  share of time within ±5 % of it; fade (2nd half avg power ÷ 1st half − 1);
  HR drift (2nd half avg HR − 1st half). Intervals shorter than 20 s show
  averages only.
- **Planned against actual** (rides with steps): per work rep the target,
  what was done, the difference in W and %; a rep below 50 % of its planned
  duration is marked *cut short*, a missing one *skipped*.
- **Endurance:**
  - decoupling (Pa:HR): (power ÷ HR) second half against first half,
    excluding the first 10 min; only for rides ≥ 45 min with power and HR;
  - efficiency factor: NP ÷ average HR;
  - time in power zones (the app's zones from FTP) and HR zones (from LTHR);
  - best efforts in this ride at 5 s, 1, 5, 20, 60 min, marked when it is the
    rider's best in the last 6 weeks or all time (from the summaries).
- **W′bal:** the live ride's model (`src/analytics.js`) with FTP as CP and the
  rider's W′; a *match* is a drop of ≥ 10 % of W′ from a local high, marked
  at its lowest point; the lowest W′bal and its time.
- **Durability:** best 5 and 20 min after 1,000, 2,000 and 3,000 kJ of
  work against the best 5 and 20 min before (fresh) in the same ride, in %;
  shown only for the thresholds the ride reached.
- Rides without power: intervals from laps only; HR, speed, elevation,
  HR zones and HR drift; power, W′bal and durability are left out.

## 4. The ride page

- **Route:** a page `analysis` in the page group, not in the bottom bar;
  URL hash `#ride=<id>`; back returns to where it was opened from
  (Training or Workouts). Opening the app with that hash opens the ride.
- **Header:** name, date and start time, sport, source badge, duration,
  distance, TSS, IF, NP, average HR; the planned workout's name.
- **The chart** (uPlot, the Training charts' base):
  power (zone colours) and target, HR, cadence, W′bal; speed and elevation
  when outdoors; intervals shaded; a read-out per second; drag to zoom,
  double-click back; series toggles.
- **Intervals table:** one row per interval (work reps highlighted), the
  per-interval figures, and with a plan the planned-vs-actual columns;
  clicking a row zooms the chart to it. On a phone a list of cards.
- **Cards:** Endurance, W′bal and matches, Durability, Best efforts, Zones.
- **States:** loading (the summary shows at once), the error reasons from
  section 1 in plain words with the summary still shown, and *no power*.

## Constraints

- No new runtime dependency (uPlot is already in).
- Tap targets ≥ 44 px, both themes, `npm run check:visual` passes with the
  ride page added (a Soigneur ride with a workout, and an outdoor ride
  without power, from fixtures).
- Every API key stays on the server; the browser never sees one.

## Testing

- Server: the ZIP reader (stored, deflated, no `.fit` entry, corrupt); the
  route per source with fake Garmin and intervals.icu services (200, 404,
  403, Strava stub, token renewal), keeping and the cap.
- FIT reading: timestamps with a pause, laps, nulls, workout steps.
- Analysis: each function on synthetic rides (a 5 × 4 min workout, a
  steady 2 h ride with drift, a ride without power, a ride with a pause).
- Page: renders each state from fixtures; row click zooms; the hash opens
  the ride.
- Live check with the rider's own rides (one of each source).

## Order of work

1. Server: getting and keeping files (with the key check first).
2. Reading FIT: timestamps, laps, altitude, steps.
3. The analysis functions.
4. The ride page: header, chart, states, routing.
5. Intervals table and planned against actual.
6. Endurance, W′bal, durability, best efforts, zones.
7. Docs, walkthrough, visual check.
