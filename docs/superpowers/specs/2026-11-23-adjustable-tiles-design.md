# Adjustable tiles and ride screens

Date: 2026-11-23
Status: design approved in conversation; this spec awaits the rider's review.

## Intent

The rider wants to shape the Ride and Training pages to how they train:
which numbers they see, where, how big, and — on Ride — several screens to
swipe between while riding, the way a head unit has data screens.

### Goals

- **Edit layout** mode on Ride and on Training: move tiles (drag; ↑/↓ with
  keyboard or mouse), resize them, hide them, add hidden ones back, reset to
  the built-in layout.
- **Ride screens:** several screens, each with its own tiles. Swipe left or
  right to switch (← → keys and dots on larger screens). Switching works while
  riding.
- **Reflow, not placement:** tiles keep an order and a size; the grid fills
  itself, so one layout works across the sizes of one screen class.
- **Saved per rider, per screen class** (*phone*, *large*), synced through the
  rider's account like FTP and weight. A new device starts with the rider's
  layout.
- **Every Ride tile the app already has** can be placed, including those
  without a spot today (Power 3s/avg/lap, heart rate and cadence variants,
  kcal, slope, Moxy SmO2/THb, core and skin temperature).

### Non-goals (later, on the roadmap)

- Switching Ride screens automatically (e.g. "Big numbers" when an interval
  starts, back in recovery).
- New metrics (NP, TSS, W′bal tiles and so on). The tile system makes them
  easy to add later; this work only places the existing ones.
- Multiple screens on Training.

### Anti-goals

- **Free placement** (dashboard style, gaps, resizing by dragging edges): the
  rider chose order + sizes; a phone and a TV would need separate fiddly layouts.
- **Editing during a ride:** no edit mode while the watch runs or a workout is
  started, so a bump can't move a tile.
- **Changing what a tile shows:** tiles keep their content, ids and live
  updates; this work moves and sizes them only.

## Approaches considered

1. **Order + sizes with a reflowing grid (chosen).** A list of tiles per
   screen, each with a size; CSS grid places them. Works with a finger, on
   every size, and the layout data stays tiny.
2. **Free grid (gridstack style).** Most freedom, but a layout per breakpoint,
   precise dragging on a phone, a library dependency. Rejected by the rider.
3. **Preset layouts only.** Least work, too little freedom. Kept as an idea:
   the default screens are presets in all but name.

## Constraints

- No new runtime dependency for dragging: pointer events, so mouse, pen and
  touch behave alike. (A small MIT library is acceptable only if pointer-event
  dragging proves unworkable; record it as a ruling.)
- Screen classes come from `src/views/layout.js`: `phone` and
  `phone-landscape` use the **phone** layout; `tablet`, `desktop` and `tv` use
  the **large** layout. The CSS breakpoints stay those of `ride.css`.
- Tap targets ≥ 44 px (`--tap`), both themes, and the visual check
  (`npm run check:visual`) passes at every size, also with a custom layout.
- The live tiles' elements and ids (`data-tile--*`, the custom elements inside)
  are moved, never re-created, so their subscriptions keep working.
- Storage: the rider profile (`src/account/sync.js` `localProfile()` /
  `pullProfile()`), a new key `layouts`; locally in the rider's storage like
  the other per-rider settings. The server stores the profile as JSON and
  needs no change (1 MB limit; a layout is a few kB).

## The layout model

```
layouts = {
  version: 1,
  ride:     { phone: RideLayout, large: RideLayout },
  training: { phone: CardLayout, large: CardLayout },
}
RideLayout = { screens: [ { id, name, tiles: [ {id, size} ] } ] }   // 1–8 screens
CardLayout = { cards: [ {id, size, hidden?} ] }
```

- A **tile id** is the existing element id without its prefix
  (`power`, `heart-rate`, `smo2`, `chart`, `workout`, `stats`, …).
