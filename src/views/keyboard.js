// @ts-check
import { xf, exists } from '../functions.js';
import { formatTime } from '../utils.js';
import { ControlMode, } from '../ble/enums.js';

const SHORTCUTS = [
    ['Space', 'Start or pause ride'],
    ['↑ / ↓', 'Increase or decrease target'],
    ['E', 'ERG mode'],
    ['R', 'Resistance mode'],
    ['S', 'Slope (Sim) mode'],
    ['L', 'Mark lap / next interval (while riding)'],
    ['?', 'Show or close shortcuts'],
    ['Esc', 'Close dialogs or full screen'],
];

function toggleShortcutsDialog() {
    if(typeof document === 'undefined' || !document.body) return;
    /** @type {HTMLDialogElement} */
    let dlg = document.querySelector('#dialog--shortcuts');
    if(dlg?.open) { dlg.close?.(); return; }
    if(!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'dialog--shortcuts';
        dlg.className = 'dialog kb-dialog';
        dlg.setAttribute('aria-labelledby', 'kb-dialog-title');
        dlg.innerHTML = `
            <div class="kb-dialog__head">
                <h2 id="kb-dialog-title" class="card__title">Keyboard shortcuts</h2>
                <button type="button" class="btn btn--icon" data-kb-close aria-label="Close">×</button>
            </div>
            <dl class="kb-list">
                ${SHORTCUTS.map(([k, desc]) => `<div><dt><kbd>${k}</kbd></dt><dd>${desc}</dd></div>`).join('')}
            </dl>
            <p class="card__note">Ride shortcuts are active on the Ride page while not typing or editing layout.</p>`;
        dlg.addEventListener('click', e => {
            if(e.target === dlg || /** @type {Element} */ (e.target).closest('[data-kb-close]')) dlg.close?.();
        });
        document.body.append(dlg);
    }
    if(typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.open = true;
}

// keys that aren't ride shortcuts: typing in any field (in a form or not, e.g.
// a screen name in Edit layout or W′), a key a control already handled (a tile
// handle in Edit layout), and modifier combinations
function ignoredKey(e) {
    const t = e.target;
    const typing = t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    const interactive = t?.closest?.('button, a, summary, [role="button"], [role="tab"]');
    const modalOpen = typeof document !== 'undefined' && !!document.querySelector('dialog[open]');
    const home = typeof document !== 'undefined' ? document.querySelector('#home-page') : null;
    const offRide = !!(home && !home.classList.contains('active'));
    const editing = typeof document !== 'undefined' && !!document.querySelector('.is-editing');
    return !!(e.defaultPrevented || e.isComposing || e.keyCode === 229 ||
              e.ctrlKey || e.shiftKey || e.altKey || e.metaKey ||
              typing || interactive || modalOpen || offRide || editing || exists(t?.form));
}

function isHelpKey(e) {
    if(e.key !== '?' || e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return false;
    const t = e.target;
    const typing = t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    const interactive = t?.closest?.('button, a, summary, [role="button"], [role="tab"]');
    const otherModal = typeof document !== 'undefined' && !!document.querySelector('dialog[open]:not(#dialog--shortcuts)');
    return !(typing || interactive || otherModal || exists(t?.form));
}

function formatLapToast(lapNumber, splitSeconds) {
    const safeSec = Math.max(0, Math.round(Number(splitSeconds) || 0));
    return `Lap ${lapNumber} · ${formatTime({ value: safeSec, format: 'mm:ss', unit: 'seconds' })}`;
}

/** @this {any} */
function Keyboard() {

    const isKeyUp    = (code, key) => code === 'ArrowUp' || key === 'ArrowUp';
    const isKeyDown  = (code, key) => code === 'ArrowDown' || key === 'ArrowDown';
    const isKeyE     = (code, key) => code === 'KeyE' || key === 'e';
    const isKeyR     = (code, key) => code === 'KeyR' || key === 'r';
    const isKeyS     = (code, key) => code === 'KeyS' || key === 's';
    const isKeyL     = (code, key) => (code === 'KeyL' || key === 'l') && key !== 'L';
    const isKeySpace = (code, key) => code === 'Space' || key === ' ';

    window.addEventListener('keydown', onKeydown.bind(this));

    function onKeydown(e) {
        if(isHelpKey(e)) {
            e.preventDefault();
            toggleShortcutsDialog();
            return;
        }

        const code = e.code;
        const key = e.key;

        if(ignoredKey(e)) return;

        if(isKeyUp(code, key)) {
            e.preventDefault();
            xf.dispatch('key:up');
        }
        if(isKeyDown(code, key)) {
            e.preventDefault();
            xf.dispatch('key:down');
        }
        if(isKeyS(code, key)) {
            xf.dispatch('key:s');
        }
        if(isKeyR(code, key)) {
            xf.dispatch('key:r');
        }
        if(isKeyE(code, key)) {
            xf.dispatch('key:e');
        }
        if(isKeyL(code, key)) {
            xf.dispatch('key:l');
        }
        if(isKeySpace(code, key)) {
            e.preventDefault();
            xf.dispatch('key:space');
        }
    }
}


function KeyboardControls() {
    let mode = ControlMode.erg;
    xf.sub('db:mode', x => mode = x);

    let watchStatus = 'stopped';
    let workoutStatus = 'stopped';
    let lapTime = 0;
    let intervalDuration = 0;
    let recentSplitSec = 0;
    let lapCount = 0;

    function computeSplitSec() {
        if(workoutStatus === 'started' && intervalDuration > 0) {
            return Math.max(0, intervalDuration - lapTime);
        }
        return Math.max(0, lapTime);
    }

    xf.sub('db:watchStatus', x => {
        watchStatus = x;
        if(x === 'stopped') {
            lapCount = 0;
            lapTime = 0;
            intervalDuration = 0;
            recentSplitSec = 0;
        }
    });
    xf.sub('db:workoutStatus', x => { workoutStatus = x; });
    xf.sub('db:intervalDuration', x => { intervalDuration = Number(x) || 0; });
    xf.sub('db:lapTime', x => {
        lapTime = Number(x) || 0;
        const split = computeSplitSec();
        if(split > 0) recentSplitSec = split;
    });
    xf.sub('session:restore', sessions => {
        const lastSession = Array.isArray(sessions) && sessions.length > 0 ? sessions[sessions.length - 1] : null;
        if(lastSession && Array.isArray(lastSession.laps)) {
            lapCount = lastSession.laps.length;
        }
    });

    // Modes Inc/Dec
    xf.sub('key:up', e => {
        if(mode === ControlMode.erg) {
            xf.dispatch('ui:power-target-inc');
        }
        if(mode === ControlMode.resistance) {
            xf.dispatch('ui:resistance-target-inc');
        }
        if(mode === ControlMode.sim) {
            xf.dispatch('ui:slope-target-inc');
        }
    });
    xf.sub('key:down', e => {
        if(mode === ControlMode.erg) {
            xf.dispatch('ui:power-target-dec');
        }
        if(mode === ControlMode.resistance) {
            xf.dispatch('ui:resistance-target-dec');
        }
        if(mode === ControlMode.sim) {
            xf.dispatch('ui:slope-target-dec');
        }
    });

    // Modes
    xf.sub('key:e', e => {
        xf.dispatch('ui:mode-set', ControlMode.erg);
        xf.dispatch('ui:toast', 'ERG mode');
    });
    xf.sub('key:r', e => {
        xf.dispatch('ui:mode-set', ControlMode.resistance);
        xf.dispatch('ui:toast', 'Resistance mode');
    });
    xf.sub('key:s', e => {
        xf.dispatch('ui:mode-set', ControlMode.sim);
        xf.dispatch('ui:toast', 'Slope mode');
    });

    // Watch
    xf.sub('key:space', e => {
        if(watchStatus === 'paused' || watchStatus === 'stopped') {
            xf.dispatch('ui:watchStart');
            xf.dispatch('ui:workoutStart');
        } else {
            xf.dispatch('ui:watchPause');
        }
    });
    xf.sub('key:l', e => {
        if(watchStatus !== 'started') return;
        xf.dispatch('ui:watchLap');
    });
    xf.sub('ui:watchLap', e => {
        if(watchStatus !== 'started') return;
        const splitSec = computeSplitSec() || recentSplitSec;
        lapCount += 1;
        recentSplitSec = 0;
        xf.dispatch('ui:toast', formatLapToast(lapCount, splitSec));
        xf.dispatch('watch:lap-beep');
    });
}

Keyboard();
KeyboardControls();

export { Keyboard, KeyboardControls, ignoredKey, isHelpKey, toggleShortcutsDialog, formatLapToast, SHORTCUTS };
