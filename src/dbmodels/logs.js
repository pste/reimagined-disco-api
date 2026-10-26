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

// più righe con una sola INSERT (es. un blocco di eventi inviati dalla UI).
// rows = [{ message, details }]
async function createLogs(rows) {
    const client = await pool.connectDirect();
    try {
        const values = [];
        const pars = [];
        rows.forEach((row, i) => {
            values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
            pars.push(row.message, row.details || '');
        });
        const stm = `insert into logs(message,details) values ${values.join(',')}`;
        logger.trace(`DB: ${stm} [${rows.length} rows]`);
        await client.query(stm, pars);
    }
    finally {
        client.release();
    }
}

module.exports = {
    createLog,
    createLogs,
}
