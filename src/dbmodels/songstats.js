const { query } = require('./dbquery');

async function touchPlayed(user_id, song_id) {
    let stm, pars;
    stm = `insert into user_stats (user_id,song_id,played,playcount) values ($1,$2,current_timestamp,1)
            on conflict(user_id,song_id) do update set played=current_timestamp,playcount=user_stats.playcount+1
            returning *`;
    pars = [user_id, song_id];
    const res = await query('touchPlayed', stm, pars);
    return res.rows;
}

module.exports = {
    touchPlayed,
}
