const fs = require('node:fs/promises');
const path = require('path');
const NodeID3 = require('node-id3').Promise;
const cron = require('node-cron');
const logger = require('./logger');
const db = require('./db');
const params = require('./parameters');

/* 
SAMPLE: {
	"title":"The Glass Prison", // TIT2
	"artist":"Dream Theater",   // TPE1
	"album":"Six Degrees of Inner Turbulence [Disc 1]", // TALB
	"trackNumber":"01",         // TRCK
	"year":"2002",              // TYER
	"genre":"Progressive",      // TCON
	"partOfSet":"1/2"           // TPOS
    "image" : ""            // APIC
}
*/
/**
 * Reads ID3 info from an MP3 file. It returns: album, artist, title, year, genre, trackNumber, partOfSet, image.
 * @param {*} filepath - The path of the mp3 file 
 * @returns An object with the ID3 info
 */
async function readid3(filepath) {
    const options = {
        noRaw: true,
        include: ['TIT2','TPE1','TALB','TRCK','TYER','TCON','TPOS','APIC'],
       // exclude: ['APIC'] // image
    };
    logger.trace(`ID3 for ${filepath} ...`)
    let tags = {}
    try {
        tags = await NodeID3.read(filepath, options);
    }
    catch(err) {
        logger.error(err);
    }
    return tags;
}

/**
 * Resolves the info for a file on the disk
 * @param {*} basedir - The root of the scan
 * @param {*} parentpath - The directory that contains the file
 * @param {*} filename - The file name
 * @returns A JSON with all the file info
 */
async function filedetails(basedir, parentpath, filename) {
    const fullpath = path.join(basedir, parentpath, filename);
    logger.trace(`Filedetails for ${fullpath} ...`)
    const stats = await fs.stat(fullpath);
    return {
        basedir,
        parentpath,
        filename,
        fullpath,
        atime: stats.atime,
        mtime: stats.mtime,
        ctime: stats.ctime,
        birthtime: stats.birthtime,
    };
}
/**
 * This function check if the filesystem item and the database item are the same. 
 * Comparison is made just checking the relative path. It can be improved using atime, ctime, mtime, size properties (TODO)
 * @param {*} fsItem - a file on the disk
 * @param {*} dbItem - a file saved on the db
 * @returns bool
 */
function isSameFile(fsItem, dbItem) {
    const dbpath = path.join(dbItem.basedir, dbItem.file_path, dbItem.file_name);
    const fspath = path.join(fsItem.basedir, fsItem.parentpath, fsItem.filename);
    if (dbpath === fspath) return true;
    return false;
}

/**
 * This function at first reads all of the files in the given folder and, for each file found, get its properties (atime, ctime, ...)
 * In a second step it gets all the "saved on DB" files.
 * Finally it compares the two lists: what is missing on the DB is added, what is changed is updated and what is missing
 * from filesystem is removed.
 * @param {*} forceFullScan - This disable the file check: every file on disk will be read and upserted
 */
async function fastscan( forceFullScan ) {
    try {
        // scan disk
        const folder = await params.baseDir();
        logger.info(`Start scanning on ${folder} ...`);
        // get files list    
        const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true });
        logger.info(`FastScan found ${flist.length} files`);
        // resolve files info
        const filesdisk = [];
        for await (const f of flist) {
            if (f.isFile() && f.name.toLowerCase().endsWith('.mp3')) {
                const relpath = path.relative(folder, f.parentPath);
                const details = await filedetails(folder, relpath, f.name);
                filesdisk.push(details);
            }
        }
        logger.info(`FastScan found ${filesdisk.length} mp3 files`);
    
        // scan db
        logger.info(`Start scanning on db ...`);
        const filesdb = await db.getFiles();
        logger.info(`FastScan found ${filesdb.length} db files`);

        // upsert new items
        logger.info(`DB updating ...`);
        for await (const diskfile of filesdisk) {
            // check if is new
            const idx = filesdb.findIndex(dbfile => isSameFile(diskfile, dbfile)); // TODO SLOW
            if (forceFullScan === true || idx < 0) {
                diskfile.tags = await readid3(diskfile.fullpath);
                // works on db - update
                logger.trace(`DB UPDATE: ${diskfile.fullpath}`);
                await db.updateSong(diskfile);
            }
            // remove just managed item to accelerate next db findings
            if (idx >= 0) {
                filesdb.splice(idx, 1);
            }
        }

        // scan removed items
        logger.info(`DB cleaning ...`);
        for await (let dbfile of filesdb) {
            // works on db - delete
            if (filesdisk.findIndex(diskfile => isSameFile(diskfile, dbfile)) < 0) {
                logger.trace(dbfile, "DB REMOVE");
                await db.removeFile(dbfile.song_id);
            }
        }
        await db.clearEmptyAlbums();
        //
        logger.info(`DB done!`);
    }
    catch(err) {
        logger.error(err);
        // DO NOT THROW
    }
}

/**
 * Install a cronjob that updates the library. 
 * The job definition is a parameter on the DB.
 */
async function installJob() {
    const job = await params.scanJobDefinition();
    logger.info(`Install scan job on ${job}`);
    cron.schedule(job, fastscan);
}

/////////////////////////////////////////////////////////////////

module.exports = {
    fastscan,
    installJob,
}