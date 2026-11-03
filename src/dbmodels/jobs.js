const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function deleteJob(job_id) {
    const client = await pool.connect();
    try {
        const stm = 'DELETE FROM jobs WHERE job_id=$1';
        const pars = [job_id];
        logger.trace(pars, 'DB: deleteJob');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB deleteJob', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function getJobs() {
    const client = await pool.connect();
    try {
        const stm = 'SELECT * FROM jobs ORDER BY "when" DESC';
        logger.trace('DB: getJobs');
        const res = await client.query(stm);
        return res.rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getJobs', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// Atomically claim the oldest pending job, marking it as running.
// FOR UPDATE SKIP LOCKED + status='pending' anche nella UPDATE esterna: senza, due claim
// concorrenti potevano scegliere lo stesso job_id e reclamarlo entrambi (la UPDATE in attesa
// ricontrolla solo la WHERE esterna, che era il solo job_id)
async function claimNextJob() {
    const client = await pool.connect();
    try {
        const stm = `
            UPDATE jobs SET status='running', started=NOW()
            WHERE job_id = (
                SELECT job_id FROM jobs
                WHERE status='pending'
                AND "when" <= NOW()
                AND name NOT IN (SELECT name FROM jobs WHERE status='running')
                ORDER BY "when" ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            AND status='pending'
            RETURNING *`;
        logger.trace('DB: claimNextJob');
        const res = await client.query(stm);
        return res.rows[0] || null;
    }
    catch(err) {
        dblog.createLog('ERROR DB claimNextJob', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// Job rimasti 'running' da più di maxHours: il pod che li eseguiva è morto (OOM, nodo, kill)
// senza chiuderli. Senza questo, il nome resterebbe bloccato per sempre (claimNextJob esclude
// i nomi con un job running). Li chiude in error e li restituisce per il re-accodamento.
async function reapStaleJobs(maxHours) {
    const client = await pool.connect();
    try {
        const stm = `
            UPDATE jobs SET status='error', ended=NOW(), result='timeout: job rimasto running (pod terminato?)'
            WHERE status='running'
            AND started < NOW() - make_interval(hours => $1)
            RETURNING *`;
        const pars = [maxHours];
        logger.trace(pars, 'DB: reapStaleJobs');
        const res = await client.query(stm, pars);
        return res.rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB reapStaleJobs', err);
        throw err;
    }
    finally {
        client.release();
    }
}

// Pulizia dello storico: cancella i job 'done' finiti da più di `months` mesi.
// I job in 'error' restano finché non li rimuove l'utente dalla pagina Jobs;
// pending e running non si toccano mai
async function purgeOldJobs(months) {
    const client = await pool.connect();
    try {
        const stm = `
            DELETE FROM jobs
            WHERE status='done'
            AND COALESCE(ended, "when") < NOW() - make_interval(months => $1)`;
        const pars = [months];
        logger.trace(pars, 'DB: purgeOldJobs');
        const res = await client.query(stm, pars);
        return res.rowCount;
    }
    catch(err) {
        dblog.createLog('ERROR DB purgeOldJobs', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function updateJobStatus(job_id, status, result) {
    const client = await pool.connect();
    try {
        const stm = 'UPDATE jobs SET status=$2, ended=NOW(), result=$3 WHERE job_id=$1';
        const pars = [job_id, status, result || null];
        logger.trace(pars, 'DB: updateJobStatus');
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB updateJobStatus', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function upsertPendingJob(name, when) {
    const client = await pool.connect();
    try {
        const stm = `
            INSERT INTO jobs (name, "when", status)
            VALUES ($1, $2, 'pending')
            ON CONFLICT (name) WHERE status = 'pending'
            DO UPDATE SET "when" = EXCLUDED."when"
            RETURNING *`;
        const pars = [name, when];
        logger.trace(pars, `DB: upsertPendingJob`);
        const res = await client.query(stm, pars);
        return res.rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB upsertPendingJob', err);
        throw err;
    }
    finally {
        client.release();
    }
}

module.exports = { deleteJob, getJobs, claimNextJob, reapStaleJobs, purgeOldJobs, updateJobStatus, upsertPendingJob };
