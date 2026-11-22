# One Responsive Interface and Style System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two interfaces (upstream `flux.css` + dock mode, and the desktop-only dashboard) with one mobile-first interface from phone to TV, styled by one token/component system.

**Architecture:** New CSS in layers (`tokens.css` → `base.css` → `components.css` → one file per page), loaded before the old CSS during migration. Each page is ported whole: its markup moves onto the shared components and every old rule that targets it is deleted from `flux.css` / `desktop.css` in the same task. A Playwright check script gates every page task. The upstream auuki.com account, upstream connections, dock mode and Ride Report go.

**Tech Stack:** Vanilla JS custom elements, plain CSS (custom properties, grid, `clamp()`, scroll-snap), Parcel 2, Jest 30 + jsdom, `playwright-core` driving the local Chrome for the visual check.

**Spec:** `docs/superpowers/specs/2026-11-22-responsive-ui-and-style-system-design.md`

## Global Constraints

- Breakpoints: phone < 600 px; tablet 600–1199 px; desktop ≥ 1200 px; 4K/TV ≥ 2200 × 1100 px. Phone landscape = `(max-height: 599px) and (orientation: landscape)`.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Type scale: 12, 14, 16, 20, 24, 32, 48 px; live numbers use `clamp()`.
- Radii: 8 (inputs, small buttons), 12 (cards), 999 (pills).
- Colour roles: `bg`, `surface`, `surface-2`, `line`, `ink`, `muted`, `accent`, `good`, `warn`, `danger`, `zone-1`…`zone-7`, `hr`, `cadence`, `wbal`. Every role defined in dark and light.
- Dark by default; light follows the system or the Settings theme switch (`body.white-theme` / `body.dark-theme`, as today).
- Page CSS files may not declare colours, font sizes, radii or spacing values other than `var(--…)` tokens. A missing pattern becomes a component.
- Tap targets used mid-ride ≥ 44 × 44 px.
- Keep custom element names, ids and `prop` / `for` / `data-key` attributes the JS depends on; only classes and wrappers change.
- Don't touch: `src/ble/`, `src/ant/`, `src/fit/`, `src/workouts/`, `src/watch.js`, `src/analytics.js`, `server/`, `src/account/`, `src/dev/simulator.js`.
- Internally the Ride page keeps `id="home-page"` and `page="home"` (stored page values and `page-btn` targets use `home`); only the label changes to "Ride".
- Every task ends with `npx jest` showing no new failures beyond the 50 inherited upstream ones, and `npm run test:server` passing.

## Review Focus

