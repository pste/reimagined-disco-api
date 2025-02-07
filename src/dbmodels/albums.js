const logger = require('../logger');
const pool = require('./dbpool');

async function getAlbumsByTitle(title) {
    const client = await pool.connect();
    let stm, pars;
    if (title) {
        stm = 'select * from albums where title ilike $1';
        pars = [`%${title}%`];
    }
    else {
        stm = 'select * from albums';
        pars = [];
    }
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows;
}

async function getAlbumsByArtist(artist_id) {
    const client = await pool.connect();
    const stm = 'select * from albums where artist_id = $1';
    const pars = [artist_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows;
}

async function getAlbum(album_id) {
    const client = await pool.connect();
    const stm = 'select * from albums where album_id = $1';
    const pars = [album_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function countAlbums() {
    const client = await pool.connect();
    const stm = 'select count(*) from albums';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows;
}

async function upsertAlbum(title, artistName, year, genre) {
    const artist = await artists.upsertArtist(artistName);
    //
    const client = await pool.connect();
    const stm = 'insert into albums (title, artist_id, "year", genre) values ($1,$2,$3,$4) \
                on conflict(title,artist_id) do update set title=$1, artist_id=$2, "year"=$3, genre=$4 \
                returning *';
    const pars = [title, artist.artist_id, year, genre];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function getCover(album_id) {
    const client = await pool.connect();
    const stm = 'select * from covers where album_id = $1';
    const pars = [album_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    if (rows.length === 1) {
        return rows[0];
    }
    else {
        return undefined;
    }
}

async function upsertCover(album_id, image_buffer) {
    // var arrByte = Uint8Array.from(data)
    const client = await pool.connect();
    const stm = 'insert into covers (album_id, imagedata) values ($1,$2) \
                on conflict(album_id) do update set imagedata=$2'; // this does not return data
    const imagedata = Uint8Array.from(image_buffer);
    const pars = [album_id, imagedata];
    logger.trace({album_id, imagedata: '..'}, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function clearEmptyAlbums() {
    let stm, pars;
    const client = await pool.connect();
    // clear empty albums
    stm = 'delete from albums where album_id not in (select album_id from songs)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    // clear empty cover
    stm = 'delete from covers where album_id not in (select album_id from songs)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    // clear empty artists
    stm = 'delete from artists where artist_id not in (select artist_id from albums)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    //
    client.release();
    return;
}

module.exports = {
    getAlbumsByTitle,
    getAlbumsByArtist,
    getAlbum,
    countAlbums,
    upsertAlbum,
    clearEmptyAlbums,
    getCover,
    upsertCover,
}