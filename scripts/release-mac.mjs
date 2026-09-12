#!/usr/bin/env node
// Cut a macOS release, with the Gatekeeper instructions always attached.
//
// ⚠️ The footer is appended here rather than written into each release's notes by hand,
// because these builds are unsigned and a reader who does not get that command has an app
// that simply will not open, with no visible way to fix it: macOS shows them no "Open
// Anyway" button, there being no Developer ID to except. Forgetting it once ships a release
// that looks broken. A script cannot forget.
//
//   node scripts/release-mac.mjs <notes-file> [--draft]
//
// Reads the version from package.json, expects `npm run dist:mac` to have been run already,
// and uploads the artifacts the updater needs (latest-mac.yml and the blockmaps) alongside
// the dmg and zip.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;
const notesArg = process.argv[2];
const draft = process.argv.includes('--draft');

if (!notesArg || !existsSync(notesArg)) {
    console.error(`usage: node scripts/release-mac.mjs <notes-file> [--draft]`);
    process.exit(1);
}

const footer = readFileSync(join(root, 'docs', 'gatekeeper-note.md'), 'utf8').trim();
const body = `${readFileSync(notesArg, 'utf8').trim()}\n\n---\n\n${footer}\n`;
const notesPath = join(root, 'dist', `release-notes-${tag}.md`);
writeFileSync(notesPath, body);

const assets = [
    'dist/Clarity.dmg',
    'dist/Clarity-arm64.zip',
    'dist/latest-mac.yml',              // the auto-updater reads this; a release without it updates nobody
    'dist/Clarity.dmg.blockmap',
    'dist/Clarity-arm64.zip.blockmap',
].filter(p => existsSync(join(root, p)));

const missing = ['dist/Clarity.dmg', 'dist/latest-mac.yml'].filter(p => !existsSync(join(root, p)));
if (missing.length) {
    console.error(`Run \`npm run dist:mac\` first, these are absent: ${missing.join(', ')}`);
    process.exit(1);
}

const args = ['release', 'create', tag, '--title', `Clarity for macOS ${pkg.version}`,
              '--notes-file', notesPath, ...(draft ? ['--draft'] : []), ...assets];
console.log(`gh ${args.join(' ')}`);
const r = spawnSync('gh', args, { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
