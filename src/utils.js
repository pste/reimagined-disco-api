
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

module.exports = {
    parseAlbumNumber,
    parseNumber
}