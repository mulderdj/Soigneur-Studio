# Training page: intervals.icu history and plan (subproject 3b)

Date: 2026-11-23
Status: approved in conversation, awaiting review of this written spec

## Intent

The Training page (3a) shows rides recorded in Auuki and the plan made in
Auuki. Riders also ride outdoors and with other apps; intervals.icu collects
those activities (from Garmin, Wahoo, Zwift, uploads and more) and has its
own training calendar. 3b brings both onto the Training page so form,
progress and the calendar reflect all training, and keeps the plan the same
in Auuki and intervals.icu.

### Decisions made

- All sports count for load (fitness, fatigue, form) and show on the
  calendar; only cycling counts for power curve, FTP estimate and zones.
- Planned workouts sync both ways between Auuki and intervals.icu.
- intervals.icu rides count fully: load, zones and best efforts.
- The account server does the intervals.icu syncing (the API key stays on
  the server; one place is in charge, so the two-way plan sync can't create
  duplicates).
- A `.fit` file import on the Training page is added as a fallback for rides
  intervals.icu can't provide (see "Known limits"). The rider confirmed this
  with "Perfect"; drop it here if that wasn't meant.

### Known limits (from the intervals.icu API docs and forum, November 2026)

- Activities that reached intervals.icu from Strava come back as empty stubs
  through the API; they can't be counted.
- intervals.icu announced in October 2026 that it will likely have to block
  API access to Garmin-sourced data (with a possible reopening later). If
  that happens, Garmin activities also come back without data. The `.fit`
  import covers that case.

### Success criteria

- A rider with intervals.icu connected sees their intervals.icu activities
  on the calendar and in form, weekly volume, power curve, FTP trend and
  zones, without duplicates of rides recorded in Auuki.
- Planning, moving or removing a workout in Auuki shows up on intervals.icu
  and the other way round, without duplicate events.
- An intervals.icu planned workout can be ridden in Auuki and is
  auto-selected on its day like an Auuki plan entry.
- Activities intervals.icu returns without data are skipped and reported in
  the account panel, not silently dropped.
- `.fit` files dropped on the Training page become rides on the calendar.

## 1. Server: intervals.icu sync

