const logger = require('../logger');
const pool = require('./dbpool');

async function getSongs(title) {
    const client = await pool.connect();
    let stm, pars;
    if (title) {
        stm = 'select * from songs where title ilike $1';
        pars = [`%${title}%`];
    }
    else {
        stm = 'select * from songs';
        pars = [];
    }
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows;
}

async function getSong(song_id) {
    const client = await pool.connect();
    const stm = 'select * from songs where song_id = $1';
    const pars = [song_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function getSongFile(song_id) {
    const client = await pool.connect();
    const stm = 'select * from files where song_id = $1';
    const pars = [song_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function upsertSong(title, tracknr, discnr, album_id) {
    const client = await pool.connect();
    const stm = 'insert into songs (title, track_nr, disc_nr, album_id) values ($1,$2,$3,$4) \
                on conflict(title,album_id) do update set title=$1, track_nr=$2, disc_nr=$3, album_id=$4 \
                returning *';
    const pars = [title, tracknr, discnr, album_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function countSongs() {
    const client = await pool.connect();
    const stm = 'select count(*) from songs';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows;
}

module.exports = {
    getSongs,
    getSong,
    getSongFile,
    upsertSong,
    countSongs,
}