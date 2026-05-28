const logger = require('../logger');
const dblog = require('./logs');
const pool = require('./dbpool');

async function getParameters() {
    const client = await pool.connect();
    try {
        const stm = 'select * from parameters';
        const pars = [];
        logger.trace(pars, `DB: ${stm}`);
        const res = await client.query(stm, pars);
        const rows = res.rows;
        logger.trace(`DB ==> ${rows.length}`)
        return rows;
    }
    catch(err) {
        dblog.createLog('ERROR DB getParameters', err);
        throw err;
    }
    finally {
        client.release();
    }
}

async function saveParameters(cronScan, cronRequeue) {
    const client = await pool.connect();
    try {
        const stm = 'update parameters set "cronScan"=$1, "cronRequeue"=$2 where param_id=1';
        const pars = [cronScan, cronRequeue];
        logger.trace(pars, `DB: ${stm}`);
        await client.query(stm, pars);
    }
    catch(err) {
        dblog.createLog('ERROR DB saveParameters', err);
        throw err;
    }
    finally {
        client.release();
    }
}

//
module.exports = {
    getParameters,
    saveParameters,
}
