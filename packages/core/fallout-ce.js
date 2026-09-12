// ── Fallout / Fallout 2 Community Edition settings ───────────────────────────
// The native ports keep their settings in the same plain text files the 1997 originals did,
// and their own README is blunt about it: "In time this stuff will receive in-game interface,
// right now you have to do it manually." This module is that interface.
//
// Two files per game, and they are not interchangeable:
//   • f1_res.ini / f2_res.ini   window size and fullscreen. The hi-res patch's format, which
//                               the ports absorbed.
//   • fallout.cfg / fallout2.cfg   everything else: sound, preferences, caches. The original
//                               engine's own config, unchanged since 1997.
//
// ⚠️ Both usually arrive as SYMLINKS. The installer mirrors the Windows game folder rather
// than copying it, so a fresh CE install's fallout2.cfg points straight into the GOG or Steam
// copy it borrowed its data from. Writing through one would silently reconfigure the Windows
// game too, and the two want different values: the port wants its own window size and reads
// lowercase data names. So the first write breaks the link (see materialise), leaving the
// original untouched.
'use strict';

const fs = require('fs');
const path = require('path');

// What a CE install looks like, keyed by the id the custom installer registers it under.
const VARIANTS = {
    'cn_fallout1-ce': { id: 'fallout1-ce', title: 'Fallout Community Edition',    res: 'f1_res.ini', cfg: 'fallout.cfg'  },
    'cn_fallout2-ce': { id: 'fallout2-ce', title: 'Fallout II Community Edition', res: 'f2_res.ini', cfg: 'fallout2.cfg' },
};

function variantFor(installerGameId) {
    return VARIANTS[String(installerGameId || '')] || null;
}

// ── The options, and how each maps onto a file ───────────────────────────────
// `scale` turns the engine's own units into something a person can read: volumes are 0..32767
// in the file and 0..100 in the dialog. `kind` drives the control the renderer draws.
const VOLUME_MAX = 32767;

const SCHEMA = [
    { group: 'Display', file: 'res', section: 'MAIN', options: [
        { key: 'SCR_WIDTH',  label: 'Width',       kind: 'number', min: 640,  max: 7680, hint: 'Pixels. The port renders more of the world at higher values rather than scaling up.' },
        { key: 'SCR_HEIGHT', label: 'Height',      kind: 'number', min: 480,  max: 4320 },
        { key: 'WINDOWED',   label: 'Windowed',    kind: 'bool',   hint: 'Off is fullscreen. Unlike under CrossOver, fullscreen works here.' },
        { key: 'SCALE_2X',   label: 'Scale 2×',    kind: 'bool',   hint: 'Doubles every pixel. Raises the minimum resolution to 1280×960.' },
    ]},
    { group: 'Audio', file: 'cfg', section: 'sound', options: [
        { key: 'sounds',        label: 'Sound effects', kind: 'bool' },
        { key: 'music',         label: 'Music',         kind: 'bool' },
        { key: 'speech',        label: 'Speech',        kind: 'bool' },
        { key: 'master_volume', label: 'Master volume', kind: 'percent', max: VOLUME_MAX },
        { key: 'sndfx_volume',  label: 'Effects volume',kind: 'percent', max: VOLUME_MAX },
        { key: 'music_volume',  label: 'Music volume',  kind: 'percent', max: VOLUME_MAX },
        { key: 'speech_volume', label: 'Speech volume', kind: 'percent', max: VOLUME_MAX },
    ]},
    { group: 'Gameplay', file: 'cfg', section: 'preferences', options: [
        { key: 'running',          label: 'Always run',        kind: 'bool' },
        { key: 'player_speedup',   label: 'Faster movement',   kind: 'bool' },
        { key: 'combat_messages',  label: 'Combat messages',   kind: 'bool' },
        { key: 'combat_taunts',    label: 'Combat taunts',     kind: 'bool' },
        { key: 'subtitles',        label: 'Subtitles',         kind: 'bool' },
        { key: 'item_highlight',   label: 'Highlight items',   kind: 'bool' },
        { key: 'language_filter',  label: 'Language filter',   kind: 'bool' },
        { key: 'target_highlight', label: 'Target highlight',  kind: 'choice', choices: [[0,'Off'],[1,'On'],[2,'Targeting only']] },
        { key: 'violence_level',   label: 'Violence',          kind: 'choice', choices: [[0,'None'],[1,'Minimal'],[2,'Normal'],[3,'Maximum']] },
        { key: 'game_difficulty',  label: 'Difficulty',        kind: 'choice', choices: [[0,'Easy'],[1,'Normal'],[2,'Hard']] },
        { key: 'combat_difficulty',label: 'Combat difficulty', kind: 'choice', choices: [[0,'Easy'],[1,'Normal'],[2,'Hard']] },
        { key: 'brightness',       label: 'Brightness',        kind: 'float', min: 1, max: 1.5, step: 0.01 },
        { key: 'mouse_sensitivity',label: 'Mouse sensitivity', kind: 'float', min: 0.5, max: 2, step: 0.05 },
    ]},
    { group: 'Performance', file: 'cfg', section: 'system', options: [
        // GOG and Steam both ship 8, which is the 1997 default and very small now. Raising it
        // is the one long-standing Fallout tweak that is purely a win on modern hardware.
        { key: 'art_cache_size', label: 'Art cache (MB)', kind: 'number', min: 8, max: 512,
          hint: 'Ships at 8, the 1997 default. Higher means less re-reading art from disk.' },
        { key: 'color_cycling',  label: 'Colour cycling', kind: 'bool', hint: 'Animated palette effects: water, neon, computer screens.' },
        { key: 'scroll_lock',    label: 'Lock edge scrolling', kind: 'bool' },
    ]},
];

