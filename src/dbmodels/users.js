const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getUser(user, pwdhash) {
   try {
        const client = await pool.connect();
        const stm = 'select * from users where username = $1 and password = $2';
        const pars = [user, pwdhash];
        logger.trace(`DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        client.release();
        if (rows.length === 1) {
            return rows[0];
        }
        return undefined;
    }
    catch(err) {
        dblog.createLog('ERROR DB getUser', err);
        throw err;
    }
}

//
async function savePassword(userid, pwdhash) {
    try {
        const client = await pool.connect();
        const stm = 'update users set password = $1 where user_id = $2';
        const pars = [pwdhash, userid];
        logger.trace(`DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        client.release();
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB savePassword', err);
        throw err;
    }
}

//
module.exports = {
    getUser,
    savePassword,
}