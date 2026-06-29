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

async function saveParameters(cronRequeue, cacheTTLDays, favCacheTTLDays) {
    const client = await pool.connect();
    try {
        const stm = 'update parameters set "cronRequeue"=$1, "cacheTTLDays"=$2, "favCacheTTLDays"=$3 where param_id=1';
        const pars = [cronRequeue, cacheTTLDays, favCacheTTLDays];
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
