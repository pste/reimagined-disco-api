const logger = require('../logger');
const pool = require('./dbpool');

async function getSources() {
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

module.exports = {
    getSources
}