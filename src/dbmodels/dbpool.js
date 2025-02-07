const pg = require('pg');
const { Pool } = pg;

const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 20000,
})

module.exports = pool;