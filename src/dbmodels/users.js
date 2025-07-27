const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getUser(user, pwd) {
   try {
        const client = await pool.connect();
        const stm = 'select * from users where username = $1 and password = $2';
        const pars = [user, pwd];
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

module.exports = {
    getUser
}