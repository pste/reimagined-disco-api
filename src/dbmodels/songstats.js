const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function touchPlayed(user_id, song_id) {
    const client = await pool.connect();
    try {
        let stm, pars;
        stm = `insert into user_stats (user_id,song_id,played,playcount) values ($1,$2,current_timestamp,1)
                on conflict(user_id,song_id) do update set played=current_timestamp,playcount=user_stats.playcount+1
                returning *`;
        pars = [user_id, song_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB touchPlayed', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function setStars(user_id, song_id, stars) {
    const client = await pool.connect();
    try {
        let stm, pars;
        stm = 'insert into user_stats(user_id, song_id, stars) VALUES ($1, $2, $3) \
                    on conflict(user_id, song_id) do \
                    update set stars=$3';
        pars = [user_id, song_id, stars];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB setStars', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = {
    touchPlayed,
    setStars,
}