// ── INI reading and writing ──────────────────────────────────────────────────
// Both file types are the same shape: [section] headers and key=value lines. Parsed loosely
// and rewritten surgically, because these files carry the ports' own comments and a
// wholesale rewrite would throw them away.

function readIni(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const out = {};
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const head = /^\[(.+?)\]$/.exec(line);
        if (head) { section = head[1].trim(); out[section] = out[section] || {}; continue; }
        const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
        if (!kv || !section) continue;
        out[section][kv[1].trim()] = kv[2].trim();
    }
    return out;
}

// ⚠️ The whole reason this function exists. A CE install's config files are symlinks into the
// Windows game folder the installer borrowed data from, so an ordinary write would edit the
// GOG or Steam copy's settings instead of the port's. Replace the link with a real file
// holding the same contents, once, on first write.
function materialise(file) {
    let st;
    try { st = fs.lstatSync(file); } catch { return false; }
    if (!st.isSymbolicLink()) return false;
    const content = fs.readFileSync(file);          // reads through the link
    fs.unlinkSync(file);
    fs.writeFileSync(file, content);
    return true;
}

// Rewrite only the keys given, only inside the right section, leaving every comment, blank
// line and unknown key exactly where it was. A key that is absent is appended to its section
// rather than dropped, which is what lets a setting the shipped file never mentioned be set.
function patchIni(file, section, values) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, error: `${path.basename(file)} could not be read.` }; }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const want = new Map(Object.entries(values));
    let inSection = false, lastIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const head = /^\s*\[(.+?)\]\s*$/.exec(lines[i]);
        if (head) { inSection = head[1].trim().toLowerCase() === section.toLowerCase(); continue; }
        if (!inSection) continue;
        if (lines[i].trim()) lastIndex = i;
        const kv = /^(\s*)([^=;#]+?)(\s*=\s*)(.*)$/.exec(lines[i]);
        if (!kv) continue;
        const key = kv[2].trim();
        for (const [k, v] of want) {
            if (k.toLowerCase() !== key.toLowerCase()) continue;
            // Trailing whitespace after a value is preserved in these files (COLOUR_BITS ships
            // with tabs after it); rebuilt from the captured prefix so nothing else shifts.
            lines[i] = `${kv[1]}${kv[2]}${kv[3]}${v}`;
            want.delete(k);
            break;
        }
    }
    // Anything the file never had: append inside the section if it exists, else create it.
    if (want.size) {
        const additions = [...want].map(([k, v]) => `${k}=${v}`);
        if (lastIndex >= 0) lines.splice(lastIndex + 1, 0, ...additions);
        else lines.push(`[${section}]`, ...additions);
    }
    try { fs.writeFileSync(file, lines.join(eol), 'utf8'); }
    catch (e) { return { ok: false, error: `${path.basename(file)} could not be written: ${e.message}` }; }
    return { ok: true };
}

