const logger = require('../logger');
const pool = require('./dbpool');

// un Error passato così com'è a pg diventerebbe JSON senza message né stack (non sono
// proprietà enumerabili): si salva il testo
function detailsText(details) {
    if (details instanceof Error) {
        return details.stack || details.message;
    }
    return details || '';
}

// Non lancia MAI: i model la chiamano senza await dentro i loro catch, quindi un errore
// qui (es. DB non raggiungibile) sarebbe una promise rifiutata senza gestore, che fa
// terminare il processo Node
async function createLog(msg, details) {
    try {
        // fuori da un'eventuale transazione: il log deve restare anche dopo un rollback
        const client = await pool.connectDirect();
        try {
            const stm = 'insert into logs(message,details) values ($1,$2)';
            const pars = [msg, detailsText(details)];
            logger.trace(pars, `DB: ${stm}`);
            await client.query(stm, pars);
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        logger.error(err, `createLog failed [${msg}]`);
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

// cancella i log più vecchi di `months` mesi; ritorna quante righe ha cancellato
async function purgeOldLogs(months) {
    const client = await pool.connectDirect();
    try {
        const stm = 'delete from logs where created < now() - make_interval(months => $1)';
        const pars = [months];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        return res.rowCount;
    }
    finally {
        client.release();
    }
}

module.exports = {
    createLog,
    createLogs,
    purgeOldLogs,
}
