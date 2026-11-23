# Auuki Desktop roadmap: from training log to training tool

Date: 2026-11-23
Status: proposal. Each subproject gets its own spec (brainstorm, written spec, plan) when it starts.

## Where we are

- **Done:**
  - 1+2: responsive UI and style system
  - 3a: Training page with form, calendar, plan and progress
- **Built, waiting for the live check:** 3b, intervals.icu history and the two-way plan, on branch `intervals-3b`.
- **Built, waiting for the live check:** 4, Garmin health data and activities, plus a load for every workout (power, HR, RPE, estimate), on branch `garmin-4` (on top of `intervals-3b`).
- **Docs:** walkthrough with screenshots and screencast (`docs/walkthrough/`).

## What a serious athlete misses today

1. **Analysis of a single ride:** intervals, executed against planned, decoupling, durability.
2. **A model of the rider:** the full power curve, CP and W′ fitted from it (W′bal still runs on a typed-in 20 kJ), the power profile, and durability (best power after a given amount of work).
3. **Readiness:** HRV, resting heart rate, sleep, and how each session felt, feeding back into the plan.
4. **Planning towards an event:** goal events, phases, ramp-rate guardrails, form on race day.
5. **In-ride tools:** power match, fuelling reminders, lap button, audio cues, built-in tests.
6. **Longer-term insight:** intensity distribution, compliance, trends, a weekly summary.
7. **Working with a coach.**

## Garmin: what's possible now (researched 2026-11-23)

Garmin launched a **Personal API** in October 2026.

- **Getting a key:** any Garmin Connect user creates a key on Garmin Connect Web (Settings, Personal API Key). It's free, needs no approval, and is shown once. It expires after 30 days, 90 days, 180 days or a year, and there is one key per user.
- **How it works:**
  - The server swaps the key for a 24-hour access token at `personal.connectapi.garmin.com`. There is no OAuth consent screen and no callback URL, so it works on a home server that isn't reachable from the internet.
  - It is pull only: the server asks for data, nothing is pushed to it.
  - It is read-only: it can't send workouts to the watch.
  - Garmin publishes an official Python client: `github.com/garmin/connect-personal-api-python`.
- **Data, as reported by third parties and not yet seen first-hand:**
  - daily summaries
  - heart rate
  - HRV
  - sleep
  - Body Battery
  - stress
  - SpO2
  - weight
  - hydration and nutrition logs
  - activities, including the original activity file

  Training readiness, training status, VO2max and acute/chronic load are reportedly *not* available. Some reports say proprietary fields may be stripped from FIT files sent through the API.
- **Terms:**
  - "Not intended for commercial applications serving multiple end users". The key "may be used only by you", with tools you develop or operate for your own use.
  - Garmin may throttle or revoke keys.
  - **Reading:** a self-hosted server that you run, with your own key, fits. A family member's key on the same server is a grey zone. Their key, their decision, and the app should say so where the key is entered.
- **Why it matters for 3b:** intervals.icu said in October that Garmin-sourced data through its API will likely become empty stubs, with nothing final as of 26 October. Getting activities from Garmin directly removes that risk. The 3b duplicate rule (overlap of at least 80 %) already handles one ride arriving from two sources.
- **Unofficial libraries** that log in with a username and password (garth, garminconnect) break regularly and are against Garmin's terms. We don't use them.

Sources:
- DC Rainmaker, Oct 2026
- appsforstrava.com, the Personal API key article (updated Nov 6, 2026)
- aifitnessapi.com, on personal use
- the5krunner, Oct 14, 2026
- the intervals.icu forum, threads 609 and 132863

## Subprojects, in the proposed order

### 3b-finish: intervals.icu live check and merge
- **Steps:** a read-only sync with the rider's key, then confirm the field shapes, then try the two-way plan on one test event. After that, the final review and the merge.
- **Needs:** the rider at the app with their key.

