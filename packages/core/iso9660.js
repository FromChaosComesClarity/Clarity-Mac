'use strict';
// ── ISO 9660 extraction ──────────────────────────────────────────────────────
// Copies every file off a CD image into a folder. Written for Road Rash, whose disc image
// macOS cannot open by any route it ships:
//
//   • bsdtar (libarchive 3.7.4) lists it as EMPTY and exits 0. Nothing is extracted and
//     nothing says so, which is the worst way to fail: the installer took the exit code at
//     its word, deleted the image as unpacked, and then found no game.
//   • hdiutil refuses it outright: "attach failed - image not recognized".
//
// The disc is not damaged. It is a CD-Bridge disc (system id "CD-RTOS CD-BRIDGE", the
// CD-ROM XA family), its primary volume descriptor is well formed, and its directory tree
// reads cleanly with 2048-byte sectors. The image file is also 156 bytes longer than a whole
// number of sectors, which is the likely reason hdiutil will not touch it. Neither of those
// is a reason a plain reading of ECMA-119 cannot cope with, so this does exactly that.
//
// Scope, deliberately small: the primary volume descriptor, or the Joliet supplementary one
// when present (better names); directories; plain and multi-extent files. Mode 2 Form 2
// sectors cannot appear in a 2048-byte-sector image, so they are not a case here.

const fs = require('fs');
const path = require('path');

const SECTOR = 2048;

function readAt(fd, pos, len) {
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
        const n = fs.readSync(fd, buf, got, len - got, pos + got);
        if (n <= 0) break;
        got += n;
    }
    return got === len ? buf : buf.subarray(0, got);
}

// Returns { pvdBlock, joliet } for the best volume descriptor, or throws.
function findVolume(fd) {
    let primary = null, joliet = null;
    for (let i = 16; i < 64; i++) {
        const d = readAt(fd, i * SECTOR, SECTOR);
        if (d.length < SECTOR || d.toString('latin1', 1, 6) !== 'CD001') break;
        const type = d[0];
        if (type === 255) break;
        if (type === 1 && !primary) primary = d;
        // Joliet is a supplementary descriptor whose escape sequence names UCS-2 level 1-3.
        if (type === 2 && d[88] === 0x25 && d[89] === 0x2F && [0x40, 0x43, 0x45].includes(d[90])) joliet = d;
    }
    if (!primary && !joliet) throw new Error('This is not an ISO 9660 image.');
    return { desc: joliet || primary, joliet: !!joliet };
}

function decodeName(raw, joliet) {
    let name = joliet ? raw.swap16().toString('utf16le') : raw.toString('latin1');
    name = name.replace(/;\d+$/, '');          // the version suffix, ";1"
    name = name.replace(/\.$/, '');            // a name with no extension keeps its dot on disc
    return name;
}

// Every record in one directory, walked sector by sector: a record never crosses a sector
// boundary, and a zero length byte means "the rest of this sector is padding".
function readDir(fd, extent, size, joliet) {
    const data = readAt(fd, extent * SECTOR, size);
    const out = [];
    let i = 0;
    while (i < data.length) {
        const len = data[i];
        if (len === 0) { i = (Math.floor(i / SECTOR) + 1) * SECTOR; continue; }
        if (i + len > data.length) break;
        const rec = data.subarray(i, i + len);
        const nameLen = rec[32];
        const raw = Buffer.from(rec.subarray(33, 33 + nameLen));
        i += len;
        if (nameLen === 1 && (raw[0] === 0 || raw[0] === 1)) continue;   // "." and ".."
        out.push({
            name: decodeName(raw, joliet),
            extent: rec.readUInt32LE(2),
            size: rec.readUInt32LE(10),
            dir: !!(rec[25] & 2),
            more: !!(rec[25] & 0x80),            // multi-extent: the next record continues it
        });
    }
    return out;
}

function copyExtent(fd, out, extent, size) {
    const CHUNK = 8 * 1024 * 1024;
    let pos = extent * SECTOR, left = size;
    while (left > 0) {
        const n = Math.min(CHUNK, left);
        const buf = readAt(fd, pos, n);
        if (buf.length < n) throw new Error('The image ends before a file on it does; the download may be incomplete.');
        fs.writeSync(out, buf);
        pos += n; left -= n;
    }
}

// Extracts the whole image into `target`. Returns the relative paths of the files written.
// Throws when nothing could be read, so a caller can never mistake an empty result for a
// disc that happened to be empty.
function extractIso(isoPath, target) {
    const fd = fs.openSync(isoPath, 'r');
    const written = [];
    try {
        const { desc, joliet } = findVolume(fd);
        const root = desc.subarray(156, 190);
        const walk = (extent, size, rel, depth) => {
            if (depth > 32) return;                // a loop in a corrupt tree, not a real disc
            const entries = readDir(fd, extent, size, joliet);
            for (let k = 0; k < entries.length; k++) {
                const e = entries[k];
                const relPath = path.join(rel, e.name);
                // Both sides resolved: comparing a relative path against an absolute one skips
                // everything, which is exactly what the first version of this did.
                const abs = path.resolve(target, relPath);
                if (!abs.startsWith(path.resolve(target) + path.sep)) continue;   // never outside target
                if (e.dir) {
                    fs.mkdirSync(abs, { recursive: true });
                    walk(e.extent, e.size, relPath, depth + 1);
                    continue;
                }
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                const out = fs.openSync(abs, 'w');
                try {
                    copyExtent(fd, out, e.extent, e.size);
                    // Multi-extent: following records with the same name carry the rest.
                    let cur = e;
                    while (cur.more && entries[k + 1] && entries[k + 1].name === e.name) {
                        cur = entries[++k];
                        copyExtent(fd, out, cur.extent, cur.size);
                    }
                } finally { fs.closeSync(out); }
                written.push(relPath);
            }
        };
        fs.mkdirSync(target, { recursive: true });
        walk(root.readUInt32LE(2), root.readUInt32LE(10), '', 0);
    } finally { fs.closeSync(fd); }
    if (!written.length) throw new Error('The disc image was read, but no files were found on it.');
    return written;
}

module.exports = { extractIso };
