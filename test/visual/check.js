#!/usr/bin/env node
//
// Visual check: opens every page with the simulated rider at phone, tablet,
// desktop sizes, dark and light, and fails on things a rider would notice:
// console errors, sideways scrolling, tap targets too small on a phone,
// text overflowing its tile, and lost ride data when the phone is rotated.
//
//   npm start                      (dev server, other terminal)
//   npm run check:visual -- [--pages ride,training,workouts,settings] [--url http://localhost:1234]
//
// Browser: CHROME_PATH, else Playwright's default Chromium.
// Screenshots: test/visual/out/<page>-<size>-<theme>.png
//

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const PAGES = {
    ride:     '#home-tab-btn',
    riders:   '#home-tab-btn', // the rider menu dialog, opened from the Ride page
    training: '#training-tab-btn',
    'training-day': '#training-tab-btn', // today's day dialog on the Training page
    workouts: '#workouts-tab-btn',
    settings: '#settings-tab-btn',
    // the ride page (#ride=<id>), for the seeded workout ride and the outdoor ride without power
    'ride-analysis': 'ride:seed-2',
    'ride-analysis-outdoor': 'ride:seed-outdoor',
};
const SIZES = {
    'phone':           {width: 390,  height: 844, phone: true},
    'small-phone':     {width: 360,  height: 740, phone: true},
    'phone-landscape': {width: 844,  height: 390, phone: true},
    'tablet':          {width: 820,  height: 1180},
    'desktop':         {width: 1600, height: 900},
};
const THEMES = ['dark', 'light'];
const IGNORED_ERRORS = /api\.auuki\.com|ERR_FAILED|\/api\/.*50[24]|status of 50[24]/;

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
}

const url = arg('url', 'http://localhost:1234');
const pages = arg('pages', Object.keys(PAGES).join(',')).split(',').map(s => s.trim()).filter(Boolean);
const outDir = path.join(__dirname, 'out');

