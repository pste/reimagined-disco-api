const { query } = require('./dbquery');

async function getUser(user, pwdhash) {
    const stm = 'select * from users where username = $1 and password = $2';
    const pars = [user, pwdhash];
    const res = await query('getUser', stm, pars, { tracePars: false });
    const rows = res.rows;
    if (rows.length === 1) {
        return rows[0];
    }
    return undefined;
}

async function savePassword(userid, pwdhash) {
    const stm = 'update users set password = $1 where user_id = $2';
    const pars = [pwdhash, userid];
    const res = await query('savePassword', stm, pars, { tracePars: false });
    return res.rows;
}

//
module.exports = {
    getUser,
    savePassword,
}
