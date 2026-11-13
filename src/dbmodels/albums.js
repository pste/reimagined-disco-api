const artists = require('./artists');
const pool = require('./dbpool');
const { query } = require('./dbquery');

async function getCollection(user_id) {
    // user_stats filtrate per utente nella ON (non nella WHERE: resterebbe una LEFT JOIN
    // solo di nome e sparirebbero gli album mai ascoltati dall'utente)
    const stm = `WITH albumstats as (
        SELECT so.album_id, MAX(f.created) as added, MAX(s.played) as played, MAX(s.stars) as stars, MAX(s.playcount) as playcount
        FROM songs so
        LEFT JOIN user_stats s ON s.song_id = so.song_id AND s.user_id = $1
        LEFT JOIN files f ON so.song_id = f.song_id
        GROUP BY so.album_id
    )
    SELECT al.*, ar.name, st.added, st.played, st.playcount, st.stars, (uf.user_id IS NOT NULL) AS favorite
        FROM albums al
        INNER JOIN artists ar ON al.artist_id = ar.artist_id
        LEFT JOIN albumstats st ON al.album_id = st.album_id
        LEFT JOIN user_favorites uf ON uf.album_id = al.album_id AND uf.user_id = $1`;

    const pars = [user_id];
    const res = await query('getCollection', stm, pars);
    return res.rows;
}

async function getAlbum(album_id) {
    const stm = 'select * from albums where album_id = $1';
    const pars = [album_id];
    const res = await query('getAlbum', stm, pars);
    return res.rows[0];
}

// lookup per (title, artist_id): serve all'editor per capire se un rename
// resta sulla stessa riga (in-place) o converge su un altro album (merge)
async function findAlbum(title, artist_id) {
    const stm = 'select * from albums where title = $1 and artist_id = $2';
    const pars = [title, artist_id];
    const res = await query('findAlbum', stm, pars);
    return res.rows[0];
}

// rename in-place dell'editor: aggiorna la riga per chiave, album_id mai cambiato
async function updateAlbumById(album_id, title, artist_id, year, genre) {
    const stm = 'update albums set title=$2, artist_id=$3, "year"=$4, genre=$5 where album_id=$1';
    const pars = [album_id, title, artist_id, year, genre];
    await query('updateAlbumById', stm, pars);
}

async function countAlbums() {
    const stm = 'select count(*) from albums';
    const pars = [];
    const res = await query('countAlbums', stm, pars);
    return res.rows;
}

async function upsertAlbum(title, artistName, year, genre) {
    const artist = await artists.upsertArtist(artistName);
    const stm = 'insert into albums (title, artist_id, "year", genre) values ($1,$2,$3,$4) \
                on conflict(title,artist_id) do update set title=$1, artist_id=$2, "year"=$3, genre=$4 \
                returning *';
    const pars = [title, artist.artist_id, year, genre];
    const res = await query('upsertAlbum', stm, pars);
    return res.rows[0];
}

async function getCover(album_id) {
    const stm = 'select imagedata from covers where album_id = $1';
    const pars = [album_id];
    const res = await query('getCover', stm, pars);
    const rows = res.rows;
    if (rows.length === 1) {
        return rows[0].imagedata;
    }
    else {
        return undefined;
    }
}

async function upsertCover(album_id, image_buffer) {
    const stm = 'insert into covers (album_id, imagedata) values ($1,$2) \
                on conflict(album_id) do update set imagedata=$2'; // this does not return data
    const imagedata = Uint8Array.from(image_buffer);
    const pars = [album_id, imagedata];
    const res = await query('upsertCover', stm, pars, { tracePars: false });
    return res.rows[0];
}

// Memorizza il release-group MBID sull'album: la prossima ricerca cover salta la search testuale.
async function setReleaseGroup(album_id, mbid) {
    const stm = 'update albums set mb_release_group_id=$2 where album_id=$1';
    const pars = [album_id, mbid];
    await query('setReleaseGroup', stm, pars);
}

// in transazione: le delete sono legate (prima chi referenzia, poi chi è referenziato),
// un errore a metà non deve lasciare la pulizia a pezzi. Dentro un'altra transazione
// (save dell'editor) si unisce a quella
async function clearEmptyAlbums() {
    return await pool.transaction(_clearEmptyAlbums);
}

async function _clearEmptyAlbums() {
    let stm, pars;
    // clear song orfane (senza file): un rename dei tag fatto fuori dall'app (tool
    // esterno) fa sì che lo scan, alla riconvergenza per chiave naturale (title,album_id),
    // crei una NUOVA song e riassegni il file ad essa via upsertFile, lasciando la vecchia
    // song senza file → tiene vivo il vecchio album/artista. Vanno raccolte qui.
    // song_id è referenziato senza CASCADE: prima user_id3/user_stats, poi songs.
    // NOT EXISTS invece di NOT IN: files.song_id è nullable e un solo NULL
    // renderebbe il NOT IN sempre falso (delete no-op silenzioso)
    stm = 'delete from user_id3 u where not exists (select 1 from files f where f.song_id = u.song_id)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
    stm = 'delete from user_stats u where not exists (select 1 from files f where f.song_id = u.song_id)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
    stm = 'delete from songs s where not exists (select 1 from files f where f.song_id = s.song_id)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
    // clear empty cover PRIMA degli album: covers.album_id REFERENCES albums
    // senza CASCADE, cancellare prima gli album viola la FK
    stm = 'delete from covers where album_id not in (select album_id from songs)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
    // clear preferiti orfani PRIMA degli album: user_favorites.album_id referenzia
    // albums senza CASCADE, cancellare prima gli album viola la FK logica
    stm = 'delete from user_favorites where album_id not in (select album_id from songs)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
    // clear empty albums
    stm = 'delete from albums where album_id not in (select album_id from songs)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
    // clear empty artists
    stm = 'delete from artists where artist_id not in (select artist_id from albums)';
    pars = [];
    await query('clearEmptyAlbums', stm, pars);
}

module.exports = {
    getCollection,
    getAlbum,
    findAlbum,
    updateAlbumById,
    countAlbums,
    upsertAlbum,
    setReleaseGroup,
    clearEmptyAlbums,
    getCover,
    upsertCover,
}