1. **Rider without an account:** after the upstream removals, a local-only rider must still see and download their saved rides. Keep `<activity-list>` on the Workouts page with download only; it moves to Training in subproject 3. Pinned in Task 5.
2. **Existing installs with stored state for removed features** (`dockMode=true`, a stored `planned` workout list, a stored page of `report`) must open on a normal Ride page. Pinned by `cleanupLegacyPrefs` tests in Task 6.
3. **Small phones (360 × 740) and long values** (e.g. `1:23:45`, 4-digit power): no overflow, no clipped tiles. The visual check includes 360 × 740. Pinned in Task 1.
4. **Rotating the phone mid-ride:** chart history, stats and the running clock survive the layout switch. Pinned by the rotate step in the visual check (Task 1), exercised in Task 3.
5. **Changing ERG target / mode on a phone:** the spec's phone layout doesn't list the mode controls. They go in a compact row above the bottom bar so riders can still change them. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/css/tokens.css` | Design tokens, dark + light |
| `src/css/base.css` | Reset, typography, `.wrapper`/page shell, bottom bar |
| `src/css/components.css` | `.btn` (+ `--primary --secondary --quiet --danger --icon`), `.card`, `.tile`, `.panel`, `.list-row`, `.tabs`, `.segmented`, `.field`, `.toggle`, `.dialog`, `.flash`, `.pill`, `.badge`, `.empty` |
| `src/css/ride.css`, `workouts.css`, `settings.css`, `training.css`, `rider-menu.css` | Page layout only |
| `src/views/app-bar.js` | `<app-bar>`: riding / idle state, tabs menu on phone |
| `src/views/panel-pager.js` | Swipe dots for the stats panels on phone |
| `src/views/layout.js` | `layoutFor(width, height)` used by the chart and pager |
| `src/legacy-prefs.js` | One-time cleanup of stored keys for removed features |
| `test/visual/check.js` | Playwright visual check |
| `test/app-bar.test.js`, `test/panel-pager.test.js`, `test/layout.test.js`, `test/legacy-prefs.test.js` | Unit tests |

---

### Task 1: Visual check script

**Files:**
- Create: `test/visual/check.js`
- Modify: `package.json` (devDependency `playwright-core`, script `"check:visual": "node test/visual/check.js"`), `.gitignore` (`/test/visual/out/`), `jest.config.js` (ignore `<rootDir>/test/visual/`)

**Interfaces:**
- Produces: `npm run check:visual -- [--pages ride,settings,workouts,training] [--url http://localhost:1234]`; exit 0 = pass. Screenshots to `test/visual/out/<page>-<size>-<theme>.png`. Browser from `CHROME_PATH` env, else Playwright's default.

- [ ] **Step 1: Add `playwright-core` as a devDependency and the npm script**

Run: `npm install --save-dev playwright-core` — expected: added, no install scripts needed.

- [ ] **Step 2: Write `test/visual/check.js`**

Behaviour:
- Opens `<url>/?simulate` (default `http://localhost:1234`) per size: phone 390×844, small phone 360×740, phone landscape 844×390, tablet 820×1180, desktop 1600×900; for theme dark and light (set by `localStorage.theme` before load, matching the theme model's key).
- Starts the ride (`#watch-start`) and waits 6 s so live values fill, then visits each requested page by clicking its tab (`#home-tab-btn`, `#training-tab-btn`, `#workouts-tab-btn`, `#settings-tab-btn`; on phone open the app-bar menu first if the tab isn't visible).
- Fails (collects, prints, exits 1) on:
  - `pageerror` or `console.error`, except messages matching `/api.auuki.com|ERR_FAILED|\/api\/.*50[24]/`
  - `document.documentElement.scrollWidth > innerWidth`
  - on phone sizes: any visible `button, a, [role=button], [role=tab], input, select, .control--btn, .btn` smaller than 44×44, ignoring elements inside `[data-check-ignore]`
  - any visible `.tile` value element (`.tile__value`) with `scrollWidth > clientWidth + 1`
- Rotate step (phone only): on the Ride page, record `#elapsed-time` text and the chart's sample count (`live-chart` exposes `dataset.samples`), resize to landscape, wait 2 s, resize back; fail if elapsed time went backwards or samples dropped.
- Saves a full-viewport screenshot per page/size/theme.

- [ ] **Step 3: Run it against the current UI to see it work**

Run (with `npm start` in another terminal): `CHROME_PATH=/var/lib/flatpak/app/com.google.Chrome/current/active/files/extra/chrome npm run check:visual -- --pages ride`
Expected: runs to completion and FAILS with overflow / tap-target findings on phone sizes (the old phone layout). That's the baseline.

- [ ] **Step 4: Commit**

```bash
git add test/visual/check.js package.json package-lock.json .gitignore jest.config.js
git commit -m "test: add visual check script for all pages and sizes"
```

---

### Task 2: Tokens, base, components, page shell and app bar

**Files:**
- Create: `src/css/tokens.css`, `src/css/base.css`, `src/css/components.css`, `src/css/training.css`, `src/views/app-bar.js`, `test/app-bar.test.js`
- Modify: `src/index.html` (stylesheet links; bottom bar markup lines ~1598–1680; new Training page + tab), `src/views/views.js` (import `./app-bar.js`), `src/css/flux.css` and `src/css/desktop.css` (delete the rules for `.menu`, `.page-btn`, `watch-control`/`.control--btn`, `#workout-name` bottom bar)

**Interfaces:**
- Produces:
  - `barMode(watchStatus: string) -> 'riding' | 'idle'` — `'riding'` for `'started'` and `'paused'`, else `'idle'`.
  - `<app-bar>` wraps the bottom bar; sets `data-mode="riding|idle"` from `db:watchStatus`; contains a `.app-bar__menu` button (shown only on phone in riding mode) that toggles `data-menu-open`.
  - Page `<div id="training-page" class="page" page="training">` with a `.empty` state ("Calendar, progress and form are coming here."), tab `<page-btn id="training-tab-btn" page="training">`.
  - Token names exactly as in Global Constraints, as `--<role>` (e.g. `--surface`, `--zone-3`), plus `--space-1..7`, `--text-xs..3xl` (12…48), `--radius-s` (8), `--radius-m` (12), `--radius-pill` (999), `--font-text` (Barlow), `--font-num` (Barlow Condensed).

- [ ] **Step 1: Write the failing test** `test/app-bar.test.js`

```js
import { barMode } from '../src/views/app-bar.js';
test('riding while started or paused', () => {
    expect(barMode('started')).toBe('riding');
    expect(barMode('paused')).toBe('riding');
});
test('idle otherwise', () => {
    for(const s of ['stopped', 'done', undefined, '']) expect(barMode(s)).toBe('idle');
});
```

- [ ] **Step 2: Run it** — `npx jest test/app-bar.test.js` — expected FAIL (module not found).

- [ ] **Step 3: Implement `src/views/app-bar.js`** (`barMode`, `<app-bar>` as above; subscribe with `xf.sub('db:watchStatus', …)`, unsubscribe in `disconnectedCallback`).

- [ ] **Step 4: Run it** — expected PASS.

- [ ] **Step 5: Write the CSS layers**
- `tokens.css`: values taken from the current `--dash-*` tokens in `desktop.css` (dark: bg `#151B23`, surface `#1C242F`, surface-2 `#232D3A`, line `#2D3847`, ink `#E9EEF4`, muted `#8C98A8`, hr `#FF5C7A`, cadence `#B38CFF`, wbal `#39D0E8`, good `#57C057`, warn `#F8C73A`, danger `#FF663A`; light: the `body.white-theme` values there). Zone colours: copy the 7 zone colours the dashboard uses today (`ZONES` in `src/analytics.js`). Keep the old `--dash-*` names as aliases to the new tokens until Task 7 so unported CSS keeps working.
- `base.css`: box-sizing reset, `html { font-size: 62.5% }` kept (the app uses a 10 px root), body font/colour/bg from tokens, `.page` show/hide as today (`.page.active`), bottom bar layout: phone = tab row of 4 (Ride, Training, Workouts, Settings) with icon+label; `app-bar[data-mode=riding]` on phone shows watch controls + `.app-bar__menu` and hides the tabs until `data-menu-open`; ≥ 600 px = clock/workout name left, controls centre, tabs right, always.
- `components.css`: the components in the File Structure table.

- [ ] **Step 6: Wire it into `index.html`**
- Links in order: `tokens.css`, `base.css`, `components.css`, `ride.css`, `workouts.css`, `settings.css`, `training.css`, `rider-menu.css`, then the old `flux.css`, `desktop.css`, `riders.css` (create the empty page files now).
- Wrap the bottom bar (`#workout-name`, `watch-control`, `#menu`) in `<app-bar>`; tabs get class `.app-bar__tab`; remove the `link--workouts-report` button from `#menu`.
- Add the Training page and its tab (icon: a calendar `<symbol id="icon--calendar">`).
- Delete the old bottom-bar rules from `flux.css` and `desktop.css`.

- [ ] **Step 7: Verify**

Run: `npx jest` (no new failures), `npm run build` (succeeds), then `npm run check:visual -- --pages training`
Expected: Training passes on all sizes and themes; screenshots show the new bottom bar.

- [ ] **Step 8: Commit**

```bash
git add -A src/css src/views/app-bar.js src/views/views.js src/index.html test/app-bar.test.js
git commit -m "ui: tokens, components, app bar and Training page placeholder"
```

---

### Task 3: Ride page

**Files:**
- Create: `src/views/layout.js`, `src/views/panel-pager.js`, `test/layout.test.js`, `test/panel-pager.test.js`
- Modify: `src/index.html` (home page lines ~41–393), `src/views/training-dashboard.js` (chart range + `dataset.samples`; panels get `class="panel"`; hero meta), `src/css/ride.css`, `src/css/flux.css` + `src/css/desktop.css` (delete every rule targeting `#home-page`, `.data-tile*`, `.connections-header`, `.graph`, `#targets`, `.mode-selector`, `.lc--*`, `.ts--*`, `.hero-meta*`, `.dash-only`)

**Interfaces:**
- Produces:
  - `layoutFor(width: number, height: number) -> 'phone' | 'phone-landscape' | 'tablet' | 'desktop' | 'tv'` (boundaries from Global Constraints; phone-landscape when `height < 600 && width > height`).
  - `activeIndex(scrollLeft: number, pageWidth: number, count: number) -> number` — nearest page, clamped to `0..count-1`; returns 0 when `pageWidth <= 0`.
  - `<panel-pager for="dash-stats">` renders one dot per `.panel` child of the target and marks the active one; hidden at ≥ 600 px.
  - `live-chart`: on `layoutFor(...) === 'phone' || 'phone-landscape'` uses the 5-min range and hides legend chips and range control; the user's saved range is untouched and comes back on wider screens. Exposes `this.dataset.samples = String(sampleCount)` after each render.
- Consumes: `.tile`, `.tile__label`, `.tile__value`, `.panel`, `.segmented`, `.pill` from Task 2.

- [ ] **Step 1: Write failing tests**

```js
// test/layout.test.js
import { layoutFor } from '../src/views/layout.js';
test.each([
    [390, 844, 'phone'], [360, 740, 'phone'], [844, 390, 'phone-landscape'],
    [599, 900, 'phone'], [600, 900, 'tablet'], [820, 1180, 'tablet'],
    [1199, 800, 'tablet'], [1200, 680, 'desktop'], [1600, 900, 'desktop'],
    [2200, 1100, 'tv'], [2200, 1000, 'desktop'],
])('%i x %i is %s', (w, h, expected) => expect(layoutFor(w, h)).toBe(expected));

// test/panel-pager.test.js
import { activeIndex } from '../src/views/panel-pager.js';
test('nearest page', () => {
    expect(activeIndex(0, 360, 5)).toBe(0);
    expect(activeIndex(170, 360, 5)).toBe(0);
    expect(activeIndex(190, 360, 5)).toBe(1);
    expect(activeIndex(1440, 360, 5)).toBe(4);
});
test('clamped and safe', () => {
    expect(activeIndex(99999, 360, 5)).toBe(4);
    expect(activeIndex(-50, 360, 5)).toBe(0);
    expect(activeIndex(100, 0, 5)).toBe(0);
});
```

- [ ] **Step 2: Run** `npx jest test/layout.test.js test/panel-pager.test.js` — expected FAIL.

- [ ] **Step 3: Implement `layout.js` and `panel-pager.js`** (pager listens to `scroll` on the target with `requestAnimationFrame` throttling; dots are `<button class="pager__dot" aria-label="Panel n">` that scroll to their panel, each with a 44 px hit area).

- [ ] **Step 4: Run them** — expected PASS.

- [ ] **Step 5: Restructure the Ride page markup**
- Tiles: replace `data-tile`, `data-tile--small`, `*--heading`, `*--value` classes with `.tile`, `.tile__label`, `.tile__value` (keep ids, `z-stack`, `data-key`, value elements). Power tile gets `.tile--hero`.
- Order in the DOM = phone order: header (rider pill, connection dots) → power hero (with target beside it) → metric grid (interval time, elapsed, HR, cadence, speed, slope/distance) → `live-chart` → workout strip (`#graph-workout`) → mode row (`#targets`, compact: mode `.segmented` + target stepper) → `training-stats` (+ `<panel-pager for="dash-stats">`). Extra tiles (power-avg stack, SmO2, THb, core, skin, data-tile switch) stay in the DOM after the main six and are shown only ≥ 600 px. `#graph-power` (moxy) is shown only ≥ 600 px.
- Remove `class="dash-only"` from `live-chart` and `training-stats`.

- [ ] **Step 6: Write `ride.css`** — grid areas per layout:
- phone: single column, `height: calc(100dvh - var(--app-bar-h))`, no page scroll while riding; stats panels in a horizontal `scroll-snap-type: x mandatory` row, one panel per viewport width.
- phone-landscape: hero left, 3×2 grid right, chart across the bottom; workout strip, mode row compact; `training-stats` and pager hidden.
- tablet: hero + grid side by side, chart full width, panels as 2-column grid, page scrolls.
- desktop / tv: today's layout (left: tiles + chart + workout strip; right: sidebar panels), tv scale step as today.

- [ ] **Step 7: Update `training-dashboard.js`** — `live-chart` range from `layoutFor`, `dataset.samples`; sections get `class="panel"` and headings `class="panel__title"`; re-evaluate on `resize` (debounced 150 ms).

- [ ] **Step 8: Delete the old Ride page rules** from `flux.css` and `desktop.css` (selectors listed under Files).

- [ ] **Step 9: Verify**

Run: `npx jest` (no new failures), then `npm run check:visual -- --pages ride`
Expected: PASS on all sizes and themes, including the rotate step. Look at the phone screenshots: the ride view fits one screen, mode row and pager dots visible, panels one at a time.

- [ ] **Step 10: Commit**

```bash
git add -A src/index.html src/views src/css test/layout.test.js test/panel-pager.test.js
git commit -m "ui: responsive Ride page from phone to TV"
```

---

### Task 4: Settings page

**Files:**
- Modify: `src/index.html` (settings page lines ~641–1595), `src/css/settings.css`, `src/css/flux.css` (delete settings rules: `.settings-tile*`, `.device-card*`, `.option*`, `.sound--*`, `.protocol-switch`, `.list--sub-heading`, `#about`, `.header--tab--group`, `#profile`, `.auth*`, `.register--form` etc.)

**Interfaces:**
- Consumes: components from Task 2. Keeps every element the device code uses (`connection-switch`, `source-switch`, `protocol-switch`, `battery-level`, value elements, `ant-device-request`, `sound-control`, `virtual-state-source`, `auto-start`, `auto-pause`, `theme-layout`, `measurement-value`, FTP and weight inputs/buttons).

- [ ] **Step 1: Remove upstream account UI** — delete `#view--settings-profile` (auth forms, turnstile container, delete-account dialog, `account-badge`, `o-auth`, account management), the settings header tab group (only one view remains, so `#view--settings-settings` becomes the page body), `dock-mode-btn` and the `dock-mode-default` option row.

- [ ] **Step 2: Restyle the remaining sections** — sections become `.card`s in this order: Profile (FTP, weight, units), Devices (one `.card` per device; tiles inside use `.tile`), Options (rows as `.list-row` with `.toggle` / `.segmented`), About. Layout: one column on phone, two columns ≥ 1200 px.

- [ ] **Step 3: Delete the old settings rules** listed under Files.

- [ ] **Step 4: Verify**

Run: `npx jest`, then `npm run check:visual -- --pages settings,ride`
Expected: PASS. In the browser: changing FTP still updates the Ride page W/kg and zones; theme switch still flips dark/light; connecting a device still opens the Bluetooth chooser (manual check in Chrome).

- [ ] **Step 5: Commit**

```bash
git add -A src/index.html src/css
git commit -m "ui: Settings on shared components; remove upstream account and dock mode controls"
```

---

### Task 5: Workouts page

**Files:**
- Modify: `src/index.html` (workouts page lines ~395–640), `src/views/activity-list.js` (remove upload buttons), `src/css/workouts.css`, `src/css/flux.css` (delete `.workout-list*`, `.workout--*`, `.editor*`, `.ride-report`, `.laps*`, `.planned--list`, `.activity--*`, `.file-btn*`, `.workout-loader*` rules), `src/css/desktop.css` (`.workout-loader--formats`)

**Interfaces:**
- Consumes: components from Task 2.
- Produces: Workouts page with two tabs (`.tabs`): Library, Editor. Library contains, in order: "Your rides" (`<activity-list>`, download only), the workout loader, and `<workout-list>`.

- [ ] **Step 1: Remove** the Ride Report sub-tab (`#link--workouts-report`, `#view--workouts-report` incl. `power-in-zone`, `laps-list`) and `<planned-list>`.

- [ ] **Step 2: Strip uploads from `activity-list.js`** — remove the Strava / intervals.icu / TrainingPeaks upload buttons and their handlers; keep list, `.fit` download and remove.

- [ ] **Step 3: Restyle** — tabs as `.tabs`; workout rows as `.list-row` (name, category `.badge`, duration, select radio, menu); loader as a `.card` with the file button as `.btn--secondary`; editor fields as `.field`. Library one column on phone, centred max-width column on wider screens.

- [ ] **Step 4: Delete the old workouts rules** listed under Files.

- [ ] **Step 5: Verify**

Run: `npx jest`, `npm run check:visual -- --pages workouts`
Expected: PASS. Manual: load `.zwo`, `.erg`, `.mrc`, `.txt` together → all appear; a bad file shows "<name>: not a valid workout file."; select a workout → Ride page shows it; ride 10 s with `?simulate`, stop, save → the ride appears under "Your rides" for a rider **without** an account and downloads a `.fit`.

- [ ] **Step 6: Commit**

```bash
git add -A src/index.html src/views/activity-list.js src/css
git commit -m "ui: Workouts on shared components; drop Ride Report and upstream planned list"
```

---

### Task 6: Rider menu, removals and legacy cleanup

**Files:**
- Create: `src/legacy-prefs.js`, `test/legacy-prefs.test.js`
- Modify: `src/views/rider-menu.js` (template classes), `src/css/rider-menu.css` (from `riders.css`), `src/db.js` (drop dock mode, planned, `models.api.start()`; call `cleanupLegacyPrefs` at start), `src/models/models.js` (drop `API` import, `api`, `planned`, `dockMode`, `activity.upload`), `src/views/views.js` (drop `auth-forms.js`, `planned-list.js` imports), `src/views/data-views.js` (drop `o-auth`, `account-badge`, `dock-mode-*`, `power-in-zone`, `laps-list`, turnstile loader), `src/sw.js` (cache list)
- Delete: `src/views/auth-forms.js`, `src/views/planned-list.js`, `src/models/api.js`, `src/models/auth.js`, `src/models/intervals.js`, `src/models/strava.js`, `src/models/training-peaks.js`, `test/models/api.test.js`

**Interfaces:**
- Produces: `cleanupLegacyPrefs(storage: Storage, keyFor: (k: string) => string) -> string[]` — removes `keyFor('dockMode')` and `keyFor('planned')`, and resets `keyFor('page')` to `'home'` when its stored value is `'report'` or `'dock'`; returns the keys it changed. Idempotent. Never touches any other key.
- Consumes: `riders.key` from `src/riders.js`.

- [ ] **Step 1: Write the failing test**

```js
import { cleanupLegacyPrefs } from '../src/legacy-prefs.js';
const mem = (o) => ({ d: {...o}, getItem(k){return k in this.d ? this.d[k] : null},
    setItem(k,v){this.d[k]=String(v)}, removeItem(k){delete this.d[k]} });
const id = k => k;
test('removes dock mode and planned, keeps everything else', () => {
    const s = mem({dockMode: 'true', planned: '[]', ftp: '250', theme: 'dark'});
    expect(cleanupLegacyPrefs(s, id).sort()).toEqual(['dockMode', 'planned']);
    expect(s.d).toEqual({ftp: '250', theme: 'dark'});
});
test('report page falls back to home', () => {
    const s = mem({page: 'report'});
    cleanupLegacyPrefs(s, id);
    expect(s.d.page).toBe('home');
});
test('per-rider keys and idempotent', () => {
    const s = mem({'rider:abc:dockMode': 'true', dockMode: 'true'});
    const key = k => `rider:abc:${k}`;
    expect(cleanupLegacyPrefs(s, key)).toEqual(['rider:abc:dockMode']);
    expect(s.d).toEqual({dockMode: 'true'});
    expect(cleanupLegacyPrefs(s, key)).toEqual([]);
});
```

- [ ] **Step 2: Run** — expected FAIL. **Step 3: Implement.** **Step 4: Run** — expected PASS.

- [ ] **Step 5: Remove the upstream code** listed under Files; then `grep -rn "models.api\|models.planned\|dockMode\|auth-forms\|planned-list\|training-peaks\|trainingPeaks" src` must return nothing.

- [ ] **Step 6: Move the rider menu onto components** — `rm--btn` → `.btn` variants, `rm--form` → `.field`s, `rm--tabs` → `.tabs`, `rm--row` → `.list-row`, `rm--flash` → `.flash`, `rm--tag` → `.pill`; dialog full-screen on phone, centred max 720 px wider. Keep the `rm--` classes the JS queries (`.rm--pill`, `.rm--body`, `.rm--tabs`, `.rm--flash`, `.rm--close`, `.rm--avatar`, `.rm--name`, `.rm--who`, `.rm--table`) as hooks. Rename `riders.css` → `rider-menu.css` with only layout left.

- [ ] **Step 7: Verify**

Run: `npx jest` (still exactly the 50 inherited failures; `api.test.js` is gone with the code it tested), `npm run test:server`, `npm run build`, `npm run check:visual` (all pages)
Expected: all pass. Manual: sign in, Ride history, Users tab, intervals.icu key form all work on phone and desktop sizes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "ui: rider menu on shared components; remove upstream auth, connections, planned and dock mode"
```

---

### Task 7: Delete the old CSS and final verification

**Files:**
- Delete: `src/css/flux.css`, `src/css/desktop.css`, `src/css/riders.css`
- Modify: `src/index.html` (drop their links and the Roboto font link if unused), `src/css/tokens.css` (drop the `--dash-*` aliases; replace remaining uses), `README.md` (fork section: one layout for every screen; no dock mode; accounts and connections only in the rider menu)

- [ ] **Step 1: Delete the files and links; replace any remaining `--dash-*` uses** — `grep -rn "dash-\(bg\|panel\|line\|ink\|muted\)" src` must return nothing.

- [ ] **Step 2: Check the rule** — page CSS has no raw values: `grep -nE "#[0-9a-fA-F]{3,8}\b|[0-9]+px" src/css/{ride,workouts,settings,training,rider-menu}.css` returns only breakpoint media queries and grid track sizes; fix anything else with tokens or a component.

- [ ] **Step 3: Full verification**

Run: `npx jest`, `npm run test:server`, `npm run build`, `npm run check:visual`
Expected: unit tests = 50 inherited failures only; server 14/14; build OK; visual check PASS on every page, size and theme. Then `docker compose up -d --build` and open `http://localhost:8080` → app loads with the new UI.

- [ ] **Step 4: Ask the user to review the screenshots** in `test/visual/out/` before calling the subproject done.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ui: remove flux.css and the old desktop styles"
```
