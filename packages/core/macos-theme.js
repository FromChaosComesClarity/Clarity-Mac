// ── macOS appearance bridge ──────────────────────────────────────────────────
// The macOS counterpart to omarchy-theme.js, and deliberately the same shape: one module in
// core, one IPC channel, one generated theme registered alongside the shipped ones. Nothing
// about the existing themes changes; this adds a single entry that is not a palette someone
// designed but the palette *this Mac is currently wearing*.
//
// Two things make up "the Mac colour scheme", and both are user settings that can change
// while the app is open:
//
//   System Settings ▸ Appearance ▸ Light / Dark / Auto   → nativeTheme.shouldUseDarkColors
//   System Settings ▸ Appearance ▸ Accent colour         → systemPreferences.getAccentColor()
//
// Auto is why this cannot be resolved once at startup: a Mac on Auto flips at sunset with the
// app running. watch() below follows both.
//
// ⚠️ Why the palette is not simply read from systemPreferences.getColor() and trusted.
// Measured on Electron 41 / macOS 26 (Darwin 25.6) before this file was written:
// getColor() ignores nativeTheme.themeSource entirely. Forcing themeSource to 'light' and
// reading 'window-background' still returned #1E1E1E, the dark value, because the machine
// itself was dark. So getColor() reports the *system* appearance, which is exactly what we
// want while following the system, but it is not steerable and its liveness across an
// appearance switch could not be proven from a single run.
//
// Hence readSystemColors() is used but never trusted blindly: every read is checked against
// nativeTheme.shouldUseDarkColors, and a palette whose window background sits on the wrong
// side of mid-grey for the mode we are in is treated as stale and discarded in favour of
// APPLE, below. That way the app gets per-OS-version fidelity when the API behaves, and
// stays correct when it does not.
//
// Electron main-process module (nativeTheme/systemPreferences). Like omarchy-theme.js it is
// meant to be copied into EmuLatte unchanged.
'use strict';

let electron = null;
try { electron = require('electron'); } catch {}

const IS_MAC = process.platform === 'darwin';

// ── Apple's own values, measured ─────────────────────────────────────────────
// Not guessed and not copied from a blog post: read out of AppKit itself with
// NSAppearance.performAsCurrentDrawingAppearance for both NSAppearanceNameAqua and
// NSAppearanceNameDarkAqua, so each number below is what NSColor resolves to. Alpha is kept
// where AppKit declares it, because these are dynamic colours meant to be composited over
// the window background rather than drawn flat.
//
// ⚠️ windowBackground is #FFFFFF on Aqua here, not the #ECECEC that older macOS used. That is
// the OS the measurement was taken on (macOS 26); it is also why the live read is preferred
// when it is trustworthy, so a different macOS version themes itself rather than this one.
const APPLE = {
    light: {
        window:    '#ffffff',
        chrome:    '#ececec',                       // menus and bars: derived, see bgMenu()
        label:     { hex: '#000000', a: 0.847 },
        secondary: { hex: '#000000', a: 0.498 },
        tertiary:  { hex: '#000000', a: 0.259 },
        separator: { hex: '#000000', a: 0.098 },
        divider:   '#dcdcdc',                       // unemphasizedSelectedContentBackground
    },
    dark: {
        window:    '#1e1e1e',
        chrome:    '#282828',                       // underPageBackgroundColor
        label:     { hex: '#ffffff', a: 0.847 },
        secondary: { hex: '#ffffff', a: 0.549 },
        tertiary:  { hex: '#ffffff', a: 0.247 },
        separator: { hex: '#ffffff', a: 0.098 },
        divider:   '#464646',
    },
};

// The eight accents System Settings offers. Used only to put a word next to the swatch in the
// settings card ("Dark · Blue"), never to decide a colour: the accent that gets applied is
// always the one the OS reports, including a Multicolour or third-party value that matches
// nothing here.
const ACCENT_NAMES = [
    ['Blue',     '#007aff'], ['Purple', '#a550a7'], ['Pink',   '#f74f9e'],
    ['Red',      '#ff5257'], ['Orange', '#f7821b'], ['Yellow', '#ffc600'],
    ['Green',    '#62ba46'], ['Graphite', '#8c8c8c'],
];

// ── Colour helpers ───────────────────────────────────────────────────────────
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Returns { hex, a }. An 8-digit value keeps its alpha instead of dropping it: macOS hands
// back #FFFFFFD8 for labelColor and that 0.847 is the difference between Apple's text grey
// and pure white.
function parseColor(v) {
    if (typeof v !== 'string') return null;
    const m = v.trim().match(HEX);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    let a = 1;
    if (h.length === 8) { a = parseInt(h.slice(6, 8), 16) / 255; h = h.slice(0, 6); }
    return { hex: '#' + h.toLowerCase(), a };
}

function normHex(v) { const c = parseColor(v); return c ? c.hex : ''; }

