const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getUser(user, pwdhash) {
    const client = await pool.connect();
    try {
        const stm = 'select * from users where username = $1 and password = $2';
        const pars = [user, pwdhash];
        logger.trace(`DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        if (rows.length === 1) {
            return rows[0];
        }
        return undefined;
    }
    catch(err) {
        dblog.createLog('ERROR DB getUser', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function savePassword(userid, pwdhash) {
    const client = await pool.connect();
    try {
        const stm = 'update users set password = $1 where user_id = $2';
        const pars = [pwdhash, userid];
        logger.trace(`DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB savePassword', err);
        throw err;
    }
    finally {
        client.release();
    }
}

//
module.exports = {
    getUser,
    savePassword,
}
