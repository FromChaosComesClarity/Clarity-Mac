// ── Fixes for individual games ───────────────────────────────────────────────
// Most games that misbehave under Proton are fixed by something general: a shipped wrapper
// DLL that Wine was shadowing, a working directory, a missing runtime. Those belong in the
// engine, and they are there.
//
// This file is for the rest, the ones where the fix is knowledge about one specific game
// and nothing else will do. Every entry here was found the hard way, on a real machine,
// and the point of writing it down is that the next person never has to.
//
// A fix is one of three things, and an entry may carry several:
//   • env    , variables the game needs at launch. Applied every time it starts.
//   • settings, keys in the game's own configuration file. Written once, then left
//                alone: these are the user's files, and someone who changes a value back
//                meant to. Only keys we know are wrong get touched, never the whole file.
//   • wineDesktop, a Wine virtual desktop for a game that changes the display mode and
//                quits when the host cannot give it the one it asked for. Written into the
//                prefix once, per executable, and left alone afterwards for the same reason
//                the settings are.
//
// ⚠️ Nothing here fires on a guess. Each entry matches on the executable's own name, so a
// fix cannot land on a game that merely shares a folder or a title.
//
// Two things an entry may narrow itself with:
//   • exe      , one name or several. A GOG release often ships a launcher, a plain build and
//                a patched build, and which one Clarity resolves depends on what the store's
//                own metadata nominated, so an entry that knows only one of them misses.
//   • platform , when the fix is only correct on one host. A recipe found on macOS is not
//                automatically right for Linux: different translation layer, different
//                graphics stack, and a setting that rescues one can be a regression on the
//                other. An entry without this applies everywhere, as before.
'use strict';

const fs = require('fs');
const path = require('path');

