const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

// sessioni web persistenti (store di @fastify/session, vedi sessionStore.js).
// Nei trace niente contenuto della sessione: sid e dati utente non vanno nei log

async function getSession(sid) {
    const client = await pool.connect();
    try {
        const stm = 'select data from sessions where sid = $1';
        const pars = [sid];
        logger.trace('DB: getSession');
        const res = await client.query(stm, pars);
        return res.rows[0]?.data;
    }
    catch(err) {
        dblog.createLog('ERROR DB getSession', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function setSession(sid, data, expires) {
    const client = await pool.connect();
    try {
        const stm = 'insert into sessions (sid, data, expires) values ($1, $2, $3) \
                    on conflict(sid) do update set data=$2, expires=$3';
        const pars = [sid, data, expires];
        logger.trace('DB: setSession');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB setSession', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function deleteSession(sid) {
    const client = await pool.connect();
    try {
        const stm = 'delete from sessions where sid = $1';
        const pars = [sid];
        logger.trace('DB: deleteSession');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB deleteSession', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// pulizia: le righe scadute sono comunque innocue (@fastify/session rifiuta le sessioni
// scadute), questo serve solo a non farle accumulare
async function deleteExpiredSessions() {
    const client = await pool.connect();
    try {
        const stm = 'delete from sessions where expires < now()';
        logger.trace(`DB: ${stm}`);
        const res = await client.query(stm);
        return res.rowCount;
    }
    catch(err) {
        dblog.createLog('ERROR DB deleteExpiredSessions', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = {
    getSession,
    setSession,
    deleteSession,
    deleteExpiredSessions,
}
