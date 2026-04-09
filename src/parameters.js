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
async function scanJobDefinition() {
    const pars = await db.getParameters();
    if (pars.length > 0) {
        return pars[0].cronScan;
    }
    return '0 23 * * 1,5'; // some default: at 23:00 on Monday and Friday.
}

//
module.exports = {
    baseDir,
    scanJobDefinition
}