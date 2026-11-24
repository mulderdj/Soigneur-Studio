//
// Screenshots and the screencast for docs/walkthrough/README.md.
//
//   npm start                        # dev server (the simulated rider only exists there)
//   node docs/walkthrough/capture.js [--url http://localhost:1234] [--only shots|video]
//
// Uses ?simulate&history in a fresh browser profile: a simulated rider and a
// generated history, nothing from your own riders. It signs a demo account
// up on the dev account server (the first account there becomes its admin),
// so run it against a scratch account server, not your real one. The
// intervals.icu and Garmin cards are shown connected with a canned status:
// the walkthrough needs no API key. Set CHROME_PATH when Playwright's own
// browser is missing.
//
// Needs ffmpeg for the .mp4 and .gif.
//

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
};
const url = arg('url', 'http://localhost:1234');
const only = arg('only', 'all');
const dir = path.join(__dirname, 'img');
const DESKTOP = {width: 1440, height: 900};
const PHONE = {width: 390, height: 844};

const pause = (page, ms) => page.waitForTimeout(ms);

async function newPage(browser, {viewport, phone = false, scale = 1}) {
    const context = await browser.newContext({viewport, deviceScaleFactor: scale, hasTouch: phone, isMobile: phone});
    await context.addInitScript(() => {
        // headless Chrome has no Web Bluetooth: show what a Chrome user sees
        if(!('bluetooth' in navigator)) {
            Object.defineProperty(navigator, 'bluetooth', {value: {
                getAvailability: async () => false, getDevices: async () => [],
                requestDevice: async () => { throw new DOMException('stub', 'NotFoundError'); },
                addEventListener() {}, removeEventListener() {},
            }});
        }
    });
    // the intervals.icu card, connected, with a status (no key needed)
    await context.route('**/api/me/connections', async route => {
        const res = await route.fetch();
        const body = await res.json().catch(() => ({}));
        body.intervals = {...body.intervals, connected: true, athlete: 'Demo rider', athleteId: 'i000000', autoUpload: true,
                          sync: {lastRun: Date.now() - 6 * 60000, stored: 412, skipped: {STRAVA: 12}, planSkipped: 0, error: null}};
        body.garmin = {...body.garmin, connected: true, expiresOn: new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10),
                       thresholds: {cycling: 165, running: 172},
                       sync: {lastRun: Date.now() - 4 * 60000, activities: 386, days: 90, error: null}};
        await route.fulfill({response: res, json: body});
    });
    const page = await context.newPage();
    return {context, page};
}

async function start(page) {
    await page.goto(`${url}/?simulate&history`, {waitUntil: 'networkidle'});
    await pause(page, 1200);
    // the dev-only badge is not part of the app
    await page.evaluate(() => {
        for(const el of document.body.children) if(el.textContent === 'Simulated rider') el.remove();
    });
}

async function tab(page, id, phone = false) {
    const t = page.locator(id).first();
    if(!(await t.isVisible()) && phone) await page.locator('.app-bar__menu').first().click();
    await t.click();
    await pause(page, 600);
    // each page starts at its top
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        for(const el of document.querySelectorAll('*')) if(el.scrollTop > 0) el.scrollTop = 0;
    });
    await pause(page, 200);
}

async function ride(page, seconds) {
    const go = page.locator('#watch-start').first();
    if(await go.isVisible()) await go.click();
    await pause(page, seconds * 1000);
}

const shot = (page, name, opts = {}) => page.screenshot({path: path.join(dir, `${name}.png`), ...opts});
const shotOf = (locator, name) => locator.screenshot({path: path.join(dir, `${name}.png`)});

async function signUp(page) {
    await page.locator('.rm--pill').first().click();
    await pause(page, 400);
    await page.locator('[data-tab="account"]').click();
    await pause(page, 400);
    const form = page.locator('form[data-form="register"]').first();
    if(await form.count()) {
        await form.locator('input[name="username"]').fill('demo');
        await form.locator('input[name="password"]').fill('demo-password-1');
        await form.locator('button[type="submit"]').click();
        await pause(page, 1500);
    }
}

