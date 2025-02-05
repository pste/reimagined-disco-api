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

async function upsertFile(song_id, basedir, file_path, file_name, modified) {
    let stm, pars, res;
    const client = await pool.connect();
    //
    stm = 'insert into sources ("path") values ($1) on conflict("path") do update set "path"=$1 returning *' // trick to return the row always (can be better? TODO)
    pars = [basedir];
    logger.trace(pars, stm);
    res = await client.query(stm, pars);
    logger.trace(res, "==============================")
    const sources = res.rows[0]
    //
    stm = 'insert into files (source_id, song_id, file_path, file_name, modified) values ($1,$2,$3,$4,$5) \
                on conflict(source_id, file_path, file_name) do update set song_id=$2, modified=$5 \
                returning *';
    pars = [sources.source_id, song_id, file_path, file_name, modified];
    logger.trace(pars, stm);
    res = await client.query(stm, pars);
    const rows = res.rows;
    //
    client.release();
    return rows[0];
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

    client.release();
    return rows[0];
}

async function removeFile(song_id) {
    let stm, pars;
    // delete file
    const client = await pool.connect();
    stm = 'delete from files where song_id=$1';
    pars = [song_id];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    // delete song
    stm = 'delete from songs where song_id=$1';
    pars = [song_id];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    //
    client.release();
    return;
}

async function clearEmptyAlbums() {
    let stm, pars;
    const client = await pool.connect();
    // clear empty albums
    stm = 'delete from covers where album_id not in (select album_id from songs)';
    pars = [];
    logger.trace(pars, stm);
    await client.query(stm, pars);
    stm = 'delete from albums where album_id not in (select album_id from songs)';
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

/////////////////////////////////////////////////////////////////

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

async function getAlbumsByTitle(title) {
    const client = await pool.connect();
    const stm = 'select * from albums where title ilike $1';
    const pars = [`%${title}%`];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

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

async function getCover(album_id) {
    const client = await pool.connect();
    const stm = 'select * from covers where album_id = $1';
    const pars = [album_id];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    if (rows.length === 1) {
        return rows[0];
    }
    else {
        return undefined;
    }
}

async function getSongs(title) {
    const client = await pool.connect();
    const stm = 'select * from songs where title ilike $1';
    const pars = [`%${title}%`];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

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

    client.release();
    return rows[0];
}

async function getFiles() {
    const client = await pool.connect();
    const stm = 'select so."path" as basedir,fi.* from files fi inner join sources so on fi.source_id=so.source_id';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function getSongFile(song_id) {
    const client = await pool.connect();
    const stm = 'select * from files where song_id = $1';
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
        basedir: fileinfo.basedir,
        filepath: fileinfo.parentpath, 
        filename: fileinfo.filename,
        modified: utils.maxDate(fileinfo.mtime, fileinfo.ctime), // last time when file/attributes has changed
        title: fileinfo.tags.title,
		artist: fileinfo.tags.artist || 'UNKNOWN',
		album: fileinfo.tags.album || 'UNKNOWN',
		year: utils.parseNumber(fileinfo.tags.year),
		genre: fileinfo.tags.genre || 'UNKNOWN',
		trackNumber: utils.parseNumber(fileinfo.tags.trackNumber),
		discNumber: utils.parseAlbumNumber(fileinfo.tags.partOfSet),
        cover: fileinfo.tags?.image?.imageBuffer // .data ?
    }
    if (songdata.artist === 'UNKNOWN') {
        logger.debug(songdata);
    }
    const album = await upsertAlbum(songdata.album, songdata.artist, songdata.year, songdata.genre);
    const song = await upsertSong(songdata.title, songdata.trackNumber, songdata.discNumber, album.album_id);
    logger.trace(song)
    const file = await upsertFile(song.song_id, songdata.basedir, songdata.filepath, songdata.filename, songdata.modified);
    if (songdata.cover) {
        await upsertCover(song.album_id, songdata.cover);
    }
    return file;
}

async function getAlbumInfo(album_id) {
    const album = await getAlbum(album_id);
    const cover = await getCover(album_id);
    const artist = await getArtist(album.artist_id);

    const data = {
        album_id,
		artist: artist.name,
		album: album.title,
		year: album.year,
		genre: album.genre,
        cover: cover?.imagedata
    }
    return data;
}

async function getSongInfo(song_id) {
    const file = await getSongFile(song_id);
    const song = await getSong(song_id);
    const albumdata = await getAlbumInfo(song.album_id);

    const data = {
        song_id,
        filepath: file.file_path, 
        filename: file.file_name,
        modified: file.modified,
        title: song.title,
		trackNumber: song.track_nr,
		discNumber: song.disc_nr,
    }
    return Object.assign(albumdata, data);
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
    getArtists,
    getAlbumsByTitle,
    getAlbumsByArtist,
    getSongs,
    getFiles,
    getSongInfo,
    getAlbumInfo,
    stats,
    updateSong,
    removeFile,
    clearEmptyAlbums,
}