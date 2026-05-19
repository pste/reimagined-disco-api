const fs = require('node:fs');
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

module.exports = {
    streamFile,
    chunkFile,
}