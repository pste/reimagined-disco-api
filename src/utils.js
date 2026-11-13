const logger = require("./logger");

// val can be: "01", "3/12" (TRCK n/total), "2001-05-12" (date as year), undefined
// parseInt reads the leading number only
function parseNumber(val) {
    const rtn = parseInt(String(val), 10);
    if (isNaN(rtn)) {
        return null;
    }
    return rtn;
}

function maxDate(a, b) {
    if (!a) throw new Error('Invalid 1st Date Parameter');
    if (!b) throw new Error('Invalid 2nd Date Parameter');
    const aNum = new Date(a).getTime();
    const bNum = new Date(b).getTime();
    logger.trace(`maxDate ${a} (${aNum}) ${b} (${bNum})`);
    if (aNum > bNum) return a;
    return b;
}

module.exports = {
    parseNumber,
    maxDate,
}