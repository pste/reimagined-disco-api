const logger = require('./logger');
const db = require('./db');

//
async function baseDir() {
    const sources = await db.getSources();
    let basedir = '/home/steo/DEV/reimagined-disco-api/private'; // './private'; // TODO
    if (sources.length > 0) {
        basedir = sources[0].path; // TODO reading the 1st one ?
    }
    logger.info(`Obtaining base folder: ${basedir} ...`)
    return basedir;
}

//
async function scanJobDefinition() {
    // TODO on DB
    return '0 23 * * 1,5'; // At 23:00 on Monday and Friday.
}

//
module.exports = {
    baseDir,
    scanJobDefinition
}