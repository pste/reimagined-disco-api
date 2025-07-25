const logger = require('../logger');
const pool = require('./dbpool');

async function getArtists(name) {
    const client = await pool.connect();
    let stm, pars;
    if (name) {
        stm = 'select * from artists where "name" ilike $1';
        pars = [`%${name}%`];
    }
    else {
        stm = 'select * from artists';
        pars = [];
    }
    logger.trace(pars, `DB: ${stm}`);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows;
}

async function getArtist(artist_id) {
    const client = await pool.connect();
    const stm = 'select * from artists where artist_id = $1';
    const pars = [artist_id];
    logger.trace(pars, `DB: ${stm}`);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function getCover(artist_id) {
    const client = await pool.connect();
    const stm = `with firstalbum as (
        select artist_id,album_id,row_number() OVER (PARTITION BY artist_id ORDER BY "year") AS idx FROM albums
    )
    select co.* from firstalbum al join covers co on al.album_id=co.album_id
    where al.idx=1 and al.artist_id=$1;`;
    const pars = [artist_id];
    logger.trace(pars, `DB: ${stm}`);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function upsertArtist(artist) {
    const client = await pool.connect();
    const stm = 'insert into artists ("name") values ($1) \
                on conflict("name") do update set "name"=$1 \
                returning *';
    const pars = [artist];
    logger.trace(pars, `DB: ${stm}`);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function countArtists() {
    const client = await pool.connect();
    const stm = 'select count(*) from artists';
    const pars = [];
    logger.trace(pars, `DB: ${stm}`);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows;
}

module.exports = {
    getArtist,
    getCover, // 1st album cover of the artist
    getArtists,
    upsertArtist,
    countArtists
}