const fs = require('node:fs');
const mm = require('music-metadata');
const NodeID3 = require('node-id3').Promise;
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

async function readMetadata(filepath) {
    try {
        const filesize = fs.statSync(filepath).size;
        const { format } = await mm.parseFile(filepath, { duration: false });
        const bitrate = format.bitrate ?? null;
        const duration = bitrate ? Math.round((filesize * 8) / bitrate) : null;
        return { filesize, bitrate, duration };
    } catch(err) {
        logger.error(err, 'readMetadata error');
        return { filesize: null, bitrate: null };
    }
}

async function readId3(filepath) {
    try {
        const { common, format } = await mm.parseFile(filepath, { duration: false, skipCovers: true });
        return {
            title:   common.title   ?? null,
            artist:  common.artist  ?? null,
            album:   common.album   ?? null,
            year:    common.year    ?? null,
            genre:   common.genre   ?? null,
            track:   common.track   ?? null,
            disk:    common.disk    ?? null,
            bitrate: format.bitrate ?? null,
        };
    } catch(err) {
        logger.error(err, 'readId3 error');
        return null;
    }
}

async function writeId3(filepath, tags) {
    const id3tags = {};
    if (tags.title  != null) { id3tags.title       = tags.title; }
    if (tags.artist != null) { id3tags.artist      = tags.artist; }
    if (tags.album  != null) { id3tags.album       = tags.album; }
    if (tags.year   != null) { id3tags.year        = String(tags.year); }
    if (tags.genre  != null) { id3tags.genre       = Array.isArray(tags.genre) ? tags.genre[0] : tags.genre; }
    if (tags.track?.no != null) { id3tags.trackNumber = tags.track.of ? `${tags.track.no}/${tags.track.of}` : String(tags.track.no); }
    if (tags.disk?.no  != null) { id3tags.partOfSet   = tags.disk.of  ? `${tags.disk.no}/${tags.disk.of}`   : String(tags.disk.no); }
    logger.trace(`writeId3 ${filepath}`, id3tags);
    try {
        const result = await NodeID3.update(id3tags, filepath);
        logger.trace(`writeId3 done ${filepath}`);
        return result;
    } catch(err) {
        logger.error(err, 'writeId3 error');
        throw err;
    }
}

module.exports = {
    streamFile,
    chunkFile,
    readMetadata,
    readId3,
    writeId3,
}