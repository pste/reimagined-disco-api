const logger = require('./logger');
const db = require('./db');

// Store di @fastify/session su PostgreSQL (tabella sessions): senza, il MemoryStore
// predefinito perdeva tutte le sessioni a ogni riavvio del pod API (tutti sloggati).
// Interfaccia a callback compatibile express-session: get / set / destroy.
// La sessione viaggia come JSON: la libreria la ricostruisce da sola (cookie + user)
// e ne controlla la scadenza; con rolling:true chiama set a ogni richiesta, quindi
// anche `expires` nel DB si rinnova insieme al cookie.

function expiresOf(session) {
    const expires = session?.cookie?.expires;
    if (expires) {
        return new Date(expires);
    }
    return new Date(Date.now() + parseInt(process.env.SESSION_TIMEOUTSECS) * 1000);
}

const sessionStore = {
    get(sid, callback) {
        db.getSession(sid)
            .then((data) => callback(null, data ?? null))
            .catch((err) => {
                logger.error(err, 'sessionStore: get failed');
                callback(err);
            });
    },

    set(sid, session, callback) {
        // solo sessioni di un utente loggato: con rolling la libreria salva anche le sessioni
        // vuote rigenerate per un cookie scaduto o sconosciuto (una riga inutile per richiesta)
        if (!session?.user) {
            callback();
            return;
        }
        db.setSession(sid, JSON.stringify(session), expiresOf(session))
            .then(() => callback())
            .catch((err) => {
                logger.error(err, 'sessionStore: set failed');
                callback(err);
            });
    },

    destroy(sid, callback) {
        db.deleteSession(sid)
            .then(() => callback())
            .catch((err) => {
                logger.error(err, 'sessionStore: destroy failed');
                callback(err);
            });
    },
};

module.exports = sessionStore;