const FIXES = [
    {
        id: 'arcanum',
        title: 'Arcanum: Of Steamworks and Magick Obscura',
        exe: 'arcanum.exe',
        platform: 'darwin',
        symptom: 'No window ever appears. The game exits a few seconds after Play, silently and with status 0.',
        why:
            "Arcanum is a 16-bit colour game. At startup it asks the display for 800x600 at " +
            "16bpp, and it quits rather than run without it. macOS has had no 16-bit display " +
            "modes for two decades, so Wine's Mac driver has none to offer and refuses the " +
            "switch outright: err:system:NtUserChangeDisplaySettings ... returned -2, which is " +
            "DISP_CHANGE_BADMODE. The process then unwinds and exits before anything is drawn, " +
            "which is why there is no error and nothing in the log to see. Inside a Wine " +
            "virtual desktop the mode is Wine's to emulate rather than the display's to " +
            "provide, and the game gets the surface it asked for. Measured on a real install: " +
            "without the desktop it is gone in about three seconds having presented no frames; " +
            "with it, it reaches the menu and keeps presenting 800x600 frames.",
        env: {},
        settings: [],
        // Named after the executable rather than generated, so the desktop a player finds in
        // their prefix says what put it there. 800x600 is the game's own mode: Wine resizes
        // the desktop to whatever the game asks for anyway, so this only decides the size of
        // the window before the game has spoken.
        wineDesktop: { name: 'Arcanum', size: '800x600' },
        // ⚠️ This gets the game to its menu and no further into being playable. The world
        // then draws with blue rectangles of colour noise where sprites should be, and
        // stutters badly, because Wine's DirectDraw does not honour the colour-key blits this
        // game does on 16-bit surfaces. Measured against GOG's bundled DDrawCompat as native,
        // against Wine's own builtin, and against cnc-ddraw: all three look the same, so the
        // shipped-wrapper rule is left alone. -no3d, which every Wine guide calls essential,
        // hangs the game on its loading screen here; tested four times, in both ddraw
        // configurations, and left out for that reason.
        //
        // The answer for this game on this host is the arcanum-ce recipe, which is native and
        // has none of these problems. This entry stays because it is the difference between
        // the GOG build starting and not, for anyone who wants the original.
    },
    {
        id: 'outrun2006',
        title: 'OutRun 2006: Coast 2 Coast',
        exe: 'or2006c2c.exe',
        // What the player sees when this is wrong, so a bug report can be matched to it.
        symptom: 'Starts to a white screen and appears to hang on the SEGA logo.',
        why:
            "The game's intro is a sequence of Bink logo videos, and under Proton it can sit " +
            "on the white SEGA frame for a minute or more before the menu appears, long " +
            "enough that everyone kills it first. OutRun2006Tweaks can skip the sequence " +
            "outright, which removes the wait and the thing that stalls in it. Its own " +
            "SingleCoreAffinity option is left alone: it is that mod's remedy for launch " +
            "freezes on multi-core machines and costs only load time.",
        // The mod is an ASI loader named dinput8.dll, which Wine shadows with its builtin
        // unless told otherwise. The engine's wrapper list covers this for every game; it is
        // named here too so the fix stands on its own if that list ever changes.
        env: { WINEDLLOVERRIDES: 'dinput8=n,b' },
        settings: [
            { file: 'OutRun2006Tweaks.ini', key: 'SkipIntroLogos', value: 'true', was: 'false' },
        ],
    },
    {
        id: 'biohazard2',
        title: 'Biohazard 2 / Resident Evil 2 (Classic REbirth)',
        exe: null,                       // matched by its patch DLL rather than an exe name
        requiresFile: 'ddraw.dll',
        symptom: 'Runs untranslated and stops at a Japanese error box, or crashes at once.',
        why:
            "Classic REbirth is a ddraw.dll wrapper sitting beside the game. Wine loads its " +
            "own builtin ddraw first, so the patch never runs. The override has to be n,b " +
            "rather than a bare n, the wrapper forwards what it does not implement to the " +
            "builtin, and with nothing behind it the game dies on a null pointer at 0x0.",
        // Handled generally by the engine's shipped-wrapper detection; recorded here so the
        // game appears in the list of what the suite knows how to fix.
        env: {},
        settings: [],
        handledBy: 'shipped-wrapper detection',
    },
    {
        id: 'fallout1-hires-macos',
        title: 'Fallout (High Resolution Patch)',
        platform: 'darwin',
        // A GOG install nominates the launcher, Steam's nominates the patched build, and
        // someone who has set a custom exe may point at the plain one. All three end up
        // running the same patched renderer, so all three need the fix.
        exe: ['falloutlauncher.exe', 'falloutwhr.exe', 'falloutw.exe'],
        symptom: 'A dialog reading "Error initializing video mode 1024x768", then nothing.',
        why:
            "Mash's High Resolution Patch ships set to fullscreen, which asks the host to " +
            "CHANGE DISPLAY MODE to 1024x768. Under CrossOver that request fails and the " +
            "patch stops with this error. Established on a real install by trying every " +
            "renderer it offers: DirectX 9 fullscreen and Basic mode both give this exact " +
            "message, and DirectDraw 7 is refused outright with \"The selected Display Mode " +
            "is unsupported\", so the renderer is not what is wrong, the mode change is. " +
            "Windowed needs no mode change and the game STARTS every time. " +
            "\n\n" +
            "⚠️ Starts, not plays well. This fix gets you past the error and no further: the " +
            "game is sluggish afterwards, and measurably just as sluggish with the High " +
            "Resolution Patch removed entirely and the resolution back at the original " +
            "640x480, so the cost is CrossOver's DirectDraw path and no setting in this file " +
            "reaches it. For an actually playable Fallout on this host, install Fallout " +
            "Community Edition from Custom Installers: it is native, it reads this same " +
            "install's data, and it reached the Overseer scene in the time CrossOver needed " +
            "to finish the Interplay logo.",
        // ⚠️ UAC_AWARE is not cosmetic here, it decides WHICH FILE the patch reads. Left at 1
        // it keeps its settings in the prefix, under AppData/Roaming/Fallout/<hash>/, and the
        // copy beside the exe, the only one a fix can reliably find, is then ignored. Setting
        // it to 0 moves authority back to the game folder. Verified by poisoning the AppData
        // copy with the failing value and watching the game start anyway.
        settings: [
            { file: 'f1_res.ini', key: 'UAC_AWARE', value: '0', was: '1' },
            { file: 'f1_res.ini', key: 'WINDOWED',  value: '1', was: '0' },
        ],
        env: {},
    },
    {
        id: 'fallout2-hires-macos',
        title: 'Fallout 2 (High Resolution Patch)',
        platform: 'darwin',
        exe: ['fallout2launcher.exe', 'fallout2hr.exe', 'fallout2.exe', 'falloutclient.exe'],
        symptom: 'A dialog reading "Error initializing video mode 1024x768", then nothing.',
        why:
            "The same High Resolution Patch as Fallout 1, shipping the same fullscreen " +
            "default, failing the same way for the same reason. Confirmed separately on a " +
            "real Fallout 2 install rather than assumed from its sibling. The same caveat " +
            "applies in full: this clears the error, it does not make the game run well, and " +
            "Fallout II Community Edition in Custom Installers is the native answer.",
        settings: [
            { file: 'f2_res.ini', key: 'UAC_AWARE', value: '0', was: '1' },
            { file: 'f2_res.ini', key: 'WINDOWED',  value: '1', was: '0' },
        ],
        env: {},
    },
];

