const fs = require('node:fs/promises')
const path = require('path')

async function filedetails(f) {
    const basename = path.basename(f)
    const dirname = path.dirname(f)
    const stats = await fs.stats(f)
    return {
        basename,
        dirname,
        atime: stats.atime,
        mtime: stats.mtime,
        ctime: stats.ctime,
        birthtime: stats.birthtime,
    }
}

async function scan() {
    const folder = '/home/steo' // TODO
    const flist = await fs.readdir(folder, { recursive: true, withFileTypes: true })
    const result = await Promise.all(
        flist
            .filter(f => f.isFile())
            .map( async (f) => {
                const fpath = path.join(f.path, f.name)
                return await filedetails(fpath)
            })
    )
}