function rgb(hex) {
    const h = normHex(hex);
    if (!h) return null;
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

function toHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgba(hex, alpha) {
    const c = rgb(hex);
    if (!c) return '';
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(alpha * 1000) / 1000})`;
}

// Flatten a translucent AppKit colour onto the window background. The app's theme tokens are
// opaque hex (they get drawn over cover art, not over the window), so Apple's alpha has to be
// resolved here rather than passed through.
function composite(fg, bg) {
    const f = rgb(fg && fg.hex !== undefined ? fg.hex : fg);
    const b = rgb(bg);
    if (!f) return normHex(bg);
    if (!b) return toHex(f);
    const a = fg && typeof fg.a === 'number' ? fg.a : 1;
    return toHex({ r: b.r + (f.r - b.r) * a, g: b.g + (f.g - b.g) * a, b: b.b + (f.b - b.b) * a });
}

function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    if (!x || !y) return normHex(a) || normHex(b) || '';
    return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

// WCAG relative luminance, and the contrast ratio built from it. Used for one decision only,
// see legibleAccent().
function luminance(hex) {
    const c = rgb(hex);
    if (!c) return 0;
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ── The accent, made readable ────────────────────────────────────────────────
// The app draws the accent as text and hairlines, not only as a control fill, so it has to
// stay legible against the page. Most of Apple's accents already are: Blue #007AFF clears 3:1
// on both the white and the #1E1E1E page. Yellow does not — #FFC600 on white is about 1.5:1,
// which is a heading nobody can read.
//
// macOS has the same problem and solves it the same way, which is why this is a match rather
// than an invention: linkColor is #0068DA on Aqua and #419CFF on DarkAqua, the identical blue
// pushed away from whichever background it sits on. So the accent is walked toward black on a
// light page and toward white on a dark one until it clears the large-text threshold, and an
// accent that already clears it is returned untouched. Every step is 4% so an accent that
// needs adjusting keeps its hue and only gives up as much saturation as it must.
const ACCENT_MIN_CONTRAST = 3.0;   // WCAG AA for large / bold text, which is how it is used

function legibleAccent(accent, bg) {
    const start = normHex(accent);
    if (!start) return '';
    const target = luminance(bg) > 0.18 ? '#000000' : '#ffffff';
    let out = start;
    for (let i = 0; i < 25 && contrast(out, bg) < ACCENT_MIN_CONTRAST; i++) out = mix(start, target, (i + 1) * 0.04);
    return out;
}

function accentName(hex) {
    const c = rgb(hex);
    if (!c) return '';
    let best = '', bestD = Infinity;
    for (const [name, ref] of ACCENT_NAMES) {
        const r = rgb(ref);
        const d = (c.r - r.r) ** 2 + (c.g - r.g) ** 2 + (c.b - r.b) ** 2;
        if (d < bestD) { bestD = d; best = name; }
    }
    // ~28 per channel. Past that it is a colour System Settings does not offer (a Multicolour
    // variant, or an accent set by a third-party tool), and naming it would be a guess.
    return bestD <= 28 * 28 * 3 ? best : '';
}

// ── Reading the system ───────────────────────────────────────────────────────
function isDark() {
    try { return !!electron.nativeTheme.shouldUseDarkColors; } catch { return false; }
}

function systemAccent() {
    try {
        const a = normHex(electron.systemPreferences.getAccentColor());
        if (a) return a;
    } catch {}
    return '#007aff';                              // Apple's default, and the Multicolour value
}

function getColor(name) {
    try { return electron.systemPreferences.getColor(name); } catch { return ''; }
}

// The live palette, or null when it cannot be trusted. See the header: getColor() is not
// steerable, so the only defence against a stale read is to check that what came back agrees
// with the appearance nativeTheme reports.
function readSystemColors(dark) {
    const window = normHex(getColor('window-background'));
    if (!window) return null;
    const light = luminance(window) > 0.18;
    if (light === dark) return null;               // stale or lying: fall back to APPLE

    const take = (name, fallback) => parseColor(getColor(name)) || fallback;
    const ref = dark ? APPLE.dark : APPLE.light;
    return {
        window,
        chrome:    normHex(getColor('under-page-background')) || ref.chrome,
        label:     take('label',           ref.label),
        secondary: take('secondary-label', ref.secondary),
        tertiary:  take('tertiary-label',  ref.tertiary),
        separator: take('separator',       ref.separator),
        divider:   normHex(getColor('unemphasized-selected-content-background')) || ref.divider,
    };
}

// Menus and bars sit a step off the page. On dark that step is toward white and AppKit's
// underPageBackgroundColor (#282828 over a #1E1E1E page) is exactly it, so the declared role
// is used. On light the same role is a mid-grey — #969696 at 90% over white flattens to about
// #A7A7A7 — which is a shadow, not a chrome tone, so a declared value that dark is rejected
// and the classic macOS chrome grey is derived from the page instead.
function bgMenu(src, dark) {
    const page = src.window;
    const declared = normHex(src.chrome);
    if (dark) {
        if (declared && declared !== page && luminance(declared) > luminance(page)) return declared;
        return mix(page, '#ffffff', 0.06);
    }
    if (declared && declared !== page && contrast(declared, page) < 1.35 && luminance(declared) < luminance(page)) return declared;
    return mix(page, '#000000', 0.075);
}

// ── The mapping ──────────────────────────────────────────────────────────────
//   bg           ← windowBackgroundColor                the page
//   bg_menu      ← underPageBackgroundColor / derived   menus and bars, see bgMenu()
//   bg_panel     ← bg_menu at material alpha            panels floating over cover art
//   accent       ← the accent colour, made legible      see legibleAccent()
//   text_main    ← labelColor          over bg
//   text_sec     ← secondaryLabelColor over bg
//   text_dim     ← tertiaryLabelColor  over bg
//   border       ← separatorColor, kept translucent     hairlines
//   border_solid ← unemphasizedSelectedContentBackground opaque dividers
//
// Nothing here is accent-tinted beyond `accent` itself, and that is on purpose: macOS keeps
// its chrome and its separators neutral and lets the accent do the colouring. A theme that
// washed the whole window in the user's accent would look like our idea of a Mac rather than
// like their Mac.
function toCafeTheme({ dark = isDark(), accent = systemAccent() } = {}) {
    const src = readSystemColors(dark) || (() => {
        const ref = dark ? APPLE.dark : APPLE.light;
        return { window: ref.window, chrome: ref.chrome, label: ref.label, secondary: ref.secondary,
                 tertiary: ref.tertiary, separator: ref.separator, divider: ref.divider };
    })();

    const bg   = src.window;
    const menu = bgMenu(src, dark);
    const acc  = legibleAccent(accent, bg) || accent;

    return {
        bg,
        bg_panel: rgba(menu, dark ? 0.62 : 0.70),
        bg_menu: menu,
        accent: acc,
        accent_menu: acc,
        text_main: composite(src.label, bg),
        text_sec: composite(src.secondary, bg),
        text_dim: composite(src.tertiary, bg),
        border: rgba(normHex(src.separator.hex || src.separator), src.separator.a != null ? src.separator.a : 0.098),
        border_solid: composite(src.divider, bg),
    };
}

// What the picker and the settings card show. `name` is what the theme is CALLED, and it
// changes with the appearance because that is the honest label: on a Mac that flipped to dark
// at sunset, an entry still reading "macOS Light" would be wrong.
function describe() {
    if (!isSupported()) return { available: false, name: '', theme: null, mode: '', accent: '', accentName: '' };
    const dark = isDark();
    const accent = systemAccent();
    return {
        available: true,
        name: dark ? 'macOS Dark' : 'macOS Light',
        mode: dark ? 'dark' : 'light',
        accent,
        accentName: accentName(accent),
        theme: toCafeTheme({ dark, accent }),
    };
}

function isSupported() { return IS_MAC && !!(electron && electron.nativeTheme && electron.systemPreferences); }

// ── Following the system ─────────────────────────────────────────────────────
// Two sources, because the two halves of "the Mac colour scheme" change independently:
//
//   nativeTheme 'updated'                        Light ⇄ Dark, including the Auto flip
//   AppleColorPreferencesChangedNotification     the accent colour, which nativeTheme ignores
//
// ⚠️ The distributed notification is macOS-only and is not guaranteed to exist on every
// Electron build, so it is subscribed defensively and its absence costs only the live accent
// follow, not the light/dark one.
//
// ⚠️ Both can fire more than once for a single user action (nativeTheme fires on its own
// state changes as well as the system's), so the same debounce-and-compare shape as
// omarchy-theme.js applies: re-read everything on each fire, and drop a change that produced
// an identical palette.
function watch(onChange, { debounceMs = 120 } = {}) {
    if (typeof onChange !== 'function' || !isSupported()) return () => {};
    let timer = null;
    let last = '';
    let subId = null;

    const sig = d => (d.available ? d.name + '|' + JSON.stringify(d.theme) : 'unavailable');

    const fire = () => {
        timer = null;
        const d = describe();
        const s = sig(d);
        if (s === last) return;
        last = s;
        try { onChange(d); } catch {}
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(fire, debounceMs); };

    try { electron.nativeTheme.on('updated', schedule); } catch { return () => {}; }
    try {
        subId = electron.systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', schedule);
    } catch { subId = null; }

    last = sig(describe());
    return () => {
        if (timer) clearTimeout(timer);
        try { electron.nativeTheme.removeListener('updated', schedule); } catch {}
        try { if (subId != null) electron.systemPreferences.unsubscribeNotification(subId); } catch {}
    };
}

module.exports = {
    APPLE,
    isSupported, isDark, systemAccent, describe, watch,
    toCafeTheme, readSystemColors, legibleAccent, accentName,
    parseColor, normHex, rgba, composite, mix, luminance, contrast,
};
