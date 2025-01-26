const logger = require("./logger");

// val can be: "1/2", undefined, 
function parseAlbumNumber(val) {
    const partOfSet = val || '1';
    const diskNr = partOfSet.split('/');
    if (diskNr.length > 0) return diskNr[0];
    else return "1";
}

function parseNumber(val) {
    const rtn = Number(val)
    if (isNaN(rtn)) return null
    return rtn
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
    parseAlbumNumber,
    parseNumber,
    maxDate,
}