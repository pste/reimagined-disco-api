const logger = require('../logger');
const pool = require('./dbpool');

async function createLog(msg, details) {
    // fuori da un'eventuale transazione: il log deve restare anche dopo un rollback
    const client = await pool.connectDirect();
    try {
        const stm = 'insert into logs(message,details) values ($1,$2)';
        const pars = [msg, details || ''];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    finally {
        client.release();
    }
}

module.exports = {
    createLog,
}
