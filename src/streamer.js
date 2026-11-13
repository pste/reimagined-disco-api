const fs = require('node:fs');
const mm = require('music-metadata');
const logger = require('./logger');

// file intero come allegato da scaricare (pulsante download nel player)
function downloadFile( reply, filepath, filename ) {
    const size = fs.statSync(filepath).size;
    reply.headers({
        'Content-Length': size,
        // filename* (RFC 5987) per i nomi con accenti; filename ASCII come fallback
        'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    });
    reply.type('audio/mpeg');
    return fs.createReadStream(filepath);
}

// i brani viaggiano verso la UI a blocchi di dimensione fissa (la UI ci conta: mappa
// tempo→chunk del seek in useStreamedAudio.js, CHUNK_BYTES)
const CHUNK_BYTES = 1e6;

function totalChunks(filesize) {
    return Math.ceil(filesize / CHUNK_BYTES);
}

// dimensione del file in byte, null se il file non esiste
async function fileSize(filepath) {
    try {
        return (await fs.promises.stat(filepath)).size;
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

// Legge dal disco solo il chunk richiesto (1-based). Prima si leggeva l'intero file in
// memoria per servirne 1 MB. Ritorna null oltre la fine del file.
async function readChunk(filepath, chunkIndex) {
    const handle = await fs.promises.open(filepath, 'r');
    try {
        const buffer = Buffer.alloc(CHUNK_BYTES);
        const start = (chunkIndex - 1) * CHUNK_BYTES;
        // una read può restituire meno byte di quelli chiesti (filesystem di rete):
        // si continua finché il blocco è pieno o il file è finito
        let filled = 0;
        while (filled < CHUNK_BYTES) {
            const { bytesRead } = await handle.read(buffer, filled, CHUNK_BYTES - filled, start + filled);
            if (bytesRead === 0) {
                break;
            }
            filled += bytesRead;
        }
        if (filled === 0) {
            return null;
        }
        return buffer.subarray(0, filled);
    }
    finally {
        await handle.close();
    }
}

// Dimensione del tag ID3v2 in testa al file = byte da saltare prima dell'audio.
// Header di 10 byte: "ID3", versione (2), flag (1), size (4, syncsafe: 7 bit per byte,
// header escluso); il flag 0x10 indica un footer di altri 10 byte. 0 se il tag non c'è.
async function readAudioOffset(filepath) {
    const handle = await fs.promises.open(filepath, 'r');
    try {
        const header = Buffer.alloc(10);
        const { bytesRead } = await handle.read(header, 0, 10, 0);
        if (bytesRead < 10 || header.toString('latin1', 0, 3) !== 'ID3') {
            return 0;
        }
        const size = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9];
        const footer = (header[5] & 0x10) ? 10 : 0;
        return 10 + size + footer;
    }
    finally {
        await handle.close();
    }
}

// duration: quella di music-metadata (per i CBR esclude già i tag, per i VBR usa l'header
// Xing/Info), NON filesize*8/bitrate: conterebbe anche il tag ID3v2, che con una cover
// APIC può valere decine di secondi. audioOffset serve alla UI per la mappa tempo→byte del seek.
async function readMetadata(filepath) {
    try {
        const filesize = fs.statSync(filepath).size;
        const audioOffset = await readAudioOffset(filepath);
        const { format } = await mm.parseFile(filepath, { duration: false });
        const bitrate = format.bitrate ?? null;
        let duration = null;
        if (format.duration) {
            duration = Math.round(format.duration);
        }
        else if (bitrate) {
            duration = Math.round(((filesize - audioOffset) * 8) / bitrate);
        }
        return { filesize, bitrate, duration, audioOffset };
    } catch(err) {
        logger.error(err, 'readMetadata error');
        return { filesize: null, bitrate: null };
    }
}

module.exports = {
    downloadFile,
    fileSize,
    readChunk,
    totalChunks,
    readMetadata,
}