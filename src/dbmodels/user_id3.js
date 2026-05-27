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
        const stm = `SELECT song_id, title, album, artist, "year", genre, track_nr, disc_nr FROM user_id3 WHERE status='pending'`;
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

async function deleteUserTag(song_id) {
    const client = await pool.connect();
    try {
        const stm = 'DELETE FROM user_id3 WHERE song_id=$1';
        const pars = [song_id];
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

module.exports = { upsertUserTag, getPendingTags, deleteUserTag, setUserTagError };
