const fs = require('node:fs/promises');
const path = require('path');
const NodeID3 = require('node-id3').Promise;
const logger = require('./logger');
const db = require('./db');

/* 
SAMPLE: {
	"title":"The Glass Prison", // TIT2
	"artist":"Dream Theater",   // TPE1
	"album":"Six Degrees of Inner Turbulence [Disc 1]", // TALB
	"trackNumber":"01",         // TRCK
	"year":"2002",              // TYER
	"genre":"Progressive",      // TCON
	"partOfSet":"1/2"           // TPOS
}
*/
async function readid3(filepath) {
    const options = {
        noRaw: true,
        include: ['TIT2','TPE1','TALB','TRCK','TYER','TCON','TPOS'],
        exclude: ['APIC'] // image
    };
    const tags = await NodeID3.read(filepath, options);
    return tags;
}

async function filedetails(filepath) {
    const basename = path.basename(filepath);
    const dirname = path.dirname(filepath);
    const fullname = filepath;
    const stats = await fs.stat(filepath);
    const tags = await readid3(filepath);
    return {
        basename,
        dirname,
        fullname,
        atime: stats.atime,
        mtime: stats.mtime,
        ctime: stats.ctime,
        birthtime: stats.birthtime,
        tags
    };
}

async function scan() {
    const folder = './private'; // TODO
    logger.info(`Start scanning on ${folder} ...`);
    //
    const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true });
    const items = await Promise.all(
        flist
            .filter(f => f.isFile() && f.name.toLowerCase().endsWith('.mp3'))
            .map(async (f) => {
                const fpath = path.join(f.path, f.name);
                return await filedetails(fpath);
            })
    )
    logger.info(`Scan finished: found ${items.length} mp3 files`);
    //
    logger.info(`DB updating ...`);
    for await (let item of items) {
        await db.updateSong(item);
    }
    logger.info(`DB cleaning ...`);
    const dbfiles = await db.getFiles();
    for await (let file of dbfiles) {
        if (items.findIndex( item => item.basename===file.file_name && item.dirname===file.file_path) < 0) {
            await db.removeFile(file.file_id);
        }
    }
    logger.info(`DB done!`);
}


/////////////////////////////////////////////////////////////////

module.exports = {
    scan,
}
/*
scan().then(async () => {
    const d1 = await db.getAlbums("TIME");
    logger.debug(d1)
    const d2 = await db.getArtists("T")
    logger.debug(d2)
    const d3 = await db.stats();
    logger.debug(d3);
})*/