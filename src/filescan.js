const fs = require('node:fs/promises');
const path = require('path');
const NodeID3 = require('node-id3').Promise;
const logger = require('./logger');
const db = require('./db');

const folder = '/home/steo/DEV/reimagined-disco-api/private' // './private'; // TODO

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

async function filedetails(basedir, parentpath, filename) {
    const fullpath = path.join(basedir, parentpath, filename);
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

function isSamePath(fsItem, dbItem) { // fullllllpath
    const fsPath = path.join();
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
                const details = await filedetails(folder, path.relative(folder, f.parentPath), f.name);
                const tags = await readid3(details.fullpath);
                return Object.assign(details, { tags });
            })
    )
    logger.info(`Scan finished: found ${filesdisk.length} mp3 files`);
    //
    logger.info(`DB updating ...`);
    for await (let item of filesdisk) {
        logger.trace(`DB UPDATE: ${item.fullpath}`);
        await db.updateSong(item);
    }
    logger.info(`DB cleaning ...`);
    const filesdb = await db.getFiles();
    for await (let dbfile of filesdb) {
        if (filesdisk.findIndex(diskfile => isSamePath(diskfile, dbfile)) < 0) {
            logger.trace(dbfile, "DB REMOVE");
            await db.removeFile(dbfile.song_id);
        }
    }
    await db.clearEmptyAlbums();
    logger.info(`DB done!`);
}

async function fastscan() {
    logger.info(`Start scanning on ${folder} ...`);
    // scan disk and db
    const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true });
    // const filesdisk = flist.filter(f => f.isFile() && f.name.toLowerCase().endsWith('.mp3'));
    const filesdisk = await Promise.all(
        flist
            .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.mp3'))
            .map(async (f) => {
                const details = await filedetails(folder, path.relative(folder, f.parentPath), f.name);
                return details;
            })
    );
    const filesdb = await db.getFiles();
    logger.info(`FastScan found ${filesdisk.length} mp3 files and ${filesdb.length} db files`);
    // scan new items
    const newitems = await Promise.all(
        filesdisk
            .filter(diskfile => {
                const idx = filesdb.findIndex(dbfile => isSamePath(diskfile, dbfile));
                return (idx < 0);
            })
            .map(async (diskfile) => {
                diskfile.tags = await readid3(diskfile.fullpath);
                return diskfile;
            })
    );
    logger.info(`FastScan finished: found ${newitems.length} new mp3 files`);

    if (newitems.length > 0) {
        // works on db - update
        logger.info(`DB updating ...`);
        for await (let item of newitems) {
            logger.trace(`DB UPDATE: ${item.fullpath}`);
            await db.updateSong(item);
        }
        // works on db - delete
        logger.info(`DB cleaning ...`);
        for await (let dbfile of filesdb) {
            if (filesdisk.findIndex(diskfile => isSamePath(diskfile, dbfile)) < 0) {
                logger.trace(dbfile, "DB REMOVE");
                await db.removeFile(dbfile.song_id);
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