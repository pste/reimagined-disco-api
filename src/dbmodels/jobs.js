const { query } = require('./dbquery');

async function deleteJob(job_id) {
    const stm = 'DELETE FROM jobs WHERE job_id=$1';
    const pars = [job_id];
    await query('deleteJob', stm, pars);
}

async function getJobs() {
    // il report (anche qualche MB) non viaggia nella lista: solo il flag has_report,
    // il testo si scarica a parte con getJobReport
    const stm = `
        SELECT job_id, name, "when", status, started, ended, result,
            (report IS NOT NULL) AS has_report
        FROM jobs ORDER BY "when" DESC`;
    const res = await query('getJobs', stm);
    return res.rows;
}

// Atomically claim the oldest pending job, marking it as running.
// FOR UPDATE SKIP LOCKED + status='pending' anche nella UPDATE esterna: senza, due claim
// concorrenti potevano scegliere lo stesso job_id e reclamarlo entrambi (la UPDATE in attesa
// ricontrolla solo la WHERE esterna, che era il solo job_id)
async function claimNextJob() {
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
    const res = await query('claimNextJob', stm);
    return res.rows[0] || null;
}

// Job rimasti 'running' da più di maxHours: il pod che li eseguiva è morto (OOM, nodo, kill)
// senza chiuderli. Senza questo, il nome resterebbe bloccato per sempre (claimNextJob esclude
// i nomi con un job running). Li chiude in error e li restituisce per il re-accodamento.
async function reapStaleJobs(maxHours) {
    const stm = `
        UPDATE jobs SET status='error', ended=NOW(), result='timeout: job rimasto running (pod terminato?)'
        WHERE status='running'
        AND started < NOW() - make_interval(hours => $1)
        RETURNING *`;
    const pars = [maxHours];
    const res = await query('reapStaleJobs', stm, pars);
    return res.rows;
}

// Pulizia dello storico: cancella i job 'done' finiti da più di `months` mesi.
// I job in 'error' restano finché non li rimuove l'utente dalla pagina Jobs;
// pending e running non si toccano mai
async function purgeOldJobs(months) {
    const stm = `
        DELETE FROM jobs
        WHERE status='done'
        AND COALESCE(ended, "when") < NOW() - make_interval(months => $1)`;
    const pars = [months];
    const res = await query('purgeOldJobs', stm, pars);
    return res.rowCount;
}

async function updateJobStatus(job_id, status, result) {
    const stm = 'UPDATE jobs SET status=$2, ended=NOW(), result=$3 WHERE job_id=$1';
    const pars = [job_id, status, result || null];
    await query('updateJobStatus', stm, pars);
}

async function upsertPendingJob(name, when) {
    const stm = `
        INSERT INTO jobs (name, "when", status)
        VALUES ($1, $2, 'pending')
        ON CONFLICT (name) WHERE status = 'pending'
        DO UPDATE SET "when" = EXCLUDED."when"
        RETURNING *`;
    const pars = [name, when];
    const res = await query('upsertPendingJob', stm, pars);
    return res.rows[0];
}

// report testuale del job (es. libcheck): sostituisce quello precedente
async function setJobReport(job_id, report) {
    const stm = 'UPDATE jobs SET report=$2 WHERE job_id=$1';
    const pars = [job_id, report];
    const res = await query('setJobReport', stm, pars, { tracePars: false });
    return res.rowCount;
}

// riga { name, report } o null se il job non esiste
async function getJobReport(job_id) {
    const stm = 'SELECT name, report FROM jobs WHERE job_id=$1';
    const pars = [job_id];
    const res = await query('getJobReport', stm, pars);
    return res.rows[0] || null;
}

module.exports = { deleteJob, getJobs, setJobReport, getJobReport, claimNextJob, reapStaleJobs, purgeOldJobs, updateJobStatus, upsertPendingJob };
