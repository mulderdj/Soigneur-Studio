# Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily ready / take care / rest verdict with reasons on the Training page, and a one-tap easier / recovery / move option on the Ride page before a hard planned workout on a bad morning.

**Architecture:** Pure functions in `src/training/readiness.js` (verdict, hard, easier, recovery, next free day); two history actions for changing a plan entry's workout with undo; a `<readiness-card>` in the Training layout; a `<readiness-note>` above the Ride screens fed by a small `readiness-source.js`.

**Tech Stack:** vanilla JS custom elements, xf, IndexedDB via history, Jest 30 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-24-readiness-design.md`

## Global Constraints

- Nothing in the plan changes without a tap; every change can be undone for 10 s.
- Every verdict lists its reasons; *Balanced* rules exactly as the spec.
- Tap targets ≥ 44 px, both themes, `npm run check:visual` passes.

## Review Focus

1. **No Garmin, or no data from last night:** a verdict from form only, said plainly — never "ready" from missing data alone (Task 1 test).
2. **A workout chosen by hand** (not today's plan): no note (Task 4 test).
3. **Undo after a change synced to intervals.icu:** the original comes back and syncs again (Task 2 test: `.zwo` restored).
4. **Workouts with watt targets or slope steps:** `easier` keeps units and leaves slope steps alone (Task 1 test).
5. **A rider with a saved Training layout:** the new card shows, at the top (Task 3 test).

---

### Task 1: The verdict and the workout helpers
**Files:** Create `src/training/readiness.js`; Test `test/training/readiness.test.js`
- [ ] Tests first for every rule, missing/stale data, `isHard`, `easier` (fraction, watts, slope), `recoverySpin`, `nextFreeDay` → FAIL → implement → PASS → commit `readiness: the verdict and easier workouts`.

### Task 2: Changing a plan entry's workout
**Files:** Modify `src/training/history.js`; Test `test/training/history-replace.test.js`
- [ ] Tests first: replace keeps `original` once (twice replaced: still the first original), `.zwo` follows, restore brings it back and clears `original` → FAIL → implement → PASS → commit `readiness: replace and restore a planned workout`.

### Task 3: The Readiness card
**Files:** Create `src/views/training/readiness-card.js`; Modify `src/layout/tiles.js` (card + `ADDED_VISIBLE`), `src/views/training/training-page.js`, `src/css/training.css`; Test `test/training/readiness-card.test.js`, `test/layout/tiles.test.js`
- [ ] Tests first: each state renders its word and reasons; form-only note; the card added visible first to a saved layout without it → FAIL → implement → PASS → commit `readiness: the Training card`.

### Task 4: The note before you ride
**Files:** Create `src/training/readiness-source.js`, `src/views/readiness-note.js`; Modify `src/index.html`, `src/views/views.js`, `src/css/ride.css`; Test `test/training/readiness-note.test.js`
- [ ] Tests first: shown only for today's hard planned workout on take care / rest and not while riding; each button calls its action and loads the result; Undo restores; Not now hides it for today → FAIL → implement → PASS; browser check → commit `readiness: the note before you ride`.

### Task 5: Dev seed, visual check, docs
**Files:** `src/dev/history-seed.js` (a take-care morning), `test/visual/check.js`, `docs/walkthrough/`, `README.md`, roadmap.
- [ ] Visual check PASS; walkthrough shots; commit `readiness: docs and visual check`.
