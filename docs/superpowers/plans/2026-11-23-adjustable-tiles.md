# Adjustable Tiles and Ride Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ride and Training layouts the rider shapes in an edit mode (move, size, hide, add, reset), several swipeable Ride screens, saved per rider and screen class and synced through the account.

**Architecture:** A pure layout module (catalogues, defaults, `readLayout`, grid maths) and a per-rider store that joins the synced profile. `<ride-screens>` owns the Ride page's middle: it builds the screens from the layout and moves the existing live tile elements (kept in a hidden pool in `index.html`) into the visible screen's slots. A shared edit controller (`layout-editor.js`) does move/size/hide/add with pointer and keyboard; Ride and Training both use it.

**Tech Stack:** vanilla JS custom elements, xf event bus, CSS grid + scroll snap, Jest 30 + jsdom, Playwright visual check.

**Spec:** `docs/superpowers/specs/2026-11-23-adjustable-tiles-design.md`

## Global Constraints

- No new runtime dependency; dragging with pointer events.
- Screen class: `phone`, `phone-landscape` → `phone`; `tablet`, `desktop`, `tv` → `large` (`src/views/layout.js`).
- Ride sizes `small` (1 cell), `wide` (2 cells), `large` (full row). Graph tiles (`chart`, `workout`, `stats`) accept `wide`, `large`.
- Columns: phone 3, tablet 4, desktop 4 below 1600 px wide else 5, TV 6.
- 1–8 Ride screens. Edit mode disabled while the watch runs (`db.watchStatus` `started`/`paused`) or a workout is started (`db.workoutStatus` `started`).
- Live tile elements are moved, never re-created.
- Tap targets ≥ 44 px; both themes; `npm run check:visual` passes at every size.
- Layouts live in the rider profile key `layouts` (`src/account/sync.js`), version 1.

## Review Focus

1. **A saved layout from another version or a broken one** (unknown tile id, bad size, 0 or 12 screens, not an object): the page still shows tiles — never an empty Ride page (Task 1 tests).
2. **A tile on two screens:** the visible one has live values after every switch, including after rotating the phone (Task 4 test).
3. **Riding while editing is impossible:** starting the clock with edit mode open closes it and keeps the last saved layout (Task 3 test).
4. **A remote layout arriving mid-edit** does not overwrite the edit; it applies after Done/Cancel (Task 2 test).
5. **Swiping on the live chart** moves the chart read-out, not the screen; an edge swipe still switches (Task 5 test).

---

### Task 1: The layout model

**Files:** Create `src/layout/tiles.js`; Test `test/layout/tiles.test.js`

