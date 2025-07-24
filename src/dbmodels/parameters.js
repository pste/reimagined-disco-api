const logger = require('../logger');
const pool = require('./dbpool');

async function getParameters() {
    const client = await pool.connect();
    const stm = 'select * from parameters';
    const pars = [];
    logger.trace(pars, stm);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(` ==> ${rows.length}`)
    client.release();
    return rows;
}

module.exports = {
    getParameters,
}
