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
    training: '#training-tab-btn',
    workouts: '#workouts-tab-btn',
    settings: '#settings-tab-btn',
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
function inspect(isPhone) {
    const problems = [];
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

    if(isPhone) {
        const tappable = 'button, a[href], [role=button], [role=tab], input:not([type=hidden]), select, .control--btn, .btn';
        for(const el of document.querySelectorAll(tappable)) {
            if(!visible(el) || el.closest('[data-check-ignore]')) continue;
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
            await context.addInitScript(t => { try { localStorage.setItem('theme', t); } catch(e) {} }, theme);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('console', m => { if(m.type() === 'error' && !IGNORED_ERRORS.test(m.text())) errors.push(m.text().slice(0, 200)); });

            await page.goto(`${url}/?simulate`, {waitUntil: 'networkidle'});
            await page.waitForTimeout(800);
            const start = page.locator('#watch-start');
            if(await start.count() && await start.first().isVisible()) await start.first().click();
            await page.waitForTimeout(6000);

            for(const name of pages) {
                const where = `${name} @ ${sizeName} ${theme}`;
                if(!PAGES[name]) { failures.push(`${where}: unknown page`); continue; }
                if(!(await openTab(page, PAGES[name], size.phone))) { missing.add(name); continue; }
                const problems = await page.evaluate(inspect, !!size.phone);
                if(name === 'ride' && size.phone && sizeName === 'phone') problems.push(...await rotateCheck(page));
                await page.screenshot({path: path.join(outDir, `${name}-${sizeName}-${theme}.png`)});
                for(const p of problems) failures.push(`${where}: ${p}`);
            }
            for(const e of new Set(errors)) failures.push(`${sizeName} ${theme}: console: ${e}`);
            await context.close();
        }
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
