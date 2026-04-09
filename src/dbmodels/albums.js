const logger = require('../logger');
const dblog = require('./logs');
const artists = require('./artists');
const pool = require('./dbpool');

async function getCollection() {
    const client = await pool.connect();
    try {
        /*const stmOld = 'select al.*, ar.name \
                        from albums al \
                        join artists ar on al.artist_id = ar.artist_id';*/
        const stm = `WITH albumstats as (
            SELECT so.album_id, MAX(f.created) as added, MAX(s.played) as played, MAX(s.stars) as stars, MAX(playcount) as playcount
            FROM songs so
            LEFT JOIN user_stats s ON s.song_id = so.song_id
            LEFT JOIN files f ON so.song_id = f.song_id
            GROUP BY so.album_id
        )
        SELECT al.*, ar.name, st.added, st.played, st.playcount, st.stars
            FROM albums al
            INNER JOIN artists ar ON al.artist_id = ar.artist_id
            LEFT JOIN albumstats st ON al.album_id = st.album_id`;

        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getCollection', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getAlbumsByTitle(title) {
    const client = await pool.connect();
    try {
        let stm, pars;
        if (title) {
            stm = 'select * from albums where title ilike $1';
            pars = [`%${title}%`];
        }
        else {
            stm = 'select * from albums';
            pars = [];
        }
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getAlbumsByTitle', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getAlbumsByArtist(artist_id) {
    const client = await pool.connect();
    try {
        const stm = 'select * from albums where artist_id = $1';
        const pars = [artist_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getAlbumsByArtist', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getAlbum(album_id) {
    const client = await pool.connect();
    try {
        const stm = 'select * from albums where album_id = $1';
        const pars = [album_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB getAlbum', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function countAlbums() {
    const client = await pool.connect();
    try {
        const stm = 'select count(*) from albums';
        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB countAlbums', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function upsertAlbum(title, artistName, year, genre) {
    const artist = await artists.upsertArtist(artistName);
    const client = await pool.connect();
    try {
        const stm = 'insert into albums (title, artist_id, "year", genre) values ($1,$2,$3,$4) \
                    on conflict(title,artist_id) do update set title=$1, artist_id=$2, "year"=$3, genre=$4 \
                    returning *';
        const pars = [title, artist.artist_id, year, genre];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB upsertAlbum', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getCover(album_id) {
    const client = await pool.connect();
    try {
        const stm = 'select imagedata from covers where album_id = $1';
        const pars = [album_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        if (rows.length === 1) {
            return rows[0].imagedata;
        }
        else {
            return undefined;
        }
    }
    catch(err) {
        dblog.createLog('ERROR DB getCover', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function upsertCover(album_id, image_buffer) {
    const client = await pool.connect();
    try {
        // var arrByte = Uint8Array.from(data)
        const stm = 'insert into covers (album_id, imagedata) values ($1,$2) \
                    on conflict(album_id) do update set imagedata=$2'; // this does not return data
        const imagedata = Uint8Array.from(image_buffer);
        const pars = [album_id, imagedata];
        logger.trace({album_id, imagedata: '..'}, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB upsertCover', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function clearEmptyAlbums() {
    const client = await pool.connect();
    try {
        let stm, pars;
        // clear empty albums
        stm = 'delete from albums where album_id not in (select album_id from songs)';
        pars = [];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
        // clear empty cover
        stm = 'delete from covers where album_id not in (select album_id from songs)';
        pars = [];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
        // clear empty artists
        stm = 'delete from artists where artist_id not in (select artist_id from albums)';
        pars = [];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB clearEmptyAlbums', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = {
    getCollection,
    getAlbumsByTitle,
    getAlbumsByArtist,
    getAlbum,
    countAlbums,
    upsertAlbum,
    clearEmptyAlbums,
    getCover,
    upsertCover,
}
