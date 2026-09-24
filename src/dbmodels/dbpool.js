const pg = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = pg;

const config = {
    max: 20,
    idleTimeoutMillis: 20000,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
}
const pool = new Pool(config)

// Transazioni IMPLICITE: dentro transaction(fn) ogni connect() dei model restituisce la
// connessione della transazione (con release() che non fa nulla), quindi i model non
// cambiano: `const client = await pool.connect(); ... client.release()` resta com'è.
// Fuori da transaction() connect() è il normale connect del pool.
const txStorage = new AsyncLocalStorage();

async function connect() {
    const txClient = txStorage.getStore();
    if (txClient) {
        return txClient;
    }
    return pool.connect();
}

// Connessione SEMPRE fuori dalla transazione: la usano i log (dblog.createLog), che
// devono sopravvivere al rollback e che i model chiamano senza await (fire-and-forget:
// potrebbero girare dopo il COMMIT, su un client già restituito al pool)
async function connectDirect() {
    return pool.connect();
}

// Esegue fn in una transazione: COMMIT se fn va a buon fine, ROLLBACK se lancia
// (l'errore viene rilanciato). Una transaction() dentro un'altra si unisce a quella esterna.
async function transaction(fn) {
    if (txStorage.getStore()) {
        return fn();
    }
    const client = await pool.connect();
    const txClient = {
        query: (...args) => client.query(...args),
        release: () => {}, // la connessione la restituisce transaction(), non i model
    };
    try {
        await client.query('BEGIN');
        const result = await txStorage.run(txClient, fn);
        await client.query('COMMIT');
        return result;
    }
    catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = {
    connect,
    connectDirect,
    transaction,
};
