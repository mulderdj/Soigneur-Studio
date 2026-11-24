# Built-in Tests Implementation Plan

**Goal:** Five guided tests (3 + 12 min, Ramp, 20 min, 2 × 8 min, Sprint) in the Workouts library, all-out efforts in sim mode at 1 %, a result screen with one-tap offers, and a way to ride the 3 + 12 from the CP and W′ card.

**Architecture:** Pure protocols (`src/tests/protocols.js`) added to the built-in workouts; pure results and ramp-end rule (`src/tests/results.js`); a wiring module keeps a per-second log `{i, s, power}` while a test runs (records carry no step) and opens `<test-result>` on `workout:done` or on stop.

**Tech Stack:** vanilla JS, Jest 30 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-24-ride-tests-design.md`

## Design notes (from the code)
- Workout shape as parsed from .zwo: `{id, meta: {name, category, subcategory, author, description, duration, test}, intervals: [{duration, steps: [{duration, power?, slope?, messages?: [{offset, message}]}]}]}`.
- The watch already switches to sim on a `slope` step and back to ERG on a `power` step (`src/watch.js` `watch:stepIndex`); category *Test* already turns auto-pause off.
- Scored steps carry `effort: 'p3' | 'p12' | 'p20' | 'p8a' | 'p8b' | 'sprint'` (openers have no tag), so results don't depend on positions. The Ramp's ramp steps are one interval with `ramp: true` and the cool-down is the next interval, so `ui:watchLap` (lap → next interval) ends the ramp.
- Built-ins: `Workouts.defaultValue()` appends `protocols()`; the XML *Ramp Test* is removed.
- The session is saved and reset on `watch:stopped`; the wiring uses its own log, so ordering doesn't matter.

## Global Constraints
- Nothing changes without a tap (FTP, W′bal settings).
- Protocol numbers and result formulas exactly as the spec.

## Review Focus
1. Stopped mid-test: before the first effort → no dialog; after it → the dialog with a reason or the partial result (Sprint/2 × 8 with one effort: reason).
2. Pauses during an effort: the log only grows while the watch runs; missing power (<90 %) gives the reason.
3. Ramp end never fires outside the ramp interval or for a non-Ramp workout, and fires once.
4. Card button never loads a workout during a ride.

---
### Task 1: Protocols
Files: create `src/tests/protocols.js`; edit `src/models/models.js` (defaultValue), `src/workouts/workouts.js` (drop XML Ramp Test); test `test/tests/protocols.test.js`.
- [ ] Tests first (durations, efforts as slope 1 steps, totals, messages) → implement → PASS → commit `tests: the five protocols`.

### Task 2: Results and ramp end
Files: create `src/tests/results.js`; test `test/tests/results.test.js`.
- [ ] Tests first (each test good/bad, reasons, rampEnded) → implement → PASS → commit `tests: results and ramp end`.

### Task 3: Wiring and result screen
Files: create `src/tests/wiring.js`, `src/views/test-result.js`; edit `src/index.html`, `src/views/views.js`, `src/index.js`, CSS; test `test/views/test-result.test.js`.
- [ ] Tests first (content and buttons per test; log; ramp lap) → implement → PASS → commit `tests: result screen`.

### Task 4: From the CP and W′ card
Files: `src/views/training/model-cards.js`; test in `test/views/`.
- [ ] Tests first → implement → PASS → commit `tests: ride the 3 + 12 from the card`.

### Task 5: Docs, browser check with the simulator, final review
- [ ] README/roadmap; simulator check; one final reviewer; fix; commit.
