# AI coach through MCP

Date: 2026-11-26
Status: implemented (steps 1–4: access tokens, read/write MCP tools and plan check, prompts, and setup docs in `docs/mcp-coach.md`; stdio transport).
Roadmap: 11 (coach), and the first part of 8 (season planning).

## Intent

The rider talks to an AI model of their choice; the model reads their
training through Soigneur and, with their approval, plans workouts. Soigneur
does the computing (the same numbers as the app); the model interprets,
explains and proposes. No API key and no cost on the Soigneur side: the
model is whatever the rider's AI app uses (Claude Code on a Pro
subscription first; ChatGPT, Gemini CLI or a local model through LM Studio
later).

### Goals
- An MCP server (`soigneur-mcp`) with read tools for rides, ride analysis,
  form, readiness and health, the rider model and the plan, and write tools
  for the plan only.
- Provider-neutral: self-explaining tools with units and dates in the
  descriptions, no model-specific prompts in the server.
- Two transports: stdio (local AI apps) now; Streamable HTTP later, for
  online connectors, only behind sign-in.
- Every plan change confirmed by the rider (the AI app asks before a write
  tool runs) and checked by Soigneur before it is stored.
- Three ready-made prompts (MCP prompts): ride debrief, weekly review,
  training plan.

### Not now
- Automatic in-app debriefs or review cards (would need an API key).
- An online connector for claude.ai / ChatGPT (needs the server on the
  internet: a tunnel, sign-in by OAuth, a security review).
- Deleting rides, changing settings, FTP, or connections through the AI.

## 1. Where it runs and how it signs in

- `server/mcp/` in this repo: a Node program on the official MCP SDK
  (`@modelcontextprotocol/sdk`), started by the AI app over stdio:
  `node server/mcp/index.mjs`, with `SOIGNEUR_URL` (e.g.
  `https://192.168.1.116:8443`, or `http://localhost:8080` on the same PC) and
  `SOIGNEUR_TOKEN`. The Caddy root certificate is passed with
  `NODE_EXTRA_CA_CERTS` when HTTPS is used.
- It talks to the account server's existing REST API (`/api/me/...`), like the
  app; nothing new is stored.
- **Access tokens** (new): the rider menu (Account) gets *AI access*: create
  a named token ("Claude Code on my PC"), shown once, revocable; scopes
  `read` or `read + plan`. Stored hashed on the server; a token can't sign in
  to the app, change the password or connections, or delete anything but
  plan entries.

## 2. The tools

All dates `YYYY-MM-DD` (the rider's local days); power in W, heart rate in
bpm, durations in seconds unless named otherwise; every tool says so in its
description. Results are compact JSON, never raw per-second samples.

### Read (`read` scope)
| Tool | Input | Returns |
|---|---|---|
| `get_athlete` | – | FTP, weight, W′, threshold HR per sport, rider-model CP/W′ and its fit, readiness today (verdict and reasons) |
| `list_rides` | `from`, `to`, `sport?` | per ride: id, day, name, sport, source (Soigneur / Garmin / intervals.icu / .fit), duration, distance, TSS and how it was worked out, IF, NP, avg power, avg/max HR, the planned workout it fulfilled |
| `get_ride_analysis` | `ride_id` | the ride page's analysis: intervals with planned vs done per rep, HR drift and recovery per effort, decoupling, efficiency, W′bal and matches, best efforts against the 90 days before, time in zones, durability |
| `get_form` | `from`, `to`, `forecast_days?` | fitness, fatigue and form per day, and the forecast from the plan |
| `get_progress` | `weeks?` | weekly volume (hours, TSS, kJ), the 3-zone distribution, the power curve (6 weeks vs all time), FTP estimates, aerobic efficiency trend |
| `get_health` | `from`, `to` | HRV with its normal range, resting HR, sleep, Body Battery per night |
| `get_plan` | `from`, `to` | planned entries: id, day, workout (name, duration, steps as % FTP), planned TSS, status (planned / done / missed), origin |
| `list_workouts` | `query?` | the workout library (built-in, tests and the rider's own) by name, duration and kind |

### Write (`read + plan` scope; the AI app asks the rider first)
| Tool | Input | Does |
|---|---|---|
| `plan_workout` | `day`, a library `workout_id` **or** a structured workout (`name`, `steps: [{duration, power_pct | slope_pct, cadence?, note?}]`) | adds a plan entry (synced to intervals.icu as today) |
| `move_planned` | `entry_id`, `day` | moves a planned, not ridden entry |
| `remove_planned` | `entry_id` | removes a planned, not ridden entry |
| `propose_plan` | `goal`, `weeks: [{start, focus, days: [{day, workout}]}]` | **checks** a whole block (below) and returns the findings; stores nothing |
| `apply_plan` | the checked proposal's id | stores it as plan entries; refused unless the check passed and the proposal is unchanged |

### The plan check (Soigneur's own rules, also for `plan_workout`)
- Every workout valid: steps with a duration, power 30–200 % FTP, at most
  6 h a day.
- Fitness (CTL) rising at most 8 a week in the forecast; a deload week at
  least every 4th week of a build.
- At least one rest day a week; no two days above 90 TSS in a row unless the
  rider allows it.
- Intensity: in base phases at least 75 % of the time in Z1–Z2.
- A day already ridden or planned by intervals.icu isn't overwritten.
Findings come back in words the model can act on ("week 3: fitness +11,
more than 8 a week: lower the TSS by about 120").

## 3. The prompts (MCP prompts; the rider picks one in their AI app)
- **Ride debrief** (`ride`: id or "latest"): read the ride and its context,
  explain what went well and what stood out, what it means for the next
  days. Short, numbers with units.
- **Weekly review** (`week`: date or "last"): volume, intensity distribution,
  plan compliance, form and readiness, efficiency; two or three suggestions.
- **Training plan** (`goal`, `date`, `days_per_week`, `hours_per_week`): build
  a block plan through `propose_plan`, fix what the check reports, show it,
  and only after the rider agrees, `apply_plan`.
Each prompt states the guardrails: no medical advice (symptoms such as chest
pain: see a doctor), respect the readiness verdict, units always.

## 4. Privacy
- Nothing leaves the server unless the rider asks their AI app something;
  then only what the tools return (no per-second data, no account details).
- Where the data goes depends on the AI app: to its provider (Anthropic,
  OpenAI, Google) or nowhere with a local model. The *AI access* screen says
  so, per token.
- A token is per rider; revoking it stops access at once.

## 5. Testing
- Every tool against a test account server with the dev seed: results,
  units, empty ranges, unknown ids, scopes (a `read` token can't write).
- The plan check: good and bad proposals for each rule, the wording of the
  findings, `apply_plan` refused after a change.
- The MCP layer with the SDK's in-memory transport: tool list, schemas,
  prompts.
- Live: Claude Code with the server on the rider's PC: a debrief of a real
  ride, a weekly review, a two-week plan proposed and applied after
  confirmation.

## Order
1. Access tokens (server and rider menu).
2. Read tools and the debrief and weekly-review prompts; live test with
   Claude Code.
3. The plan check, the write tools and the training-plan prompt.
4. Docs: setting it up in Claude Code, and notes for ChatGPT, Gemini CLI and
   LM Studio.
