const pg = require('pg');
const { Pool } = pg;
const logger = require('./logger');
const utils = require('./utils');

const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 20000,
})

/////////////////////////////////////////////////////////////////

async function getFile(file_path, file_name) {
    const client = await pool.connect();
    const stm = 'select * from files where file_path=$1 and file_name=$2';
    const pars = [file_path, file_name];
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function upsertArtist(artist) {
    const client = await pool.connect();
    const stm = 'insert into artists ("name") values ($1) \
                on conflict("name") do update set "name"=$1 \
                returning *';
    const pars = [artist || 'UNKNOWN'];
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
    const res = await client.query(stm, pars);
    const rows = res.rows;

    client.release();
    return rows;
}

async function upsertFile(file_path, file_name, song_id) {
    const client = await pool.connect();
    const stm = 'insert into files (file_path, file_name, song_id) values ($1,$2,$3) \
                on conflict(file_path,file_name) do update set file_path=$1, file_name=$2, song_id=$3 \
                returning *';
    const pars = [file_path, file_name, song_id];
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
		artist: fileinfo.tags.artist,
		album: fileinfo.tags.album,
		year: fileinfo.tags.year,
		genre: fileinfo.tags.genre,
		trackNumber: fileinfo.tags.trackNumber,
		discNumber: utils.parseAlbumNumber(fileinfo.tags.partOfSet),
    }
    logger.trace(songdata)
    const album = await upsertAlbum(songdata.album, songdata.artist, songdata.year, songdata.genre);
    const song = await upsertSong(songdata.title, songdata.trackNumber, songdata.discNumber, album.album_id);
    const file = await upsertFile(songdata.filepath, songdata.filename, song.song_id);
    return file;
}

module.exports = {
    updateSong,
}