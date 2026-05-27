const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

// Atomically claim the oldest pending job, marking it as running.
async function claimNextJob() {
    const client = await pool.connect();
    try {
        const stm = `
            UPDATE jobs SET status='running', started=NOW()
            WHERE job_id = (
                SELECT job_id FROM jobs WHERE status='pending' ORDER BY "when" ASC LIMIT 1
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

module.exports = { claimNextJob, updateJobStatus };