async function shots(browser) {
    fs.mkdirSync(dir, {recursive: true});

    // --- desktop, dark ---
    const {context, page} = await newPage(browser, {viewport: DESKTOP});
    await start(page);
    await ride(page, 75);
    await shot(page, 'ride-desktop');
    // the second built-in screen, then back
    await page.evaluate(() => document.querySelector('ride-screens').show(1));
    await pause(page, 900);
    await shot(page, 'ride-big-numbers');
    await page.evaluate(() => document.querySelector('ride-screens').show(0));
    await pause(page, 600);

    await tab(page, '#training-tab-btn');
    await pause(page, 1500);
    await shot(page, 'training-desktop');
    await shotOf(page.locator('training-calendar'), 'training-calendar');
    for(const [sel, name] of [['volume-card', 'progress-volume'], ['curve-card', 'progress-curve'],
                              ['zones-card', 'progress-zones'], ['ftp-card', 'progress-ftp'], ['form-card', 'training-form'],
                              ['health-card', 'training-health']]) {
        await page.locator(sel).scrollIntoViewIfNeeded();
        await shotOf(page.locator(sel), name);
    }
    // a read-out: the mouse over the form chart, 3 weeks back
    const plot = page.locator('form-card .uc-plot');
    await plot.scrollIntoViewIfNeeded();
    const box = await plot.boundingBox();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.4);
    await pause(page, 300);
    await shotOf(page.locator('form-card'), 'training-readout');
    await page.mouse.move(0, 0);
    // a day with a run from intervals.icu, then planning a workout
    await page.locator('.cal-day.is-today .cal-open').first().click();
    await pause(page, 500);
    await shotOf(page.locator('day-dialog dialog'), 'day-dialog');
    await page.keyboard.press('Escape');
    // ride analysis: today's workout ride (Analyse ride in the day dialog)
    await page.locator('.cal-day.is-today .cal-open').first().click();
    await pause(page, 500);
    const analyse = page.locator('day-dialog [data-analyse]').first();
    if(await analyse.count()) {
        await analyse.click();
        await pause(page, 2500);
        await shot(page, 'analysis-desktop');
        await shotOf(page.locator('interval-table'), 'analysis-intervals');
        await shotOf(page.locator('ride-cards'), 'analysis-cards');
        // the outdoor ride without power
        const outdoor = await page.evaluate(async () => {
            const db = await new Promise(r => { const q = indexedDB.open('store'); q.onsuccess = () => r(q.result); });
            const keys = await new Promise(r => { const q = db.transaction('activity').objectStore('activity').getAllKeys(); q.onsuccess = () => r(q.result); });
            return keys.find(k => String(k).startsWith('seed-outdoor')) ?? null;
        });
        if(outdoor) {
            await page.evaluate(id => { location.hash = `#ride=${encodeURIComponent(id)}`; }, outdoor);
            await pause(page, 2500);
            await shotOf(page.locator('.rp-chart'), 'analysis-outdoor');
        }
        await page.locator('[data-rp-back]').first().click();
        await pause(page, 600);
    } else {
        await page.keyboard.press('Escape');
    }
    // a gym session from Garmin without heart rate: rate how hard it was
    await page.locator('.cal-day', {hasText: 'Strength'}).first().locator('.cal-open').first().click();
    await pause(page, 500);
    await shotOf(page.locator('day-dialog dialog'), 'day-rating');
    await page.locator('day-dialog [data-close]').click();
    await tab(page, '#settings-tab-btn');
    await shotOf(page.locator('.settings__profile'), 'settings-thresholds');

    await tab(page, '#workouts-tab-btn');
    await shot(page, 'workouts-desktop');
    await tab(page, '#settings-tab-btn');
    await shot(page, 'settings-desktop');

    await tab(page, '#home-tab-btn');
    await page.locator('.rm--pill').first().click();
    await pause(page, 400);
    await shotOf(page.locator('.rm--dialog').first(), 'riders');
    await page.keyboard.press('Escape');
    await signUp(page);
    await page.locator('[data-tab="account"]').click();
    await pause(page, 1200);
    await shotOf(page.locator('.rm--dialog').first(), 'account');
    await context.close();

    // --- desktop, light ---
    {
        const {context, page} = await newPage(browser, {viewport: DESKTOP});
        await start(page);
        await page.evaluate(() => document.querySelector('theme-layout')?.dispatchEvent(new PointerEvent('pointerup')));
        await tab(page, '#training-tab-btn');
        await pause(page, 1500);
        await shot(page, 'training-desktop-light');
        await context.close();
    }

    // --- edit layout (not while riding, so on a fresh page) ---
    {
        const {context, page} = await newPage(browser, {viewport: DESKTOP});
        // no simulated rider: it pedals, the clock starts by itself, and editing locks while riding
        await page.goto(`${url}/?history`, {waitUntil: 'networkidle'});
        await pause(page, 1500);
        await page.click('[data-ride-layout]');
        await pause(page, 400);
        await shot(page, 'ride-edit');
        await page.click('[data-rs="cancel"]');
        await tab(page, '#training-tab-btn');
        await pause(page, 1500);
        await page.click('[data-tl-edit]');
        await pause(page, 400);
        await shot(page, 'training-edit');
        await context.close();
    }

    // --- phone ---
    {
        const {context, page} = await newPage(browser, {viewport: PHONE, phone: true});
        await start(page);
        await ride(page, 30);
        await shot(page, 'ride-phone');
        await page.evaluate(() => document.querySelector('ride-screens').show(1));
        await pause(page, 900);
        await shot(page, 'ride-phone-big');
        await page.evaluate(() => document.querySelector('ride-screens').show(0));
        await pause(page, 600);
        await tab(page, '#training-tab-btn', true);
        await pause(page, 1500);
        await shot(page, 'training-phone');
        await page.locator('training-calendar').scrollIntoViewIfNeeded();
        await shot(page, 'training-phone-calendar');
        // the ride page on a phone
        const id = await page.evaluate(async () => {
            const db = await new Promise(r => { const q = indexedDB.open('store'); q.onsuccess = () => r(q.result); });
            const keys = await new Promise(r => { const q = db.transaction('activity').objectStore('activity').getAllKeys(); q.onsuccess = () => r(q.result); });
            return keys.find(k => /^seed-2/.test(String(k))) ?? null;
        });
        if(id) {
            await page.evaluate(id => { location.hash = `#ride=${encodeURIComponent(id)}`; }, id);
            await pause(page, 2500);
            await shot(page, 'analysis-phone');
            await page.locator('[data-rp-back]').first().click();
            await pause(page, 600);
        }
        await context.close();
    }
}

