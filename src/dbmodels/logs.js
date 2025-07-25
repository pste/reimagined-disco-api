const logger = require('../logger');
const pool = require('./dbpool');

async function createLog(msg, details) {
    //
    let stm, pars;
    // create log
    const client = await pool.connect();
    stm = 'insert into logs() values ($1,$2)';
    pars = [msg, details || ''];
    logger.trace(pars, `DB: ${stm}`);
    await client.query(stm, pars);
    //
    client.release();
    return;
}

module.exports = {
    createLog,
}