Runs per account with intervals.icu connected: every 15 minutes, when the
app opens (the app's account sync asks for it) and on "Sync now". One sync
per account at a time.

### API use (intervals.icu, basic auth `API_KEY:<key>`, athlete `0`)

- Activities: `GET /api/v1/athlete/0/activities?oldest=<date>&newest=<date>`
  (descending by date). Fields used: `id`, `start_date_local`, `type`,
  `moving_time`, `elapsed_time`, `distance`, `name`, `icu_training_load`,
  `icu_weighted_avg_watts`, `icu_ftp`, `icu_zone_times`, `source`,
  `external_id`.
- Best efforts: `GET /api/v1/activity/<id>/power-curve` once per cycling
  activity with power; values at 5, 60, 300, 1200 and 3600 s are taken from
  the response.
- Planned workouts: `GET /api/v1/athlete/0/events?oldest=<date>&newest=<date>&category=WORKOUT&ext=zwo`
  (`workout_file_base64` holds the `.zwo`).
- Create: `POST /api/v1/athlete/0/events?upsertOnUid=true` with `uid`
  `auuki-<planEntryId>`, `category` `WORKOUT`, `type` `Ride`, `name`,
  `start_date_local` `<day>T00:00:00`, `filename` `<name>.zwo`,
  `file_contents` (the `.zwo`).
- Update: `PUT /api/v1/athlete/0/events/<eventId>`; delete:
  `DELETE /api/v1/athlete/0/events/<eventId>`.
- Pace: at most 5 requests per second; on 429, wait `Retry-After` (or 60 s)
  and continue; a sync that runs out of retries resumes next time.

Field names not visible in the docs (the power-curve and zone-time response
shapes) are read defensively and confirmed with the first live run.

### Activities → ride summaries

Stored in a new table `external_rides (user_id, id, summary JSON, updated_at)`,
`id` = `icu-<activity id>`. The first sync fetches the last 2 years; later
syncs fetch from 7 days before the newest stored activity (activities edited
on intervals.icu within that window are updated).

Summary (same shape as 3a's, `version` 1) plus:

| Field | From |
|---|---|
| `source` | `"intervals"` |
| `sport` | `type`; `"cycling"` for Ride, VirtualRide, GravelRide, MountainBikeRide, EBikeRide, TrackRide; otherwise the type in lower case |
| `day`, `start` | `start_date_local` |
| `duration` | `moving_time` (else `elapsed_time`) |
| `tss` | `icu_training_load` (`null` when absent) |
| `np`, `ftp`, `distance`, `name` | `icu_weighted_avg_watts`, `icu_ftp`, `distance`, `name` |
| `zoneSeconds` | `icu_zone_times`, mapped onto Auuki's 7 zones (cycling only; zeros otherwise) |
| `best` | power curve (cycling with power only; `null`s otherwise) |
| `remote` | `{source, externalId}` from the activity |
| `auukiRideId` | the Auuki ride this activity came from, when it is one of Auuki's own uploads (the server knows the intervals.icu id each upload got) |

Activities returned without data (empty stubs, no `start_date_local`) are
not stored; the sync counts them by `source` for the status.

### Plan, both ways

The existing `plan` table gets two fields in each entry's data:
`intervalsEventId` and `intervalsUpdated`.

Per sync, for the window from 14 days ago to 90 days ahead:

1. intervals.icu events not linked to a plan entry → new plan entries,
   tagged `origin: "intervals"`. The entry stores the event's `.zwo` text
   (`zwo`); the app turns it into a workout with its existing parser.
2. Linked entries whose event changed on intervals.icu (newer `updated`) →
   entry updated (day, name, workout).
3. Linked entries whose event is gone → entry deleted.
4. Plan entries without `intervalsEventId` (made in Auuki) → created on
   intervals.icu with `uid auuki-<entryId>` (upsert, so a retry never makes a
   second event); the returned id is stored.
5. Plan entries changed in Auuki after their last sync → event updated;
   deleted in Auuki → event deleted.

When both sides changed since the last sync, the newer change wins
(intervals.icu's `updated` against the entry's `updatedAt`).

### Status

`GET /api/me/connections` gains, for intervals.icu: last sync time, number
of activities stored, number skipped by source, and the last error.

## 2. App

- `history.summaries()` returns Auuki's own summaries plus the server's
  external rides (fetched with `GET /api/me/external-rides?since=` and kept
  in IndexedDB store `externalRides` for offline use).
- Duplicates: an external ride is left out when it has an `auukiRideId`
  that matches an Auuki summary, or when it and an Auuki summary overlap in
  time for at least 80 % of the shorter one's duration (this also catches a
  head unit that started earlier or stopped later). Auuki's summary is kept.
- Hide: any ride can be hidden from the day dialog ("Hide this ride";
  undo with "Show"). Hidden rides stay listed in the day dialog but don't
  count anywhere else. Hidden ride ids are stored per rider on the device
  and, when signed in, on the server (`hidden_rides` table), so every
  device agrees. This fixes any duplicate the automatic matching misses.
- Sports: rides with `sport` other than `cycling` count for load (form,
  weekly TSS and hours) and show on the calendar with their sport; power
  curve, FTP estimate and zones use cycling only.
- Plan entries from intervals.icu show an "intervals.icu" tag; their workout
  is parsed from the stored `.zwo` when shown or ridden. Auto-select and ride
  matching work as for Auuki entries.
- `.fit` import: a "Import .fit files" button on the Training page (several
  files at once, or a Garmin export folder's files). Each readable activity
  becomes an Auuki ride summary (3a's `fitToSamples` + `rideSummary`, start
  from the file), stored like a recorded ride and synced to the account; the
  `.fit` itself is not kept. Unreadable files are listed once.
- Account panel: the intervals.icu card shows the sync status.

## 3. Testing

- Server (node:test) with a fake intervals.icu (the existing test pattern
  for uploads): first sync with 2 years; incremental sync; empty stubs
  counted, not stored; power curve mapped to best efforts; zone times
  mapped; 429 waits and resumes; plan: event → entry, entry → event (with
  uid, no duplicate on retry), changes and deletions both ways, newer change
  wins; sync status.
- App (Jest): duplicate matching (by `auukiRideId`, by overlap including a
  head unit that started 5 minutes earlier, no false match on a different
  ride the same day); hidden rides left out of form and progress but listed
  in the day dialog; sports in load but not in
  power curve/FTP/zones; plan entries from intervals.icu parsed and
  auto-selected; `.fit` import adds rides and lists unreadable files.
- Live check: with the rider's API key, a read-only run first (activities,
  one power curve, events) to confirm the field shapes, then the two-way plan
  sync on a test event.
- Visual check: Training page with intervals.icu-tagged entries and other
  sports at every size and theme.
