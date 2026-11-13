const { query } = require('./dbquery');

async function getSources() {
    let stm, pars;
    stm = 'select * from sources';
    pars = [];
    const res = await query('getSources', stm, pars);
    return res.rows;
}

module.exports = {
    getSources
}
