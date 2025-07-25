const logger = require('../logger');
const pool = require('./dbpool');

async function getFiles() {
    const client = await pool.connect();
    const stm = 'select so."path" as basedir,fi.* from files fi inner join sources so on fi.source_id=so.source_id';
    const pars = [];
    logger.trace(pars, `DB: ${stm}`);
    const res = await client.query(stm, pars);
    const rows = res.rows;
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows;
}

async function upsertFile(song_id, basedir, file_path, file_name, modified) {
    let stm, pars, res;
    const client = await pool.connect();
    //
    stm = 'insert into sources ("path") values ($1) on conflict("path") do update set "path"=$1 returning *' // trick to return the row always (can be better? TODO)
    pars = [basedir];
    logger.trace(pars, `DB: ${stm}`);
    res = await client.query(stm, pars);
    const sources = res.rows[0]
    //
    stm = 'insert into files (source_id, song_id, file_path, file_name, modified) values ($1,$2,$3,$4,$5) \
                on conflict(source_id, file_path, file_name) do update set song_id=$2, modified=$5 \
                returning *';
    pars = [sources.source_id, song_id, file_path, file_name, modified];
    logger.trace(pars, `DB: ${stm}`);
    res = await client.query(stm, pars);
    const rows = res.rows;
    //
    logger.trace(`DB ==> ${rows.length}`)
    client.release();
    return rows[0];
}

async function removeFile(song_id) {
    let stm, pars;
    // delete file
    const client = await pool.connect();
    stm = 'delete from files where song_id=$1';
    pars = [song_id];
    logger.trace(pars, `DB: ${stm}`);
    await client.query(stm, pars);
    // delete song
    stm = 'delete from songs where song_id=$1';
    pars = [song_id];
    logger.trace(pars, `DB: ${stm}`);
    await client.query(stm, pars);
    //
    client.release();
    return;
}

module.exports = {
    getFiles,
    upsertFile,
    removeFile,
}