// Everything the suite knows how to fix, for the Control Panel and the manual.
// ⚠️ Host-filtered on the same rule fixFor() applies. Without this the Control Panel told a
// Linux user the suite knows how to fix two games it will never offer them a fix for, which
// is worse than silence: it reads as a feature that is broken rather than absent.
function listFixes() {
    return FIXES.filter(f => !f.platform || f.platform === process.platform).map(f => ({
        id: f.id, title: f.title, symptom: f.symptom, why: f.why,
        handledBy: f.handledBy || 'per-game fix',
    }));
}

// Matched on the executable's own filename and nothing else. An entry without one, a game
// the engine already handles generally, recorded here so it shows up in the list, never
// matches, because a fix that fires on a shared filename like ddraw.dll would land on half
// the library.
function fixFor(resolvedExe) {
    if (!resolvedExe) return null;
    const exeName = path.basename(resolvedExe).toLowerCase();
    return FIXES.find(f => {
        if (f.platform && f.platform !== process.platform) return false;
        if (!f.exe) return false;
        return Array.isArray(f.exe) ? f.exe.includes(exeName) : exeName === f.exe;
    }) || null;
}

// Variables to merge into the launch environment. Empty for a game with no fix, which is
// almost all of them.
function envFor(resolvedExe, installPath) {
    const fix = fixFor(resolvedExe, installPath);
    return fix && fix.env ? { ...fix.env } : {};
}

// Write the settings a game needs, once. Returns what changed so the caller can say so.
//
// ⚠️ Only rewrites a key that still holds the exact value known to be wrong. A player who
// has set it to something else, or the mod author who changes the default, is left alone,
// and a second call after the first does nothing.
function applySettings(resolvedExe, installPath) {
    const fix = fixFor(resolvedExe, installPath);
    if (!fix || !fix.settings || !fix.settings.length) return { applied: [], fix: fix ? fix.id : null };

    const dir = (resolvedExe && path.dirname(resolvedExe)) || installPath;
    const applied = [];
    for (const s of fix.settings) {
        const file = path.join(dir, s.file);
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }

        const wrong = new RegExp(`^(\\s*${s.key}\\s*=\\s*)${s.was}\\s*$`, 'mi');
        if (!wrong.test(text)) continue;                     // already right, or deliberately different
        try {
            fs.writeFileSync(file, text.replace(wrong, `$1${s.value}`), 'utf8');
            applied.push(`${s.file}: ${s.key} = ${s.value}`);
        } catch {}
    }
    return { applied, fix: fix.id };
}

// The virtual desktop this game needs, or null. Applying it needs a Wine prefix and a
// runtime to write it with, neither of which belongs in here, so this only answers what.
// installer-engine.js's applyWineDesktop does the writing.
function desktopFor(resolvedExe) {
    const fix = fixFor(resolvedExe);
    if (!fix || !fix.wineDesktop) return null;
    const { name, size } = fix.wineDesktop;
    if (!name || !size) return null;
    return { fix: fix.id, title: fix.title, name, size };
}

module.exports = { listFixes, fixFor, envFor, applySettings, desktopFor, FIXES };
