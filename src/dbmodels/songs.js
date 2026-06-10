const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getSongs(params) {
    const client = await pool.connect();
    try {
        // join files per esporre il bitrate (proprietà del file fisico) insieme al brano
        const base = 'select s.*, f.bitrate from songs s left join files f on f.song_id = s.song_id';
        let stm, pars;
        if (params.albumid) {
            stm = `${base} where s.album_id = $1`;
            pars = [params.albumid];
        }
        else if (params.title) {
            stm = `${base} where s.title ilike $1`;
            pars = [`%${params.title}%`];
        }
        else {
            stm = base;
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

// write-through dell'editor: aggiorna la traccia in place — song_id resta stabile,
// le FK di files/user_stats/user_id3 non si toccano
async function updateSongFields(song_id, title, track_nr, disc_nr) {
    const client = await pool.connect();
    try {
        const stm = 'update songs set title=$2, track_nr=$3, disc_nr=$4 where song_id=$1';
        const pars = [song_id, title, track_nr, disc_nr];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB updateSongFields', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// rename album/artista nell'editor: sposta tutte le tracce sul nuovo album row
async function moveSongs(from_album_id, to_album_id) {
    const client = await pool.connect();
    try {
        const stm = 'update songs set album_id=$2 where album_id=$1';
        const pars = [from_album_id, to_album_id];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB moveSongs', err);
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
    updateSongFields,
    moveSongs,
    countSongs,
}
