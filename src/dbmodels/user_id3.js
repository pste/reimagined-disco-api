const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function upsertUserTag(song_id, tags) {
    const client = await pool.connect();
    try {
        const stm = `
            INSERT INTO user_id3 (song_id, title, album, artist, "year", genre, track_nr, disc_nr, updated_at, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'pending')
            ON CONFLICT (song_id) DO UPDATE SET
                title=$2, album=$3, artist=$4, "year"=$5, genre=$6,
                track_nr=$7, disc_nr=$8, updated_at=NOW(), status='pending'`;
        const pars = [song_id, tags.title, tags.album, tags.artist, tags.year, tags.genre, tags.track_nr, tags.disc_nr];
        logger.trace(pars, 'DB: upsertUserTag');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB upsertUserTag', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getPendingTags() {
    const client = await pool.connect();
    try {
        // La cover viaggia già qui come base64 (ripetuta per ogni brano dell'album, ok):
        // il pod jobs la usa così com'è, senza riscaricarla. NULL dove non c'è cover.
        // updated_at viaggia come testo (::text) così torna identico nel delete condizionale,
        // senza perdita di precisione/fuso nel round-trip JSON.
        const stm = `SELECT song_id, title, album, artist, "year", genre, track_nr, disc_nr,
                        encode(cover, 'base64') AS cover, updated_at::text AS updated_at
                     FROM user_id3 WHERE status='pending'`;
        logger.trace('DB: getPendingTags');
        const res = await client.query(stm);
        return res.rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getPendingTags', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// Scrive la stessa cover (byte) su tutti i brani dell'album in un colpo solo.
// Crea la riga user_id3 dove manca, aggiorna solo la cover dove esiste (preserva gli altri override).
async function setAlbumCover(album_id, cover) {
    const client = await pool.connect();
    try {
        const stm = `
            INSERT INTO user_id3 (song_id, cover, updated_at, status)
            SELECT song_id, $2, NOW(), 'pending' FROM songs WHERE album_id = $1
            ON CONFLICT (song_id) DO UPDATE SET cover=$2, updated_at=NOW(), status='pending'`;
        const pars = [album_id, cover];
        logger.trace([album_id, '<cover bytes>'], 'DB: setAlbumCover');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB setAlbumCover', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function deleteUserTag(song_id, updated_at) {
    const client = await pool.connect();
    try {
        // Delete condizionale (dal job): se la riga è stata rimodificata mentre il job
        // scriveva il file (updated_at diverso) NON va cancellata — resta pending e il
        // prossimo giro scrive i valori nuovi. Senza updated_at cancella e basta.
        let stm, pars;
        if (updated_at) {
            stm = 'DELETE FROM user_id3 WHERE song_id=$1 AND updated_at=$2';
            pars = [song_id, updated_at];
        }
        else {
            stm = 'DELETE FROM user_id3 WHERE song_id=$1';
            pars = [song_id];
        }
        logger.trace(pars, 'DB: deleteUserTag');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB deleteUserTag', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function setUserTagError(song_id) {
    const client = await pool.connect();
    try {
        const stm = `UPDATE user_id3 SET status='error' WHERE song_id=$1`;
        const pars = [song_id];
        logger.trace(pars, 'DB: setUserTagError');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB setUserTagError', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = { upsertUserTag, getPendingTags, setAlbumCover, deleteUserTag, setUserTagError };
