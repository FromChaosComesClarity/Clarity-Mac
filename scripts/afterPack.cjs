// electron-builder hook. Runs after the .app is assembled and before it is packaged into the
// dmg/zip, which is the only moment an ad-hoc signature can end up INSIDE the artifact rather
// than having to be applied by hand after every download.
//
// electron-builder has no ad-hoc signing of its own: without a real Apple identity it logs
// "skipped macOS code signing" and leaves the bundle carrying nothing but the linker-signed
// stub Electron's own binary ships with. That stub is enough to launch, but it is not a
// signature over the bundle, so `codesign --verify --deep --strict` fails with
//
//     code has no resources but signature indicates they must be present
//
// and any change to Resources, which for this app means every helper binary and the whole
// asar, is unsealed. Signing here fixes that.
//
// ⚠️ This does NOT get past Gatekeeper on a downloaded copy, and it is worth being precise
// about why, because it is tempting to assume it does. An ad-hoc signature carries no
// Developer ID and no notarisation ticket, so Gatekeeper still refuses, and it offers no
// "Open Anyway" button either, having no identity to make an exception against. Verified
// against PICO-8, which is itself ad-hoc signed and behaves exactly this way on this host.
// docs/gatekeeper-note.md stays necessary, and ships with every release.
//
// --deep because the bundle nests code that must be signed too: Electron's own frameworks and
// helper apps, and this app's extraResources, gogdl, legendary, comet, ffmpeg, ffprobe and
// yt-dlp, all of which are real Mach-O executables. Apple discourages --deep for Developer ID
// signing in favour of signing inside-out, which is the right advice for a shipping identity
// and irrelevant to an ad-hoc pass whose only job is to seal what is there.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;

    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

    // codesign exists only on macOS. A cross-build should say so rather than fail the build,
    // and rather than silently produce an unsigned artifact nobody notices until it will not
    // launch on an Apple Silicon machine.
    if (process.platform !== 'darwin') {
        console.log('  • ad-hoc signing skipped, codesign exists only on macOS.');
        console.log('    The resulting .app will not be sealed; sign it on a Mac before shipping.');
        return;
    }

    console.log(`  • ad-hoc signing  ${path.basename(app)}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });

    // Positive evidence, not the absence of an error: codesign can exit 0 having signed
    // something other than what was meant, and the failure mode this hook exists to prevent
    // is precisely a build that looks signed and is not.
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    console.log('  • signature verified');
};