- **Ride sizes:** `small` (one cell), `wide` (two cells), `large` (the full
  row; today's Power tile). The chart, the workout graph and the stats panel
  are tiles too and accept `wide` and `large` only.
- **Training sizes:** `half` and `full` (width); cards: form, week, health,
  calendar, volume, curve, ftp, zones.
- A tile may appear on several Ride screens. Because an element can only be
  in one place, the tile on the visible screen holds the live element and the
  others hold a placeholder; switching screens moves the live elements in.
  (Ruling for the builder if a cheaper correct way is found: the requirement
  is that every visible tile shows live values.)
- **Columns:** phone 3, tablet 4, desktop 4 (below 1600 px wide) or 5, TV 6; `wide` spans 2,
  `large` spans all. Rows size to content, with the hero sizes for `large`
  numeric tiles (today's Power tile look).
- **Handlebar landscape (`phone-landscape`):** the phone layout's current
  screen, as many tiles as fit in the visible area; the rest is on the next
  swipe. No separate layout.

### Defaults (a new rider, and Reset)

Ride, both classes:
1. **Ride:** today's layout — Power `large`, Target, the metric tiles as now,
   chart, workout, stats.
2. **Big numbers:** Power, Heart Rate, Cadence, Interval Time, all `large`
   (phone) / `wide` (large).
3. **Chart:** Power, Target `small`, chart `large`.

Training: today's order and widths.

### Reading a saved layout (validation and migration)

- Unknown version, not an object, or no screens → the defaults.
- A tile id the app doesn't know (removed in an update) → dropped.
- A tile that is new in an update → not placed; it appears in *Add tile*.
- An invalid size → the tile's default size. Duplicate tile on one screen →
  the first kept. More than 8 screens → the first 8. Empty screen → kept
  (shows "Add tiles in Edit layout").
- These rules are one pure function, `readLayout(saved, defaults, known)`,
  tested on its own.

## Ride: screens and swiping

- The screens sit side by side in a horizontal scroller with scroll snap;
  dots under them show the current one (the pattern of today's
  `panel-pager`). On large screens the ← → keys switch screens when no input
  has focus, and the dots are buttons.
- The header, the ERG/resistance/slope controls and the bottom bar stay
  outside the scroller: the same on every screen.
- **Swipe and the live chart:** on the chart a sideways finger moves its
  read-out; to switch screens there, swipe on another tile or start within
  24 px of the screen edge.
- The current screen is remembered per device (not synced) and restored on
  open; a layout change that removes it falls back to screen 1.
- One screen → no dots, no swiping.

## Edit layout

- Entered from a layout button: on Ride in the ride header, after the
  connection buttons (there with one screen too); on Training at the top,
  next to *Import .fit files*. Disabled with a short reason
  while the watch runs or a workout is started.
- In edit mode each tile shows a **drag handle**, a **size** button (cycles
  through the allowed sizes) and **hide** (×). Live values keep updating.
- **Drag:** press the handle, move, drop; the others make room as you move.
  On touch: press and hold the handle 300 ms, then drag (a normal swipe still
  scrolls). Dragging to the screen edge moves the tile to the neighbouring
  screen (Ride).
- **Keyboard:** handle focused → ↑/↓ (or ←/→) moves one place, Enter cycles
  size, Delete hides. Each move is announced (`aria-live`).
- **Add tile:** a tray listing the tiles not on this screen (Ride) or hidden
  (Training), by name with a short description; tapping one adds it at the end.
- **Ride screens:** *Add screen* (empty, named "Screen N"), *Rename*,
  *Remove* (asks when it has tiles; the last screen can't be removed), and
  dragging a dot reorders screens.
- **Done** saves and syncs; **Cancel** throws the edits away; **Reset**
  (asks first) restores the defaults for this page and screen class only.
- The layout being edited is the one for the current screen class; a note
  says so ("Editing the phone layout").

## Sync

- `layouts` joins the profile pushed and pulled by `src/account/sync.js`,
  newest wins as for the rest of the profile. A layout pulled from the
  account is applied at once unless edit mode is open; then it waits until
  Done/Cancel.
- Without an account, layouts stay on the device for that rider.

## Errors and edge cases

- A tile whose sensor isn't connected shows "--" as today; nothing hides
  itself.
- Health card without Garmin data hides itself as today; in edit mode it is
  shown as a placeholder so it can still be moved.
- Rotating a phone switches between `phone` and `phone-landscape` without
  losing the current screen.
- A drag that ends outside any slot puts the tile back.

## Testing

- `readLayout` and the defaults: every rule under *Reading a saved layout*.
- Grid placement: column counts per class, spans per size, landscape fit.
- Edit mode in jsdom: move (pointer and keyboard), resize, hide, add,
  add/rename/remove/reorder screens, Done/Cancel/Reset, locked while riding.
- Screens: swipe/keys/dots switch, the chart's sideways finger doesn't,
  the current screen is restored, a tile on two screens shows live values on
  whichever is visible.
- Sync: `layouts` pushed after Done, pulled and applied, held while editing.
- Visual check at every size and theme with the defaults and with a custom
  layout (three screens, a large heart rate, a hidden chart); the walkthrough
  gets an Edit layout section with screenshots.

## Order of work

Three parts, each mergeable on its own:

1. **Layout engine + Ride edit mode on one screen**: model, `readLayout`,
   defaults, the reflowing grid, edit mode, sync.
2. **Ride screens**: several screens, swiping, dots and keys, the default
   three screens, screen editing.
3. **Training**: the same engine for the cards.

## Left to the builder

- The exact look of handles, size button and tray, within the design system.
- Animation of tiles making room while dragging (keep it short; none with
  `prefers-reduced-motion`).
- How the live element moves between duplicate tiles, within the requirement
  above.
