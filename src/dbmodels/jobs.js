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

async function createJob(name, when) {
    const client = await pool.connect();
    try {
        const stm = 'INSERT INTO jobs (name, "when", status) VALUES ($1, $2, \'pending\') RETURNING *';
        const pars = [name, when];
        logger.trace(pars, 'DB: createJob');
        const res = await client.query(stm, pars);
        return res.rows[0];
    }
    catch(err) {
        dblog.createLog('ERROR DB createJob', err);
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
async function claimNextJob() {
    const client = await pool.connect();
    try {
        const stm = `
            UPDATE jobs SET status='running', started=NOW()
            WHERE job_id = (
                SELECT job_id FROM jobs
                WHERE status='pending'
                AND name NOT IN (SELECT name FROM jobs WHERE status='running')
                ORDER BY "when" ASC
                LIMIT 1
            )
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

module.exports = { deleteJob, createJob, getJobs, claimNextJob, updateJobStatus };
