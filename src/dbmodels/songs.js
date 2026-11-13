const { query } = require('./dbquery');

async function getSongs(params) {
    // bitrate (proprietà del file fisico) insieme al brano. Sottoquery e non join:
    // una song può avere più file (copie doppie) e il join la restituirebbe più volte
    const base = 'select s.*, (select max(f.bitrate) from files f where f.song_id = s.song_id) as bitrate from songs s';
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
    const res = await query('getSongs', stm, pars);
    return res.rows;
}

// brano + album + artista + file in una sola query (percorso caldo: streaming, download,
// id3write). Con più file per la stessa song (copie doppie) vale il più vecchio
async function getSongInfo(song_id) {
    const stm = `
        SELECT s.song_id, s.title, s.track_nr, s.disc_nr,
            al.album_id, al.title AS album, al."year", al.genre, ar."name" AS artist,
            so."path" AS source_path, f.file_path, f.file_name, f.modified
        FROM songs s
        INNER JOIN albums al ON al.album_id = s.album_id
        INNER JOIN artists ar ON ar.artist_id = al.artist_id
        INNER JOIN files f ON f.song_id = s.song_id
        INNER JOIN sources so ON so.source_id = f.source_id
        WHERE s.song_id = $1
        ORDER BY f.file_id
        LIMIT 1`;
    const pars = [song_id];
    const res = await query('getSongInfo', stm, pars);
    return res.rows[0];
}

async function upsertSong(title, tracknr, discnr, album_id) {
    const stm = 'insert into songs (title, track_nr, disc_nr, album_id) values ($1,$2,$3,$4) \
                on conflict(title,album_id) do update set title=$1, track_nr=$2, disc_nr=$3, album_id=$4 \
                returning *';
    const pars = [title, tracknr, discnr, album_id];
    const res = await query('upsertSong', stm, pars);
    return res.rows[0];
}

// write-through dell'editor: aggiorna la traccia in place — song_id resta stabile,
// le FK di files/user_stats/user_id3 non si toccano
async function updateSongFields(song_id, title, track_nr, disc_nr) {
    const stm = 'update songs set title=$2, track_nr=$3, disc_nr=$4 where song_id=$1';
    const pars = [song_id, title, track_nr, disc_nr];
    await query('updateSongFields', stm, pars);
}

// titoli presenti in entrambi gli album: violerebbero UNIQUE(title, album_id)
// al moveSongs, quindi bloccano il merge dell'editor (409)
async function getDuplicateTitles(from_album_id, to_album_id) {
    const stm = 'select a.title from songs a \
                join songs b on b.album_id = $2 and b.title = a.title \
                where a.album_id = $1';
    const pars = [from_album_id, to_album_id];
    const res = await query('getDuplicateTitles', stm, pars);
    const rows = res.rows;
    return rows.map(r => r.title);
}

// rename album/artista nell'editor: sposta tutte le tracce sul nuovo album row
async function moveSongs(from_album_id, to_album_id) {
    const stm = 'update songs set album_id=$2 where album_id=$1';
    const pars = [from_album_id, to_album_id];
    await query('moveSongs', stm, pars);
}

async function countSongs() {
    const stm = 'select count(*) from songs';
    const pars = [];
    const res = await query('countSongs', stm, pars);
    return res.rows;
}

module.exports = {
    getSongs,
    getSongInfo,
    upsertSong,
    updateSongFields,
    getDuplicateTitles,
    moveSongs,
    countSongs,
}
