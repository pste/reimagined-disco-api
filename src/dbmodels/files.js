const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getFiles() {
    const client = await pool.connect();
    try {
        const stm = 'select so."path" as basedir,fi.* from files fi inner join sources so on fi.source_id=so.source_id';
        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getFiles', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// libcheck: per ogni file i dati del DB da confrontare con gli ID3 su disco, più lo stato
// della riga user_id3 (pending = modifica da UI non ancora scritta nel file, error = scrittura
// fallita). LEFT JOIN: files.song_id è nullable
async function getFilesWithTags() {
    const client = await pool.connect();
    try {
        const stm = `
            SELECT so."path" AS basedir, fi.file_path, fi.file_name,
                s.title, s.track_nr, s.disc_nr,
                al.title AS album, al."year", al.genre, ar."name" AS artist,
                u.status AS id3_status
            FROM files fi
            INNER JOIN sources so ON fi.source_id = so.source_id
            LEFT JOIN songs s ON s.song_id = fi.song_id
            LEFT JOIN albums al ON al.album_id = s.album_id
            LEFT JOIN artists ar ON ar.artist_id = al.artist_id
            LEFT JOIN user_id3 u ON u.song_id = s.song_id`;
        logger.trace('DB: getFilesWithTags');
        const res = await client.query(stm);
        return res.rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getFilesWithTags', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function upsertFile(song_id, basedir, file_path, file_name, modified, bitrate) {
    const client = await pool.connect();
    try {
        let stm, pars, res;
        //
        stm = 'insert into sources ("path") values ($1) on conflict("path") do update set "path"=$1 returning *' // trick to return the row always (can be better? TODO)
        pars = [basedir];
        logger.trace(pars, `DB: ${stm}`);
        res = await client.query(stm, pars);
        const sources = res.rows[0]
        //
        // created: un file nuovo di una song che ha già un file (spostato/rinominato: la
        // riga vecchia viene rimossa dopo, nello stesso scan) eredita la data di aggiunta
        // più vecchia, così lo spostamento non fa risalire l'album tra gli "aggiunti".
        // In caso di conflitto (stesso percorso) created non si tocca.
        stm = 'insert into files (source_id, song_id, file_path, file_name, modified, bitrate, created) \
                    values ($1,$2,$3,$4,$5,$6, coalesce((select min(created) from files where song_id=$2), now())) \
                    on conflict(source_id, file_path, file_name) do update set song_id=$2, modified=$5, bitrate=$6 \
                    returning *';
        pars = [sources.source_id, song_id, file_path, file_name, modified, bitrate ?? null];
        logger.trace(pars, `DB: ${stm}`);
        res = await client.query(stm, pars);
        const rows = res.rows;
        //
        logger.trace(`DB ==> ${rows.length}`)
        return rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB upsertFile', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// Cancella SOLO la riga files. Prima si cancellava per song_id insieme a stats,
// user_id3 e song: ma più file possono avere lo stesso song_id (file spostato/rinominato,
// la cui riga nuova riconverge sulla stessa song per (title, album_id); copie doppie),
// e il delete portava via anche quelli ancora presenti su disco. Le song rimaste senza
// file (con user_id3/user_stats) le cancella clearEmptyAlbums, a fine scan.
async function removeFile(file_id) {
    const client = await pool.connect();
    try {
        const stm = 'delete from files where file_id=$1';
        const pars = [file_id];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB removeFile', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = {
    getFilesWithTags,
    getFiles,
    upsertFile,
    removeFile,
}
