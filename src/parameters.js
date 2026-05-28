const logger = require('./logger');
const db = require('./db');

//
async function baseDir() {
    const sources = await db.getSources();
    let basedir = process.env.MEDIA_BASEDIR;
    if (sources.length > 0) {
        basedir = sources[0].path; // TODO reading the 1st one ?
    }
    logger.info(`Obtaining base folder: ${basedir} ...`)
    return basedir;
}

//
module.exports = {
    baseDir,
}