async function screencast(browser) {
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'auuki-cast-'));
    const viewport = {width: 1280, height: 800};
    const {context, page} = await newPage(browser, {viewport, scale: 1});
    // frames straight from Chrome (no Playwright ffmpeg needed), timed by Chrome
    const frames = [];
    const cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', async ({data, metadata, sessionId}) => {
        const file = path.join(tmp, `f${String(frames.length).padStart(5, '0')}.jpg`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({file, t: metadata.timestamp});
        await cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {});
    });

    const slowScroll = async (dy, steps = 12) => {
        for(let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(page, 120); }
    };
    await start(page);
    await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 85, maxWidth: viewport.width, maxHeight: viewport.height});
    await ride(page, 12);                                   // the Ride page, riding a workout
    await tab(page, '#training-tab-btn');
    await pause(page, 2500);                                // form and this week
    await page.mouse.move(640, 500);
    await slowScroll(500);                                  // the calendar
    await pause(page, 2000);
    await page.locator('.cal-day.is-today .cal-open').first().click();
    await pause(page, 2500);                                // today's dialog: a run, Hide this ride
    const search = page.locator('day-dialog input[type=search]');
    await search.click();
    await search.pressSequentially('sweet', {delay: 120});
    await pause(page, 1500);
    await page.locator('day-dialog [data-close]').click();
    await pause(page, 600);
    await slowScroll(900, 18);                              // progress: volume, power curve, zones, FTP
    await pause(page, 2500);
    await slowScroll(700, 14);
    await pause(page, 2500);
    await tab(page, '#workouts-tab-btn');
    await pause(page, 2000);
    await tab(page, '#home-tab-btn');
    await page.locator('.rm--pill').first().click();       // riders and the account
    await page.locator('.rm--dialog').first().waitFor({state: 'visible'});
    await pause(page, 1500);
    await page.locator('[data-tab="account"]').click();
    await pause(page, 3000);
    await page.keyboard.press('Escape');
    await pause(page, 800);
    await cdp.send('Page.stopScreencast');
    await context.close();
    // a concat list holds each frame as long as Chrome showed it
    const list = path.join(tmp, 'frames.txt');
    fs.writeFileSync(list, frames.map((f, i) => {
        const next = frames[i + 1]?.t ?? f.t + 1;
        return `file '${f.file}'\nduration ${Math.max(0.01, next - f.t).toFixed(3)}`;
    }).join('\n') + `\nfile '${frames.at(-1).file}'\n`);
    const master = path.join(tmp, 'cast.mp4'); // constant 25 fps
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
                            '-vf', 'fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', master]);

    const mp4 = path.join(__dirname, 'walkthrough.mp4');
    const gif = path.join(dir, 'walkthrough.gif');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', master, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                            '-crf', '28', '-preset', 'slow', '-movflags', '+faststart', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', master, '-vf',
                            'fps=6,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
                            gif]);
    fs.rmSync(tmp, {recursive: true, force: true});
    console.log(`screencast: ${mp4}\npreview:    ${gif}`);
}

(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox']});
    try {
        if(only === 'all' || only === 'shots') await shots(browser);
        if(only === 'all' || only === 'video') await screencast(browser);
    } finally {
        await browser.close();
    }
    console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
