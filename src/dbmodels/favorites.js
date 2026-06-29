const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getFavorites(user_id) {
    const client = await pool.connect();
    try {
        const stm = 'select album_id from user_favorites where user_id = $1';
        const pars = [user_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getFavorites', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function setFavorite(user_id, album_id, favorite) {
    const client = await pool.connect();
    try {
        let stm, pars;
        if (favorite) {
            stm = 'insert into user_favorites (user_id, album_id) values ($1, $2) \
                    on conflict(user_id, album_id) do nothing';
            pars = [user_id, album_id];
        }
        else {
            stm = 'delete from user_favorites where user_id = $1 and album_id = $2';
            pars = [user_id, album_id];
        }
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB setFavorite', err);
        throw err;
    }
    finally {
        client.release();
    }
}

//
module.exports = {
    getFavorites,
    setFavorite,
}