// runs in the page: layout problems on the visible page
function inspect({isPhone, longValues}) {
    const problems = [];
    if(longValues) {
        // the longest values a ride shows, written just before measuring
        // (live updates would overwrite them within a second)
        const put = (sel, text) => document.querySelectorAll(sel).forEach(el => { el.textContent = text; });
        put('#data-tile--power .tile__value', '1234');
        put('#data-tile--target .tile__value', '1234');
        put('#elapsed-time', '1:23:45');
        put('#interval-time', '01:23:45');
        put('#data-tile--heart-rate .tile__value', '188');
        put('#data-tile--cadence .tile__value', '115');
        put('#data-tile--speed .tile__value', '45.6');
        put('#data-tile--distance .tile__value', '123.4');
    }
    const visible = el => {
        const r = el.getBoundingClientRect();
        if(r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const label = el => {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
        const text = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        return `<${el.localName}${id}${cls}> "${text}"`;
    };

    const doc = document.documentElement;
    if(doc.scrollWidth > window.innerWidth + 1) {
        const wide = [...document.querySelectorAll('body *')]
            .filter(el => visible(el) && el.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 3).map(label);
        problems.push(`page scrolls sideways (${doc.scrollWidth}px > ${window.innerWidth}px): ${wide.join(', ')}`);
    }

    // content past the right edge, even where an overflow: hidden clips it
    for(const el of document.querySelectorAll('.card, .tile, .panel, .list-row, .btn')) {
        if(!visible(el) || el.closest('[data-check-ignore]')) continue;
        const r = el.getBoundingClientRect();
        // the stats panels and the Ride screens out of view are swiped to
        if(r.right > window.innerWidth + 1 && !el.closest('.ride__stats') && !el.closest('.rs-screen[aria-hidden="true"]')) {
            problems.push(`runs off the right edge (${Math.round(r.right)}px > ${window.innerWidth}px): ${label(el)}`);
        }
    }

    if(isPhone) {
        const tappable = 'button, a[href], [role=button], [role=tab], input:not([type=hidden]), select, .control--btn, .btn';
        for(const el of document.querySelectorAll(tappable)) {
            if(!visible(el) || el.closest('[data-check-ignore]')) continue;
            // links inside running text are exempt (WCAG 2.5.8 inline exception)
            if(el.localName === 'a' && getComputedStyle(el).display === 'inline') continue;
            const r = el.getBoundingClientRect();
            if(r.bottom < 0 || r.top > window.innerHeight) continue; // only what's on screen
            if(r.width < 44 - 0.5 || r.height < 44 - 0.5) {
                problems.push(`tap target ${Math.round(r.width)}×${Math.round(r.height)}: ${label(el)}`);
            }
        }
    }

    for(const el of document.querySelectorAll('.tile__value')) {
        if(!visible(el)) continue;
        if(el.scrollWidth > el.clientWidth + 1) {
            problems.push(`text overflows its tile: ${label(el)}`);
        }
        // clipped from above or below inside the tile
        const tile = el.closest('.tile');
        if(tile) {
            const r = el.getBoundingClientRect(), t = tile.getBoundingClientRect();
            if(r.top < t.top - 1 || r.bottom > t.bottom + 1) {
                problems.push(`text clipped by its tile: ${label(el)}`);
            }
        }
    }
    return problems;
}

async function openTab(page, selector, isPhone) {
    const tab = page.locator(selector);
    if(await tab.count() === 0) return false;
    if(!(await tab.first().isVisible()) && isPhone) {
        const menu = page.locator('.app-bar__menu');
        if(await menu.count() && await menu.first().isVisible()) await menu.first().click();
    }
    await tab.first().click();
    await page.waitForTimeout(400);
    return true;
}

async function rotateCheck(page) {
    const read = () => page.evaluate(() => ({
        elapsed: document.querySelector('#elapsed-time')?.textContent?.trim() ?? '',
        samples: Number(document.querySelector('live-chart')?.dataset?.samples ?? NaN),
    }));
    const seconds = t => t.split(':').reduce((acc, x) => acc * 60 + (Number(x) || 0), 0);
    const before = await read();
    const size = page.viewportSize();
    await page.setViewportSize({width: size.height, height: size.width});
    await page.waitForTimeout(2000);
    await page.setViewportSize(size);
    await page.waitForTimeout(500);
    const after = await read();
    const problems = [];
    if(seconds(after.elapsed) < seconds(before.elapsed)) {
        problems.push(`elapsed time went back after rotating: ${before.elapsed} → ${after.elapsed}`);
    }
    if(Number.isFinite(before.samples) && after.samples < before.samples) {
        problems.push(`chart lost data after rotating: ${before.samples} → ${after.samples} samples`);
    }
    return problems;
}

async function main() {
    fs.mkdirSync(outDir, {recursive: true});
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || undefined,
        args: ['--no-sandbox'],
    });
    const failures = [];
    const missing = new Set();

    for(const [sizeName, size] of Object.entries(SIZES)) {
        for(const theme of THEMES) {
            const context = await browser.newContext({viewport: {width: size.width, height: size.height}, hasTouch: !!size.phone});
            // headless Chrome has no Web Bluetooth; a stub shows what a Chrome
            // user sees instead of the "browser not supported" banner
            await context.addInitScript(() => {
                if(!('bluetooth' in navigator)) {
                    Object.defineProperty(navigator, 'bluetooth', {value: {
                        getAvailability: async () => false,
                        getDevices: async () => [],
                        requestDevice: async () => { throw new DOMException('stub', 'NotFoundError'); },
                        addEventListener() {}, removeEventListener() {},
                    }});
                }
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('console', m => { if(m.type() === 'error' && !IGNORED_ERRORS.test(m.text())) errors.push(m.text().slice(0, 200)); });

            await page.goto(`${url}/?simulate&history`, {waitUntil: 'networkidle'});
            await page.waitForTimeout(800);
            if(theme === 'light') {
                // the theme switch in Settings cycles DARK → WHITE → AUTO
                await page.evaluate(() => document.querySelector('theme-layout')?.dispatchEvent(new PointerEvent('pointerup')));
                await page.waitForTimeout(200);
            }
            const start = page.locator('#watch-start');
            if(await start.count() && await start.first().isVisible()) await start.first().click();
            await page.waitForTimeout(6000);

            for(const name of pages) {
                const where = `${name} @ ${sizeName} ${theme}`;
                if(!PAGES[name]) { failures.push(`${where}: unknown page`); continue; }
                if(PAGES[name].startsWith('ride:')) {
                    // the dev seed's ride files: open the one whose id starts this way
                    const prefix = PAGES[name].slice(5);
                    const id = await page.evaluate(async prefix => {
                        const db = await new Promise(r => { const q = indexedDB.open('store'); q.onsuccess = () => r(q.result); });
                        const keys = await new Promise(r => { const q = db.transaction('activity').objectStore('activity').getAllKeys(); q.onsuccess = () => r(q.result); });
                        return keys.find(k => String(k).startsWith(prefix)) ?? null;
                    }, prefix).catch(() => null);
                    if(!id) { missing.add(name); continue; }
                    await page.evaluate(id => { location.hash = `#ride=${encodeURIComponent(id)}`; }, id);
                    await page.waitForTimeout(1500);
                } else if(!(await openTab(page, PAGES[name], size.phone))) { missing.add(name); continue; }
                if(name === 'training-day') {
                    await page.locator('.cal-day.is-today .cal-open').first().click();
                    await page.waitForTimeout(400);
                }
                if(name === 'riders') {
                    // while riding, very short screens hide the header (and the pill)
                    const pill = page.locator('.rm--pill').first();
                    if(!(await pill.isVisible())) { missing.add(`riders @ ${sizeName} (pill hidden while riding)`); continue; }
                    await pill.click();
                    await page.waitForTimeout(400);
                }
                const problems = [];
                // rotate first: inspect() writes long test values into the tiles
                if(name === 'ride' && size.phone && sizeName === 'phone') problems.push(...await rotateCheck(page));
                problems.push(...await page.evaluate(inspect, {isPhone: !!size.phone, longValues: name === 'ride'}));
                await page.screenshot({path: path.join(outDir, `${name}-${sizeName}-${theme}.png`)});
                for(const p of problems) failures.push(`${where}: ${p}`);
                if(name === 'riders' || name === 'training-day') {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(200);
                }
            }
            for(const e of new Set(errors)) failures.push(`${sizeName} ${theme}: console: ${e}`);
            await context.close();
        }
    }
    // a custom layout: three screens (a large heart rate, no chart), every
    // screen and edit mode inspected at every size
    const custom = {version: 1, ride: Object.fromEntries(['phone', 'large'].map(cls => [cls, {screens: [
        {id: 'a', name: 'Numbers', tiles: [{id: 'heart-rate', size: 'large'}, {id: 'power', size: 'wide'}, {id: 'cadence', size: 'small'}, {id: 'interval-time', size: 'small'}, {id: 'elapsed-time', size: 'small'}, {id: 'speed', size: 'small'}]},
        {id: 'b', name: 'Climb', tiles: [{id: 'slope', size: 'wide'}, {id: 'power', size: 'small'}, {id: 'workout', size: 'large'}, {id: 'stats', size: 'large'}]},
        {id: 'c', name: 'Empty', tiles: []},
    ]}]))};
    for(const [sizeName, size] of Object.entries(SIZES)) {
        const context = await browser.newContext({viewport: {width: size.width, height: size.height}, hasTouch: !!size.phone});
        await context.addInitScript((layout) => {
            try { localStorage.setItem('layouts', layout); } catch(e) {}
            if(!('bluetooth' in navigator)) {
                Object.defineProperty(navigator, 'bluetooth', {value: {
                    getAvailability: async () => false, getDevices: async () => [],
                    addEventListener() {}, removeEventListener() {},
                }});
            }
        }, JSON.stringify(custom));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`${url}/?simulate`, {waitUntil: 'networkidle'});
        await page.waitForTimeout(800);
        for(const i of [0, 1, 2]) {
            await page.evaluate(i => document.querySelector('ride-screens').show(i), i);
            await page.waitForTimeout(700);
            const problems = await page.evaluate(inspect, {isPhone: !!size.phone, longValues: true});
            await page.screenshot({path: path.join(outDir, `ride-custom-${i}-${sizeName}.png`)});
            for(const p of problems) failures.push(`ride custom screen ${i + 1} @ ${sizeName}: ${p}`);
        }
        await page.evaluate(() => document.querySelector('ride-screens').show(0));
        await page.click('[data-ride-layout]');
        await page.waitForTimeout(400);
        for(const p of await page.evaluate(inspect, {isPhone: !!size.phone, longValues: false})) failures.push(`ride edit layout @ ${sizeName}: ${p}`);
        await page.screenshot({path: path.join(outDir, `ride-edit-${sizeName}.png`)});
        for(const e of new Set(errors)) failures.push(`ride custom @ ${sizeName}: console: ${e}`);
        await context.close();
    }

    // the phone's default Ride screen: the tiles of the old fixed layout, live
    // (not placeholders), and a broken saved layout still gives tiles
    for(const saved of [null, '{"version":1,"ride":"broken"}']) {
        const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true});
        await context.addInitScript((saved) => {
            try { if(saved) localStorage.setItem('layouts', saved); } catch(e) {}
            if(!('bluetooth' in navigator)) {
                Object.defineProperty(navigator, 'bluetooth', {value: {
                    getAvailability: async () => false, getDevices: async () => [],
                    addEventListener() {}, removeEventListener() {},
                }});
            }
        }, saved);
        const page = await context.newPage();
        await page.goto(`${url}/?simulate`, {waitUntil: 'networkidle'});
        await page.waitForTimeout(800);
        const shown = await page.evaluate(() => Object.fromEntries(
            ['power', 'target', 'heart-rate', 'cadence', 'speed', 'distance'].map(t => {
                const el = document.querySelector(`[data-screen="0"] #data-tile--${t}`);
                return [t, !!el && getComputedStyle(el).display !== 'none'];
            })));
        const label = saved ? 'a broken saved layout' : 'the default layout';
        if(Object.values(shown).some(v => !v)) failures.push(`ride @ phone with ${label}: tiles missing on the first screen (${JSON.stringify(shown)})`);
        await context.close();
    }

    await browser.close();

    for(const name of missing) console.log(`note: page "${name}" not present, skipped`);
    if(failures.length) {
        console.log(`\n${failures.length} problem(s):`);
        for(const f of failures) console.log(`  ✗ ${f}`);
        console.log(`\nscreenshots: ${outDir}`);
        process.exit(1);
    }
    console.log(`✓ visual check passed (${pages.join(', ')}); screenshots: ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(2); });
