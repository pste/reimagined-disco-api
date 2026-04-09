const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getSongs(params) {
    const client = await pool.connect();
    try {
        let stm, pars;
        if (params.albumid) {
            stm = 'select * from songs where album_id = $1';
            pars = [params.albumid];
        }
        else if (params.title) {
            stm = 'select * from songs where title ilike $1';
            pars = [`%${params.title}%`];
        }
        else {
            stm = 'select * from songs';
            pars = [];
        }
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getSongs', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getSong(song_id) {
    const client = await pool.connect();
    try {
        const stm = 'select * from songs where song_id = $1';
        const pars = [song_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB getSong', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getSongStats(song_id) {
    const client = await pool.connect();
    try {
        const stm = 'select * from statistics where song_id = $1';
        const pars = [song_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB getSongStats', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getSongFile(song_id) {
    const client = await pool.connect();
    try {
        const stm = 'select so.path as source_path,fi.* from files fi join sources so on fi.source_id=so.source_id where fi.song_id = $1';
        const pars = [song_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB getSongFile', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function upsertSong(title, tracknr, discnr, album_id) {
    const client = await pool.connect();
    try {
        const stm = 'insert into songs (title, track_nr, disc_nr, album_id) values ($1,$2,$3,$4) \
                    on conflict(title,album_id) do update set title=$1, track_nr=$2, disc_nr=$3, album_id=$4 \
                    returning *';
        const pars = [title, tracknr, discnr, album_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB upsertSong', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function countSongs() {
    const client = await pool.connect();
    try {
        const stm = 'select count(*) from songs';
        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB countSongs', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = {
    getSongs,
    getSong,
    getSongStats,
    getSongFile,
    upsertSong,
    countSongs,
}
