# AI coach through MCP

Soigneur Studio includes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server (`server/mcp/index.mjs`) so you can talk to an AI model of your choice about your training — and, if you allow it, let it propose and schedule workouts.

Soigneur does all the calculations (using the exact same modules as the Ride, Training and Ride Analysis pages); the AI reads the compact results and explains, reviews or proposes changes. No AI API key is needed on the Soigneur side.

## 1. Create an access key in Soigneur

1. Open Soigneur Studio and click your **rider pill** (top left).
2. Go to the **Account** tab (you must be signed in to your self-hosted account server).
3. Under **AI access**, enter a name (for example `Claude Code on my PC`), choose a scope, and click **Create a key**:
   - **read my training** (`read` scope): lets the AI read your profile, rides, ride analyses, fitness/form, progress, health data, plan and workout library. It cannot change anything.
   - **read my training and change my plan** (`plan` scope): everything above, plus adding, moving and removing planned workouts. It still cannot delete rides, change your FTP/settings/password, touch connected services or manage accounts.
4. Copy the key (`sst_…`) right away — it is shown only once. Keys are stored SHA-256 hashed on the server (up to 20 per rider) and can be revoked at any time with **Remove** (disabling a rider account also revokes AI access immediately).

## 2. How the MCP server connects

The MCP server runs locally over **stdio** (`node server/mcp/index.mjs`, requires Node ≥ 22.18 and `npm install` in this repository). It talks to your Soigneur account server's REST API (`/api/me/…`) using two environment variables:

- `SOIGNEUR_URL` — base URL of your Soigneur server, e.g. `http://localhost:8080` (same machine) or `https://192.168.1.20:8443` (on your LAN).
- `SOIGNEUR_TOKEN` — the `sst_…` access key from step 1 (sent to the account server as `Authorization: Bearer <token>`).
- `NODE_EXTRA_CA_CERTS` *(only for local HTTPS)* — path to Caddy's root certificate (`soigneur-root.crt`, see the Docker section of [README.md](../README.md#run-with-docker)), so Node trusts your server's local TLS certificate.

Quick sanity check from a terminal:

```sh
SOIGNEUR_URL=http://localhost:8080 SOIGNEUR_TOKEN=sst_... node server/mcp/index.mjs
```

It should print `:mcp Soigneur MCP server on stdio, for http://localhost:8080` on stderr and wait for MCP messages on stdin. Press `Ctrl+C` to stop.

## 3. Connect your AI app

### Claude Code

Register the server with `claude mcp add` (using the absolute path to `server/mcp/index.mjs` in your checkout):

```sh
claude mcp add soigneur \
  -e SOIGNEUR_URL=http://localhost:8080 \
  -e SOIGNEUR_TOKEN=sst_your_key_here \
  -- node /absolute/path/to/soigneur-studio/server/mcp/index.mjs
```

If your Soigneur server runs on another machine over local HTTPS:

```sh
claude mcp add soigneur \
  -e SOIGNEUR_URL=https://192.168.1.20:8443 \
  -e SOIGNEUR_TOKEN=sst_your_key_here \
  -e NODE_EXTRA_CA_CERTS=/absolute/path/to/soigneur-root.crt \
  -- node /absolute/path/to/soigneur-studio/server/mcp/index.mjs
```

Verify with `claude mcp list`. Inside Claude Code you can either ask naturally ("Debrief my latest ride", "Review last week's training") or invoke the built-in MCP prompts (`/mcp__soigneur__ride_debrief`, `/mcp__soigneur__weekly_review`, `/mcp__soigneur__training_plan`).

### Gemini CLI

Add the server to `~/.gemini/settings.json` (or `.gemini/settings.json` in a project):

```json
{
  "mcpServers": {
    "soigneur": {
      "command": "node",
      "args": ["/absolute/path/to/soigneur-studio/server/mcp/index.mjs"],
      "env": {
        "SOIGNEUR_URL": "http://localhost:8080",
        "SOIGNEUR_TOKEN": "sst_your_key_here"
      }
    }
  }
}
```

Add `"NODE_EXTRA_CA_CERTS": "/absolute/path/to/soigneur-root.crt"` inside `env` when using local HTTPS.

### LM Studio (local model, nothing leaves your machine)

Open **Program → Install → Edit `mcp.json`** in LM Studio and add the same `mcpServers.soigneur` entry as above. Because LM Studio runs the model locally, your training data never leaves your home network.

### ChatGPT

ChatGPT's web and desktop MCP connectors require a remote HTTPS MCP server (Streamable HTTP with OAuth sign-in) reachable over the public internet. Soigneur Studio currently ships the **stdio** transport only, so your server stays private on your LAN without needing a public tunnel or OAuth setup. Streamable HTTP behind sign-in is planned for a later release.

## 4. Tools

All dates are `YYYY-MM-DD` in the rider's time zone. Units are encoded in key names (`_s` seconds, `_w` watts, `_bpm` beats per minute, `_j` joules, `_kj` kilojoules, `_pct` percent, `_h` hours). Results are compact JSON — never raw per-second samples.

### Read tools (`read` or `plan` scope)

