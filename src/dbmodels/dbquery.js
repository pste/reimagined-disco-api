const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

// Esegue una query e ritorna il risultato di pg (rows, rowCount). È il punto unico da cui
// passano i model: prende la connessione (quella della transazione in corso, se c'è — vedi
// dbpool), la restituisce sempre e, su errore, scrive una riga "ERROR DB <name>" nella
// tabella logs prima di rilanciare.
// name: nome della funzione del model (per trace e log).
// options.tracePars = false: i parametri non finiscono nei trace (password, sessioni, byte delle cover)
async function query(name, stm, pars = [], options = {}) {
    const client = await pool.connect();
    try {
        if (options.tracePars === false) {
            logger.trace(`DB ${name}: ${stm}`);
        }
        else {
            logger.trace(pars, `DB ${name}: ${stm}`);
        }
        return await client.query(stm, pars);
    }
    catch (err) {
        dblog.createLog(`ERROR DB ${name}`, err); // senza await: createLog non lancia mai
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = { query };
