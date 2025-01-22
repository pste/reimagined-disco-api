const fs = require('node:fs/promises');
const path = require('path');
const NodeID3 = require('node-id3').Promise;
const logger = require('./logger');
const db = require('./db');

/* SAMPLE: {
	"title":"The Glass Prison", // TIT2
	"artist":"Dream Theater",   // TPE1
	"album":"Six Degrees of Inner Turbulence [Disc 1]", // TALB
	"trackNumber":"01", // TRCK
	"year":"2002", // TYER
	"genre":"Progressive", // TCON
	"partOfSet":"1/2" // TPOS
}
*/
async function readid3(filepath) {
    const options = {
        noRaw: true,
        include: ['TIT2','TPE1','TALB','TRCK','TYER','TCON','TPOS'],
        exclude: ['APIC'] // image
    }
    const tags = await NodeID3.read(filepath, options)
    //logger.debug(tags, `FILE: ${filepath}`)
    return tags
}

async function filedetails(filepath) {
    const basename = path.basename(filepath)
    const dirname = path.dirname(filepath)
    const fullname = filepath
    const stats = await fs.stat(filepath)
    const tags = await readid3(filepath)
    return {
        basename,
        dirname,
        fullname,
        atime: stats.atime,
        mtime: stats.mtime,
        ctime: stats.ctime,
        birthtime: stats.birthtime,
        tags
    }
}

async function scan() {
    const folder = './private' // TODO
    logger.debug(`Start scanning on ${folder} ...`)
    //
    const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true })
    const items = await Promise.all(
        flist
            .filter(f => f.isFile())
            .map( async (f) => {
                const fpath = path.join(f.path, f.name)
                return await filedetails(fpath)
            })
    )
    logger.info(`Scan finished: found ${items.length} mp3 files`)
    //
    logger.info(`DB updating ...`)
    for await (let item of items) {
        db.updateSong(item);
    }
    logger.info(`DB updated!`)
}

scan()