### 4. Garmin connection and health data
- **Spike first (about an hour, with the rider's key):** call the Personal API, see the real endpoints, field names, date-range limits and rate limits, and whether FIT files come through complete.
- **Server:**
  - A per-rider Garmin card in the rider menu, where the rider pastes their own key, with the terms note.
  - The token is refreshed daily.
  - A daily pull of wellness data: HRV (nightly), resting heart rate, sleep (duration and score), Body Battery, stress and weight. It goes into a `wellness` table with one row per rider per day.
  - Activities are pulled with their original files and become ride summaries like the intervals.icu ones (sport, overlap rule, Hide). That makes Garmin a second history source, alongside intervals.icu or instead of it.
  - A warning when the key is about to expire, using its expiry date.
- **Fallbacks:** wellness from intervals.icu (`/athlete/0/wellness`) for riders whose data lives there, and manual entry.
- **Tests:** a fake Garmin API in the style of the intervals.icu fake, covering token expiry, a revoked key and date-range paging.

### 5. Readiness
- **Training page card:**
  - HRV against the rider's own baseline (7-day average against the 60-day normal range)
  - resting heart rate trend
  - sleep
  - a clear state for today: *ready*, *take care* or *rest*, with the reason
- **After each ride:** effort (RPE, 1–10), how it felt, and soreness, as one tap each. Stored with the ride summary.
- **The plan reacts:** on a *take care* or *rest* day, today's hard workout gets a one-tap swap for an easier one, or a move to another day. Nothing changes without the rider.
- **Later:** a 2-minute morning HRV measurement with the chest strap. Auuki already records beat-to-beat intervals.

### 6. The model of the rider
- **Summary v2:** best power at about 20 durations from 1 s to 2 h, plus best 5 and 20 min after 1,000, 2,000 and 3,000 kJ (durability). Auuki rides are read back from their `.fit`; intervals.icu rides use their power curve; Garmin rides use their file.
- **Fitted CP and W′** (critical-power model over 2–20 min efforts, recent 90 days). They feed the W′bal panel, which asks first before replacing the typed-in value.
- **Power profile:** strengths and limiters compared with the rider's own best and with standard tables.
- **Progress cards:** the full curve (log time axis), CP and W′ trend, and durability.

### 7. Ride analysis (was 3c)
- **Open any ride** from the calendar.
- **Intervals:** found automatically or from the workout. Each rep shows average power, NP, time on target, fade and heart-rate drift.
- **Planned against actual**, per rep.
- **Endurance rides:** aerobic decoupling and efficiency factor.
- **W′bal over the ride**, with each match marked.
- **Durability for that ride.**
- **Readiness on that day** (from 5) beside the ride.

### 8. Season planning
- **Goal events** with a priority (A, B or C) and a date.
- **Phases** (base, build, peak, taper) shown on the calendar.
- **A ramp-rate warning** when fitness climbs more than about 5–8 points a week.
- **The form forecast aimed at race day**, with the taper's effect.

### 9. Ride page tools
- **Power match:** ERG steered by the pedal or crank power meter instead of the trainer's reading.
- **Fuelling:** grams of carbohydrate per hour estimated from the work done, with reminders at a set interval.
- **During the ride:** a lap button, and audio cues before interval changes.
- **Built-in tests:** ramp, 3 + 12 min and sprint, each updating CP, W′ and zones.
- **Trainer calibration reminders.**

### 10. Insights
- **Intensity distribution:** low, threshold and high intensity per block.
- **Compliance:** sessions done, and done as prescribed.
- **Trends:** weight and W/kg, efficiency factor, the power curve season against season.
- **A weekly summary** of what changed.

### 11. Coach
- A coach role on the account server. Coaches see their athletes' calendars and rides, plan sessions for them, and comment on rides.

## Why this order

- **3b first:** it's built and only needs the live check.
- **Garmin next:** it secures the history source that intervals.icu is likely to lose, and brings in the health data readiness needs. Its spike needs the rider's key, like the intervals.icu check, so both can happen in one session.
- **Readiness right after Garmin:** it's mostly presentation on top of 4's data, and it's what you notice every morning.
- **The model before ride analysis:** ride analysis is much better with fitted CP and W′ behind it.
- **The rest by value:** season planning builds on the form forecast. Ride-page tools and insights are independent and can move up whenever wanted. Coach is last; it only matters once someone else uses the app.

## Open questions for the rider

- Do you have a Garmin watch that records HRV overnight? Most recent Forerunner, Fenix, Epix and Venu models do.
- Is the server for you alone, or also for family members with their own Garmin accounts? This matters for the terms note.
- Do your rides reach intervals.icu from Garmin today? If so, 4 replaces that path.
