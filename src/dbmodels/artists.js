const { query } = require('./dbquery');

async function upsertArtist(artist) {
    const stm = 'insert into artists ("name") values ($1) \
                on conflict("name") do update set "name"=$1 \
                returning *';
    const pars = [artist];
    const res = await query('upsertArtist', stm, pars);
    return res.rows[0];
}

async function countArtists() {
    const stm = 'select count(*) from artists';
    const pars = [];
    const res = await query('countArtists', stm, pars);
    return res.rows;
}

module.exports = {
    upsertArtist,
    countArtists
}
