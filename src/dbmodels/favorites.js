const { query } = require('./dbquery');

async function setFavorite(user_id, album_id, favorite) {
    let stm, pars;
    if (favorite) {
        stm = 'insert into user_favorites (user_id, album_id) values ($1, $2) \
                on conflict(user_id, album_id) do nothing';
        pars = [user_id, album_id];
    }
    else {
        stm = 'delete from user_favorites where user_id = $1 and album_id = $2';
        pars = [user_id, album_id];
    }
    await query('setFavorite', stm, pars);
}

//
module.exports = {
    setFavorite,
}