**Interfaces — Produces:**
- `RIDE_TILES: {id, name, description, sizes: string[], size: string, graph?: true}[]` — ids: `power, target, interval-time, elapsed-time, heart-rate, cadence, speed, distance, slope, power-avg, smo2, thb, core-body-temperature, skin-temperature, chart, workout, stats`.
- `TRAINING_CARDS: {id, name, sizes, size}[]` — ids `form, week, health, calendar, volume, curve, zones, ftp`; sizes `narrow, wide, full`.
- `defaultLayouts() → {version: 1, ride: {phone, large}, training: {phone, large}}` with the spec's three default Ride screens.
- `readLayout(saved, defaults) → layouts` (all the spec's validation rules; never throws).
- `screenClass(layoutName) → 'phone'|'large'`; `columnsFor(layoutName, width) → number`; `spanFor(size, columns) → number`.

- [ ] **Step 1:** Tests: defaults have 3 Ride screens per class and every catalogue id is known; `readLayout(null|'x'|{version: 9})` → defaults; unknown tile dropped; bad size → tile default; graph tile `small` → `wide`; duplicate on a screen → first kept; 12 screens → 8; 0 screens → defaults' screens; empty screen kept; Training card missing → appended hidden; `columnsFor('phone', 390) === 3`, `('tablet', 900) === 4`, `('desktop', 1440) === 4`, `('desktop', 1700) === 5`, `('tv', 2560) === 6`; `spanFor('large', 5) === 5`, `spanFor('wide', 3) === 2`.
- [ ] **Step 2:** Run `npx jest test/layout/tiles.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `layout: tile catalogues, defaults and reading a saved layout`.

### Task 2: The per-rider store and sync

**Files:** Create `src/layout/store.js`; Modify `src/account/sync.js`; Test `test/layout/store.test.js`

**Interfaces — Consumes:** Task 1. **Produces:**
- `layouts.get() → layouts` (read once per rider from `localStorage` `riders.key('layouts')` through `readLayout`).
- `layouts.save(next)` → stores, dispatches `layouts:changed` and `layouts:saved` (the latter triggers the profile push).
- `layouts.applyRemote(next)` → stores without `layouts:saved`; held while `layouts.editing` is true, applied by `layouts.endEdit()`.
- `layouts.beginEdit()`, `layouts.endEdit()`.
- `sync.js`: `localProfile()` includes `layouts: layouts.get()`; `pullProfile` calls `layouts.applyRemote(remote.data.layouts)` when present; `layouts:saved` calls `profileChanged()`.

- [ ] Tests first: save → get round trip per rider; remote while editing held and applied on `endEdit()`; `layouts:saved` not fired by `applyRemote`; broken storage → defaults. FAIL → implement → PASS → commit `layout: per-rider store, synced with the profile`.

### Task 3: The edit controller

**Files:** Create `src/views/layout-editor.js`; Test `test/layout/editor.test.js`

**Interfaces — Produces:**
- `editList(list, op) → list` pure ops: `{move: [from, to]}`, `{size: index}` (cycles allowed sizes), `{hide: index}`, `{add: id}` (appended, default size).
- `class LayoutEditor` attached to a container: `new LayoutEditor(container, {items(), sizesOf(id), onChange(list), announce(text)})`; `.start()`, `.stop()`; adds handle / size / hide controls to each `[data-tile]`; pointer drag (mouse at once, touch after a 300 ms hold on the handle) reorders with a live preview; keyboard on a focused handle: ↑/← and ↓/→ move, Enter size, Delete hide; every change announced.
- `editLocked(db) → boolean` (watch started/paused or workout started).

- [ ] Tests first: each `editList` op; keyboard move announces "Heart Rate moved to place 3"; a pointer drag across two slots reorders; touch drag without the hold scrolls (no reorder); `editLocked` cases. FAIL → implement → PASS → commit `layout: edit controller (drag, keys, size, hide, add)`.

### Task 4: Ride screens (one screen, edit mode)

**Files:** Create `src/views/ride-screens.js`; Modify `src/index.html` (tile pool, `<ride-screens>`, layout button; remove `data-tile-switch-group` and the hero/metrics sections), `src/css/ride.css` (frame: header / screens / modes; screen grid; sizes; landscape fit), `src/views/data-views.js` (drop `DataTileSwitchGroup`), `src/views/views.js` if it registers it; Test `test/layout/ride-screens.test.js`

**Interfaces — Consumes:** Tasks 1–3. **Produces:** `<ride-screens>` with `.screen` (index), `.show(i)`; slots `.rs-slot[data-tile][data-size]`; dispatches `ride:screen` with the index.

- [ ] Tests first: the default Ride screen holds the pool's live elements (same nodes) in layout order; a tile on screens 1 and 2 is live on whichever is shown (placeholder on the other); layout button disabled while riding with a reason; starting the clock during edit cancels it; Done saves through the store; Reset asks and restores the class's default; rotate (phone ↔ phone-landscape) keeps the screen. FAIL → implement → PASS.
- [ ] Landscape: tiles that would overflow the screen's height are hidden (`.rs-slot.is-clipped`) after layout; the rest is on the next swipe.
- [ ] `npm run check:visual` → PASS; read phone, landscape, desktop shots.
- [ ] Commit `ride: tiles in a layout the rider edits`.

### Task 5: Several screens and swiping

**Files:** Modify `src/views/ride-screens.js`, `src/css/ride.css`; Test `test/layout/ride-screens.test.js`

- [ ] Tests first: three default screens with dots; dot click and ← → switch (not while an input has focus); the current screen is remembered per device and restored, falling back to 1 when gone; a touch swipe that starts on the live chart's plot doesn't switch unless it starts within 24 px of the edge; one screen → no dots; edit mode: add (named "Screen N"), rename, remove (asks when it has tiles, never the last), reorder by dragging a dot, moving a tile to the neighbouring screen by dropping it on the screen edge. FAIL → implement → PASS.
- [ ] Commit `ride: several screens to swipe through`.

### Task 6: Training cards

**Files:** Modify `src/views/training/training-page.js`, `src/css/training.css`; Test `test/layout/training-layout.test.js`

- [ ] Tests first: cards render in the layout's order with `data-size`; hidden cards absent; edit mode moves/sizes/hides/adds; health card shown as a placeholder in edit mode when it has no data. FAIL → implement → PASS → commit `training: cards in a layout the rider edits`.

### Task 7: Docs, visual check, roadmap

**Files:** `test/visual/check.js` (a custom-layout pass), `docs/walkthrough/` (Edit layout section + shots), `README.md`, `docs/superpowers/roadmap-2026-11.md`

- [ ] Visual check with defaults and with a custom layout (three screens, large heart rate, chart hidden) at every size and theme → PASS.
- [ ] Walkthrough capture of edit mode and screens; README feature line; roadmap status (auto-switching screens and new metric tiles noted as later).
- [ ] Commit `tiles: docs and visual check`.
