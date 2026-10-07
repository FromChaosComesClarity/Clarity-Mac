'use strict';
// ── BPS patching ─────────────────────────────────────────────────────────────
// Applies a BPS patch (byuu's format, the one Flips writes) to a source file and returns the
// result. Written for DOOM 64 CE, whose IWAD has to be built out of Nightdive's DOOM64.WAD:
// the mod ships the patch plus Flips for Windows and Linux, and nothing that runs on macOS.
//
// Why not run the Windows Flips through CrossOver, the way the game itself runs? Because this
// happens at INSTALL time, before the game has a bottle, and the format does not need it. BPS
// is small and fully specified, and it carries three CRC32s, of the source, the target and the
// patch itself. Checking all three gives the same guarantee Flips gives: a modified or
// re-released WAD is refused with a reason, rather than producing a file that fails at the
// title screen.
//
// Format (all integers little-endian, variable-length numbers as below):
//   "BPS1"  sourceSize  targetSize  metadataSize  metadata[metadataSize]
//   actions…, each one number: low 2 bits = command, (rest >> 2) + 1 = length
//     0 SourceRead   copy `length` bytes from the source at the current output offset
//     1 TargetRead   copy `length` bytes straight out of the patch
//     2 SourceCopy   move a source cursor by a signed delta, then copy from it
//     3 TargetCopy   move a target cursor by a signed delta, then copy from the output itself
//                    byte by byte, so a run may overlap what it is writing (that is how BPS
//                    encodes repetition)
//   sourceCRC32  targetCRC32  patchCRC32   (the last covers every byte before it)

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf, start = 0, end = buf.length) {
    let c = 0xFFFFFFFF;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

const hex = (n) => n.toString(16).padStart(8, '0');

// Throws with a sentence a person can act on. Every failure here means "this is not the file
// the patch was made for" or "the patch is damaged", and the message says which.
function applyBps(source, patch) {
    if (!Buffer.isBuffer(source) || !Buffer.isBuffer(patch)) throw new Error('applyBps needs two Buffers.');
    if (patch.length < 4 + 12 || patch.toString('latin1', 0, 4) !== 'BPS1') {
        throw new Error('The patch is not a BPS file.');
    }

    // The patch checks itself first: a truncated or corrupted download would otherwise
    // produce plausible garbage, and the target CRC would then blame the user's WAD for it.
    const footer = patch.length - 12;
    const patchCrc = patch.readUInt32LE(patch.length - 4);
    if (crc32(patch, 0, patch.length - 4) !== patchCrc) {
        throw new Error('The patch file is damaged (its checksum does not match). Download the mod again.');
    }

    let p = 4;
    // Numbers can exceed 2^32 in principle, so this uses arithmetic rather than bit shifts,
    // which would silently wrap at 32 bits.
    const num = () => {
        let data = 0, shift = 1;
        for (;;) {
            if (p >= footer) throw new Error('The patch ends in the middle of a number.');
            const x = patch[p++];
            data += (x & 0x7f) * shift;
            if (x & 0x80) break;
            shift *= 128;
            data += shift;
        }
        return data;
    };

    const sourceSize = num();
    const targetSize = num();
    const metaSize = num();
    p += metaSize;

    const sourceCrc = patch.readUInt32LE(footer);
    const targetCrc = patch.readUInt32LE(footer + 4);

    if (source.length !== sourceSize || crc32(source) !== sourceCrc) {
        throw new Error(
            `This is not the version of the file the patch was made for ` +
            `(expected ${sourceSize} bytes, CRC32 ${hex(sourceCrc)}; ` +
            `got ${source.length} bytes, CRC32 ${hex(crc32(source))}).`);
    }

    const target = Buffer.alloc(targetSize);
    let out = 0, srcRel = 0, tgtRel = 0;

    while (p < footer) {
        const data = num();
        const cmd = data % 4;
        let len = Math.floor(data / 4) + 1;
        if (out + len > targetSize) throw new Error('The patch writes past the end of the file it describes.');

        if (cmd === 0) {                         // SourceRead
            if (out + len > source.length) throw new Error('The patch reads past the end of the source.');
            source.copy(target, out, out, out + len);
            out += len;
        } else if (cmd === 1) {                  // TargetRead
            if (p + len > footer) throw new Error('The patch ends in the middle of its data.');
            patch.copy(target, out, p, p + len);
            p += len; out += len;
        } else if (cmd === 2) {                  // SourceCopy
            const d = num();
            srcRel += (d % 2 ? -1 : 1) * Math.floor(d / 2);
            if (srcRel < 0 || srcRel + len > source.length) throw new Error('The patch copies from outside the source.');
            source.copy(target, out, srcRel, srcRel + len);
            srcRel += len; out += len;
        } else {                                 // TargetCopy, byte by byte on purpose
            const d = num();
            tgtRel += (d % 2 ? -1 : 1) * Math.floor(d / 2);
            if (tgtRel < 0 || tgtRel >= out) throw new Error('The patch copies from part of the output not yet written.');
            while (len--) target[out++] = target[tgtRel++];
        }
    }

    if (out !== targetSize) throw new Error('The patch finished before the file it describes was complete.');
    if (crc32(target) !== targetCrc) {
        throw new Error('The patched file does not match what the patch promised (target checksum mismatch).');
    }
    return target;
}

module.exports = { applyBps, crc32 };
