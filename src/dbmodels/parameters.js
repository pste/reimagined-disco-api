const { query } = require('./dbquery');

async function getParameters() {
    const stm = 'select * from parameters';
    const pars = [];
    const res = await query('getParameters', stm, pars);
    return res.rows;
}

async function saveParameters(cronRequeue, cacheTTLDays, favCacheTTLDays) {
    const stm = 'update parameters set "cronRequeue"=$1, "cacheTTLDays"=$2, "favCacheTTLDays"=$3 where param_id=1';
    const pars = [cronRequeue, cacheTTLDays, favCacheTTLDays];
    await query('saveParameters', stm, pars);
}

//
module.exports = {
    getParameters,
    saveParameters,
}
