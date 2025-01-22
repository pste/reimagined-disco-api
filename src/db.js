const pg = require('pg');
const { Pool } = pg;
const logger = require('./logger');
const utils = require('./utils');

const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 20000,
})

/////////////////////////////////////////////////////////////////

async function upsertArtist(artist) {
    const client = await pool.connect();
    const stm = 'insert into artists ("name") values ($1) \
                on conflict("name") do update set "name"=$1 \
                returning *';
    const pars = [artist];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows[0];
}

async function upsertAlbum(title, artistName, year, genre) {
    const artist = await upsertArtist(artistName);
    //
    const client = await pool.connect();
    const stm = 'insert into albums (title, artist_id, "year", genre) values ($1,$2,$3,$4) \
                on conflict(title,artist_id) do update set title=$1, artist_id=$2, "year"=$3, genre=$4 \
                returning *';
    const pars = [title, artist.artist_id, year, genre];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

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

    client.release();
    return rows[0];
}

async function upsertFile(file_path, file_name, song_id) {
    const client = await pool.connect();
    const stm = 'insert into files (file_path, file_name, song_id) values ($1,$2,$3) \
                on conflict(song_id) do update set file_path=$1, file_name=$2 \
                returning *';
    const pars = [file_path, file_name, song_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows[0];
}

async function removeFile(file_id) {
    let stm, pars;
    // delete file
    const client = await pool.connect();
    stm = 'delete files where file_id=$1';
    pars = [file_id];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    // clear dangling songs
    stm = 'delete songs where song_id not in (select song_id from files)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    // clear empty albums
    stm = 'delete albums where album_id not in (select album_id from songs)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    // clear empty artists
    stm = 'delete artists where artist_id not in (select artist_id from albums)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    //
    client.release();
    return rows;
}

/////////////////////////////////////////////////////////////////

async function getAlbums(title) {
    const client = await pool.connect();
    const stm = 'select * from albums where title ilike $1';
    const pars = [`%${title}%`];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

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

    client.release();
    return rows[0];
}

async function getArtists(name) {
    const client = await pool.connect();
    const stm = 'select * from artists where "name" ilike $1';
    const pars = [`%${name}%`];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function getArtist(artist_id) {
    const client = await pool.connect();
    const stm = 'select * from artists where artist_id = $1';
    const pars = [artist_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows[0];
}

async function getFiles() {
    const client = await pool.connect();
    const stm = 'select * from files';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function getFile(song_id) {
    const client = await pool.connect();
    const stm = 'select * from files where song_id = $1';
    const pars = [song_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows[0];
}

async function getSong(song_id) {
    const client = await pool.connect();
    const stm = 'select * from songs where song_id = $1';
    const pars = [song_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows[0];
}

async function countArtists() {
    const client = await pool.connect();
    const stm = 'select count(*) from artists';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function countAlbums() {
    const client = await pool.connect();
    const stm = 'select count(*) from albums';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function countSongs() {
    const client = await pool.connect();
    const stm = 'select count(*) from songs';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

/////////////////////////////////////////////////////////////////

async function updateSong(fileinfo) {
    // normalize data before upsert
    const songdata = {
        filepath: fileinfo.dirname, 
        filename: fileinfo.basename,
        title: fileinfo.tags.title,
		artist: fileinfo.tags.artist || 'UNKNOWN',
		album: fileinfo.tags.album || 'UNKNOWN',
		year: utils.parseNumber(fileinfo.tags.year),
		genre: fileinfo.tags.genre || 'UNKNOWN',
		trackNumber: utils.parseNumber(fileinfo.tags.trackNumber),
		discNumber: utils.parseAlbumNumber(fileinfo.tags.partOfSet),
    }
    if (songdata.artist === 'UNKNOWN') {
        logger.debug(songdata);
    }
    const album = await upsertAlbum(songdata.album, songdata.artist, songdata.year, songdata.genre);
    const song = await upsertSong(songdata.title, songdata.trackNumber, songdata.discNumber, album.album_id);
    logger.trace(song)
    const file = await upsertFile(songdata.filepath, songdata.filename, song.song_id);
    return file;
}

async function getSongInfo(song_id) {
    const file = await getFile(song_id);
    const song = await getSong(song_id);
    const album = await getAlbum(song.album_id);
    const artist = await getArtist(album.artist_id);
    const songdata = {
        filepath: file.file_path, 
        filename: file.file_name,
        title: song.title,
		artist: artist.name,
		album: album.title,
		year: album.year,
		genre: album.genre,
		trackNumber: song.track_nr,
		discNumber: song.disc_nr,
    }
    return songdata;
}

async function stats() {
    const c1 = await countArtists();
    const c2 = await countAlbums();
    const c3 = await countSongs();
    return {
        artists: c1[0].count,
        albums: c2[0].count,
        songs: c3[0].count
    }
}

/////////////////////////////////////////////////////////////////

module.exports = {
    stats,
    getAlbums,
    getArtists,
    getFiles,
    getSongInfo,
    updateSong,
    removeFile,
}