// ── Public API ───────────────────────────────────────────────────────────────

function filesFor(installerGameId, installPath) {
    const v = variantFor(installerGameId);
    if (!v || !installPath) return null;
    return { variant: v, res: path.join(installPath, v.res), cfg: path.join(installPath, v.cfg) };
}

// Everything the dialog needs: the schema, the current values, and whether each file is still
// a borrowed symlink, which the dialog says out loud rather than silently breaking.
function readSettings(installerGameId, installPath) {
    const f = filesFor(installerGameId, installPath);
    if (!f) return { ok: false, error: 'Not a Fallout Community Edition install.' };

    const parsed = { res: readIni(f.res), cfg: readIni(f.cfg) };
    const missing = ['res', 'cfg'].filter(k => !parsed[k]).map(k => path.basename(f[k]));
    if (missing.length) return { ok: false, error: `Missing config: ${missing.join(', ')}. Launch the game once, or reinstall it.` };

    const linked = ['res', 'cfg'].filter(k => { try { return fs.lstatSync(f[k]).isSymbolicLink(); } catch { return false; } })
                                 .map(k => path.basename(f[k]));

    const groups = SCHEMA.map(g => ({
        group: g.group,
        options: g.options.map(o => {
            const raw = (parsed[g.file][g.section] || {})[o.key];
            const found = raw !== undefined;
            let value = raw;
            if (found) {
                if (o.kind === 'bool')       value = String(raw).trim() === '1';
                else if (o.kind === 'percent') value = Math.round((parseFloat(raw) || 0) / o.max * 100);
                else if (o.kind === 'float')   value = parseFloat(raw);
                else if (o.kind === 'number' || o.kind === 'choice') value = parseInt(raw, 10);
            }
            return { ...o, value, found };
        }).filter(o => o.found),      // never offer a control for a key this release does not have
    })).filter(g => g.options.length);

    return { ok: true, title: f.variant.title, id: f.variant.id, groups,
             files: { res: path.basename(f.res), cfg: path.basename(f.cfg) }, linked };
}

// `patch` is a flat { key: value } in the dialog's own units; converted back here so the
// renderer never has to know that a volume is really 0..32767.
function writeSettings(installerGameId, installPath, patch) {
    const f = filesFor(installerGameId, installPath);
    if (!f) return { ok: false, error: 'Not a Fallout Community Edition install.' };

    const byFile = { res: {}, cfg: {} };
    const bySection = {};
    let n = 0;
    for (const g of SCHEMA) {
        for (const o of g.options) {
            if (!(o.key in (patch || {}))) continue;
            let v = patch[o.key];
            if (o.kind === 'bool')         v = v ? '1' : '0';
            else if (o.kind === 'percent') v = String(Math.round(Math.max(0, Math.min(100, Number(v))) / 100 * o.max));
            else if (o.kind === 'float')   v = Number(v).toFixed(6);
            else                           v = String(parseInt(v, 10));
            const slot = `${g.file}|${g.section}`;
            (bySection[slot] = bySection[slot] || {})[o.key] = v;
            n++;
        }
    }
    if (!n) return { ok: true, written: 0, unlinked: [] };

    // Break the symlinks BEFORE writing anything, so a failure halfway cannot leave one file
    // edited through to the Windows install and another not.
    const unlinked = [];
    for (const slot of Object.keys(bySection)) {
        const which = slot.split('|')[0];
        if (materialise(f[which])) unlinked.push(path.basename(f[which]));
    }

    for (const [slot, values] of Object.entries(bySection)) {
        const [which, section] = slot.split('|');
        const r = patchIni(f[which], section, values);
        if (!r.ok) return r;
    }
    return { ok: true, written: n, unlinked: [...new Set(unlinked)] };
}

module.exports = { VARIANTS, SCHEMA, variantFor, filesFor, readSettings, writeSettings, readIni, patchIni };