| Tool | Inputs | Returns |
|---|---|---|
| `get_athlete` | — | Current FTP, weight, W′, threshold HR per sport, 90-day rider model (CP/W′), power profile (W/kg), and today's readiness verdict (`ready`, `take-care`, or `rest`) with reasons. |
| `list_rides` | `from?`, `to?`, `sport?` | Deduplicated rides/workouts (default last 28 days) across Soigneur, Garmin, intervals.icu and imported `.fit` files: id, day, name, sport, source, duration, distance, TSS and load source, IF, NP, power, kJ, HR, RPE, FTP, and matched planned workout. |
| `get_ride_analysis` | `ride_id` (`id` or `"latest"`) | Full Ride Analysis summary: planned workout steps, intervals (planned vs actual per rep, pacing, power fade, HR drift), efforts with 60 s HR recovery, W′bal and matches, time in power/HR zones, best efforts vs prior 90 days, decoupling, efficiency factor, and durability. |
| `get_form` | `from?`, `to?`, `forecast_days?` | Daily TSS, fitness (CTL, 42-day), fatigue (ATL, 7-day), form (TSB) with label, forecast from planned workouts, and `race_forecast` (projected race-day TSB, taper effect, and taper guidance) when an `A` or `B` goal event is within 90 days. |
| `get_progress` | `weeks?` | Weekly volume (rides, hours, TSS, kJ), this week vs last week, 3-zone intensity distribution, 42-day vs all-time power curve, weekly FTP estimates, and aerobic efficiency trend (default 12 weeks). |
| `get_health` | `from?`, `to?` | Nightly Garmin health metrics (default last 14 days): HRV vs normal range, resting HR and trend, sleep, and Body Battery. |
| `get_plan` | `from?`, `to?` | Planned workouts (`entries`: id, day, name, status, origin, planned TSS, duration, steps), season `goal_events` (`A` / `B` / `C` priority, event type, target duration/TSS, notes), and derived weekly training `phases` (`base`, `build`, `peak`, `taper`, `mini_taper`). |
| `list_workouts` | `query?` | Built-in workouts, built-in tests, and your own library: id, name, source, category, duration, planned TSS, and description. |

### Write tools (`plan` scope only)

| Tool | Inputs | Does |
|---|---|---|
| `plan_workout` | `day`, `workout_id` or `workout`, `allow_back_to_back_hard_days?` | Checks and adds one workout to the plan (syncs to the app and intervals.icu). |
| `move_planned` | `entry_id`, `day`, `allow_back_to_back_hard_days?` | Checks and moves a planned, unridden workout (today or later) to another day. |
| `remove_planned` | `entry_id` | Removes a planned, unridden workout (today or later) from the plan (and intervals.icu if synced). |
| `set_goal_event` | `day`, `name`, `priority?` (`A`\|`B`\|`C`), `goal_id?`, `event_type?`, `target_duration_s?`, `target_tss?`, `notes?` | Adds or updates a goal event on the calendar (`A` goals drive Base/Build/Peak/Taper phases; `B` goals get a mini-taper). |
| `remove_goal_event` | `goal_id` | Removes a goal event from the season calendar. |
| `propose_plan` | `goal`, `weeks`, `replace_planned?`, `allow_back_to_back_hard_days?` | Checks a multi-week block against Soigneur's guardrails and returns findings + weekly TSS/CTL; stores nothing. |
| `apply_plan` | `proposal_id` | Stores a checked proposal after you agree. Re-checks against current rides/plan and refuses if anything changed. |

**Soigneur's plan check** (applied to `plan_workout`, `move_planned`, `propose_plan`, and `apply_plan`):
- Valid workouts: steps with positive duration, steady/ramp power within 30–200 % FTP (or `free_ride`), at most 6 h per day.
- Valid days: not in the past, not more than a year ahead, never overwrites a ridden day or a workout planned on intervals.icu.
- Fitness ramp: projected CTL rises by at most 8 per week.
- Recovery: at least one rest day each week; in blocks of 4+ weeks, an easier recovery week (≤ 75 % of the hardest of the prior 3 weeks) at least every 4th week.
- Hard days: no two consecutive days above 90 TSS unless you explicitly allow it.
- Base phases: weeks with a `base` focus must have at least 75 % of riding time in Z1–Z2 (< 75 % FTP).
- Readiness: no hard workout today unless today's readiness verdict is `ready`.

## 5. Prompts

The server exposes three ready-made MCP prompts, all grounded in the tool outputs with explicit units, respecting today's readiness verdict, and refusing medical advice (referring symptoms like chest pain, fainting, unusual breathlessness, or palpitations to a doctor):

- **`ride_debrief`** (`ride?`: ride id or `"latest"`) — summarises what went well, rep-by-rep execution, HR drift/recovery/decoupling, standout numbers/records, and what it means for the next 2–3 days.
- **`weekly_review`** (`week?`: `"last"`, `"this"`, or `YYYY-MM-DD`) — reviews volume, intensity distribution, plan compliance, recovery/health, progress trends, and gives 2–3 concrete suggestions for next week.
- **`training_plan`** (`goal`, `date?`, `days_per_week?`, `hours_per_week?`) — inspects your current fitness/plan/library, builds a block, validates it with `propose_plan` until it passes, presents it week by week, and calls `apply_plan` only after you agree.

## 6. Privacy and security

- **On-demand only:** nothing leaves your Soigneur server unless you ask your AI app a question.
- **Compact data only:** the tools return computed summaries — no raw per-second `.fit` streams, no passwords, and no Strava/Garmin/intervals.icu credentials.
- **Provider choice:** what the tools return goes to whichever AI provider your app uses (e.g. Anthropic for Claude Code, Google for Gemini CLI), or stays completely on your home network with a local model (LM Studio).
- **Per-rider, scoped, revocable keys:** each key belongs to one rider, is limited to `read` or `plan`, is stored hashed on the server, and stops working the moment you click **Remove** under **Account → AI access**.
