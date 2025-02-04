const fs = require('node:fs/promises');
const path = require('path');
const NodeID3 = require('node-id3').Promise;
const logger = require('./logger');
const db = require('./db');

const folder = './private'; // TODO

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
async function readid3(filepath) {
    const options = {
        noRaw: true,
        include: ['TIT2','TPE1','TALB','TRCK','TYER','TCON','TPOS','APIC'],
       // exclude: ['APIC'] // image
    };
    const tags = await NodeID3.read(filepath, options);
    return tags;
}

async function filedetails(filepath) {
    const basename = path.basename(filepath);
    const dirname = path.dirname(filepath);
    const fullname = filepath;
    const stats = await fs.stat(filepath);
    return {
        basename,
        dirname,
        fullname,
        atime: stats.atime,
        mtime: stats.mtime,
        ctime: stats.ctime,
        birthtime: stats.birthtime,
    };
}

function isSamePath(fsItem, dbItem) {
    if (fsItem.path === dbItem.file_path && fsItem.name === dbItem.file_name) return true;
    return false;
}

async function fullscan() {
    logger.info(`Start scanning on ${folder} ...`);
    //
    const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true });
    const filesdisk = await Promise.all(
        flist
            .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.mp3'))
            .map(async (f) => {
                const fpath = path.join(f.path, f.name);
                const details = await filedetails(fpath);
                const tags = await readid3(fpath);
                return Object.assign(details, { tags });
            })
    )
    logger.info(`Scan finished: found ${filesdisk.length} mp3 files`);
    //
    logger.info(`DB updating ...`);
    for await (let item of filesdisk) {
        logger.trace(`DB UPDATE: ${item.fullname}`);
        await db.updateSong(item);
    }
    logger.info(`DB cleaning ...`);
    const filesdb = await db.getFiles();
    for await (let file of filesdb) {
        if (filesdisk.findIndex(item => isSamePath(file, item)) < 0) {
            logger.trace(file, "DB REMOVE");
            await db.removeFile(file.song_id);
        }
    }
    await db.clearEmptyAlbums();
    logger.info(`DB done!`);
}

async function fastscan() {
    logger.info(`Start scanning on ${folder} ...`);
    // scan disk and db
    const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true });
    const filesdisk = flist.filter(f => f.isFile() && f.name.toLowerCase().endsWith('.mp3'));
    const filesdb = await db.getFiles();
    logger.info(`FastScan found ${filesdisk.length} mp3 files and ${filesdb.length} db files`);
    // scan new items
    const newitems = await Promise.all(
        filesdisk
            .filter(file => {
                const idx = filesdb.findIndex(item => isSamePath(file, item));
                return (idx < 0);
            })
            .map(async (file) => {
                const fpath = path.join(file.path, file.name);
                const details = await filedetails(fpath);
                const tags = await readid3(fpath);
                return Object.assign(details, { tags });
            })
    );
    logger.info(`FastScan finished: found ${newitems.length} new mp3 files`);
    if (newitems.length > 0) {
        // works on db - update
        logger.info(`DB updating ...`);
        for await (let item of newitems) {
            logger.trace(`DB UPDATE: ${item.fullname}`);
            await db.updateSong(item);
        }
        // works on db - delete
        logger.info(`DB cleaning ...`);
        for await (let file of filesdb) {
            if (filesdisk.findIndex(item => isSamePath(file, item)) < 0) {
                logger.trace(file, "DB REMOVE");
                await db.removeFile(file.song_id);
            }
        }
        await db.clearEmptyAlbums();
    }
    logger.info(`DB done!`);
}

/////////////////////////////////////////////////////////////////

module.exports = {
    fullscan,
    fastscan,
}