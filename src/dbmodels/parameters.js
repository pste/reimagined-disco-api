const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getParameters() {
    try {
        const client = await pool.connect();
        const stm = 'select * from parameters';
        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        client.release();
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getParameters', err);
    }
}

//
module.exports = {
    getParameters,
}
