const { query } = require('./dbquery');

// sessioni web persistenti (store di @fastify/session, vedi sessionStore.js).
// Nei trace niente contenuto della sessione: sid e dati utente non vanno nei log

async function getSession(sid) {
    const stm = 'select data from sessions where sid = $1';
    const pars = [sid];
    const res = await query('getSession', stm, pars, { tracePars: false });
    return res.rows[0]?.data;
}

async function setSession(sid, data, expires) {
    const stm = 'insert into sessions (sid, data, expires) values ($1, $2, $3) \
                on conflict(sid) do update set data=$2, expires=$3';
    const pars = [sid, data, expires];
    await query('setSession', stm, pars, { tracePars: false });
}

async function deleteSession(sid) {
    const stm = 'delete from sessions where sid = $1';
    const pars = [sid];
    await query('deleteSession', stm, pars, { tracePars: false });
}

// pulizia: le righe scadute sono comunque innocue (@fastify/session rifiuta le sessioni
// scadute), questo serve solo a non farle accumulare
async function deleteExpiredSessions() {
    const stm = 'delete from sessions where expires < now()';
    const res = await query('deleteExpiredSessions', stm);
    return res.rowCount;
}

module.exports = {
    getSession,
    setSession,
    deleteSession,
    deleteExpiredSessions,
}
