const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getParameters() {
    const client = await pool.connect();
    try {
        const stm = 'select * from parameters';
        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getParameters', err);
        throw err;
    }
    finally {
        client.release();
    }
}

//
module.exports = {
    getParameters,
}
