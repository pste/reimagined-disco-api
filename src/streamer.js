const fs = require('node:fs');
const mm = require('music-metadata');
const logger = require('./logger');

function streamFile( request, reply, filepath ) {
    const audioSize = fs.statSync(filepath).size;
    logger.info(`STREAM: Requested size: ${audioSize}`);
    const range = request.range(audioSize);
    logger.info(range, `STREAM: Requested range.`);
    if (!range) {
        const error = new Error('Range Not Satisfiable');
        error.statusCode = 416;
        throw error;
    }

    // Handle only the first range requested
    const singleRange = range.ranges[0]

    // Define the size of the chunk to send
    const chunkSize = 1 * 1e6; // 1MB
    const { start } = singleRange;
    const end = Math.min(start + chunkSize, audioSize - 1);
    const contentLength = end - start + 1; // end is inclusive

    // Set the appropriate headers for range requests
    reply.headers({
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${audioSize}`,
        'Content-Length': contentLength
    })

    // Send a 206 Partial Content status code
    reply.code(206);
    reply.type('audio/mpeg');
    const stream = fs.createReadStream(filepath, { start, end });
    return stream;
}

async function chunkFile(filepath) {
    return new Promise((resolve, reject) => {
        const buffer = [];
        const stream = fs.createReadStream(filepath, { highWaterMark: 1 * 1e6 }); // 1Mb blocks

        stream.on('data', (chunk) => {
            // chunk è un Buffer di ~highWaterMark byte (l'ultimo può essere più piccolo)
            buffer.push(chunk);
            logger.trace(`received block ${chunk.length} bytes`)
        });
        stream.on('end', () => {
            logger.trace(`done buffering ${buffer.length} blocks`)
            resolve(buffer);
        });
        stream.on('error', (err) => {
            console.error(err);
            reject(err);
        }); 
    })
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
    streamFile,
    chunkFile,
    readMetadata,
}