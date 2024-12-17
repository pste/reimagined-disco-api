const pg = require('pg');
const { Pool } = pg;
const logger = require('./logger');

const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 20000,
})

async function getSomeData(id) {
    const client = await pool.connect();
    const stm = 'select * from table where id=$1'
    const pars = [id];
    const res = await client.query(stm, pars);
    const rows = res.rows;
    client.release();
    return rows;
}

module.exports = {
    getSomeData
}