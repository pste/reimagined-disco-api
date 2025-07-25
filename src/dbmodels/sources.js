const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getSources() {
    try {
        const client = await pool.connect();
        let stm, pars;
        stm = 'select * from sources';
        pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        client.release();
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getSources', err);
    }
}

module.exports = {
    getSources
}