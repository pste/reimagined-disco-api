const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function touchPlayed(user_id, song_id) {
    try {
        const client = await pool.connect();
        let stm, pars;
        stm = `insert into user_stats (user_id,song_id,played,playcount) values ($1,$2,current_timestamp,1)
                on conflict(user_id,song_id) do update set played=current_timestamp,playcount=user_stats.playcount+1
                returning *`;
        pars = [user_id, song_id];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        client.release();
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB touchPlayed', err);
        throw err;
    }
}

async function setStars(user_id, song_id, stars) {
    try {
        const client = await pool.connect();
        let stm, pars;
        stm = 'insert into user_stats(user_id, song_id, stars) VALUES $1, $2, $3 \
                    on conflict(user_id, song_id) do \
                    update set stars=$3';
        pars = [user_id, song_id, stars];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        client.release();
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB setStars', err);
        throw err;
    }
}

module.exports = {
    touchPlayed,
    setStars,
}