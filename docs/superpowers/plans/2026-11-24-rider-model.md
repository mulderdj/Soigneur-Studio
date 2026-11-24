# Rider Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Best power at ~20 durations, fitted CP and W′ used for W′bal (ask or automatic), the power curve with the model, and a power profile.

**Architecture:** Summaries v2 carry more durations; a pure `rider-model.js` fits and decides; per-rider settings; SessionStats takes a CP; two new Training cards and the extended power curve.

**Tech Stack:** vanilla JS, Jest 30 + jsdom, node:test (server mapping).

**Spec:** `docs/superpowers/specs/2026-11-24-rider-model-design.md`

## Global Constraints
- FTP is never changed by the model. Nothing about W′bal changes in Ask mode without a tap.
- Durations exactly as the spec; validity rules exactly as the spec.

## Review Focus
1. **A rider with few or no power rides** (most of this rider's outdoor rides): no fit, a clear "what's missing", W′bal unchanged (Task 2 test).
2. **Old summaries without the new durations** mixed with new ones: no NaN, no crash (Task 1/2 tests).
3. **Auto mode with a fit that later becomes invalid** (efforts age out of 90 days): W′bal falls back to FTP and typed W′ (Task 2 test).
4. **A rider without weight**: the profile asks for it, no Infinity (Task 4 test).
5. **Ride analysis of an old ride** uses today's model: acceptable, but the card says which CP/W′ were used (Task 3).

---
### Task 1: Durations in summaries and from the services
Files: `src/training/summary.js`, `src/training/progress.js` (WINDOWS → DURATIONS), `server/intervals.js`, `server/intervals-sync.js` (mapping), `server/garmin.js`; tests in `test/training/summary.test.js`, `server/intervals.spec.mjs`.
- [ ] Tests first → implement → PASS → commit `rider model: best power at 21 durations`.

### Task 2: The model and its settings
Files: create `src/training/rider-model.js`, `src/training/rider-model-settings.js`; test `test/training/rider-model.test.js`.
- [ ] Tests first (fit recovers known CP/W′; invalid cases; effective/offer in both modes; profile) → implement → PASS → commit `rider model: CP and W′, profile, settings`.

### Task 3: W′bal uses it
Files: `src/analytics.js` (setCp), `src/views/training-dashboard.js`, `src/views/analysis/ride-source.js`, `src/analysis/ride.js`, `src/views/analysis/ride-cards.js` (which CP/W′); tests.
- [ ] Tests first → implement → PASS → commit `rider model: W′bal from the model`.

### Task 4: Cards
Files: `src/views/training/chart-models.js` (curve with fit), `src/views/training/model-cards.js` (new: CP and W′, power profile), `src/layout/tiles.js`, `src/views/training/training-page.js`, CSS; tests.
- [ ] Tests first → implement → PASS → browser check → commit `rider model: the cards`.

### Task 5: Docs, visual check
- [ ] Walkthrough, README, roadmap; visual check PASS; commit.
