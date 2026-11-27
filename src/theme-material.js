// @ts-check
//
// Material You dynamic palette generator powered by @material/material-color-utilities.
// Derives dark and light Material 3 tonal palettes from a single seed hex color
// (or a user-picked wallpaper image) and maps them onto Soigneur Studio's CSS tokens.
//

import {
    argbFromHex,
    hexFromArgb,
    themeFromSourceColor,
    sourceColorFromImage,
} from '@material/material-color-utilities';

const DEFAULT_MATERIAL_SEED = '#006874';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const TOKEN_KEYS = [
    '--bg',
    '--surface',
    '--surface-2',
    '--line',
    '--ink',
    '--muted',
    '--accent',
    '--on-accent',
    '--band',
];

/**
 * Validate and normalize a 6-digit hex color string.
 * @param {any} hex
 * @returns {string}
 */
function normalizeSeed(hex) {
    if(typeof hex === 'string' && HEX_RE.test(hex.trim())) {
        return hex.trim().toUpperCase();
    }
    return DEFAULT_MATERIAL_SEED;
}

/**
 * Convert a 6-digit hex color + alpha into an rgba(...) string.
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Build Soigneur Studio CSS token values from a seed hex color and dark/light flag.
 * @param {string} seedHex
 * @param {boolean} dark
 * @returns {Record<string, string>}
 */
function buildMaterialTokens(seedHex, dark) {
    const seed = normalizeSeed(seedHex);
    const theme = themeFromSourceColor(argbFromHex(seed));
    const {primary, neutral, neutralVariant} = theme.palettes;

    const hex = (/** @type {any} */ pal, /** @type {number} */ tone) => hexFromArgb(pal.tone(tone));

    if(dark) {
        const accent = hex(primary, 80);
        return {
            '--bg':        hex(neutral, 8),
            '--surface':   hex(neutral, 12),
            '--surface-2': hex(neutral, 17),
            '--line':      hex(neutralVariant, 30),
            '--ink':       hex(neutral, 92),
            '--muted':     hex(neutralVariant, 70),
            '--accent':    accent,
            '--on-accent': hex(primary, 20),
            '--band':      hexToRgba(accent, 0.16),
        };
    }

    const accent = hex(primary, 40);
    return {
        '--bg':        hex(neutral, 94),
        '--surface':   hex(neutral, 99),
        '--surface-2': hex(neutral, 90),
        '--line':      hex(neutralVariant, 76),
        '--ink':       hex(neutral, 10),
        '--muted':     hex(neutralVariant, 38),
        '--accent':    accent,
        '--on-accent': hex(primary, 100),
        '--band':      hexToRgba(accent, 0.12),
    };
}

/**
 * Apply Material You tokens to `target` (defaults to `document.body`).
 * Returns the generated token map.
 * @param {string} seedHex
 * @param {boolean} dark
 * @param {HTMLElement | null} [target]
 * @returns {Record<string, string>}
 */
function applyMaterialTheme(seedHex, dark, target = typeof document !== 'undefined' ? document.body : null) {
    const tokens = buildMaterialTokens(seedHex, dark);
    if(target?.style) {
        for(const [k, v] of Object.entries(tokens)) {
            target.style.setProperty(k, v);
        }
    }
    return tokens;
}

/**
 * Remove inline Material You tokens from `target` (defaults to `document.body`).
 * @param {HTMLElement | null} [target]
 */
function clearMaterialTheme(target = typeof document !== 'undefined' ? document.body : null) {
    if(!target?.style) return;
    for(const k of TOKEN_KEYS) {
        target.style.removeProperty(k);
    }
}

/**
 * Extract the Material You seed hex color from an uploaded wallpaper/image File.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractSeedFromFile(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise((resolve, reject) => {
            img.onload = () => resolve(undefined);
            img.onerror = () => reject(new Error('Could not read image'));
            img.src = url;
        });
        const argb = await sourceColorFromImage(img);
        return normalizeSeed(hexFromArgb(argb));
    } finally {
        URL.revokeObjectURL(url);
    }
}

export {
    DEFAULT_MATERIAL_SEED,
    TOKEN_KEYS,
    normalizeSeed,
    buildMaterialTokens,
    applyMaterialTheme,
    clearMaterialTheme,
    extractSeedFromFile,
};
