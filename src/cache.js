const { LRUCache } = require('lru-cache');
const MIN = 60 * 1000; // reading code helper

// dati del file di un brano (percorso, dimensione, metadata audio) per /chunk/song:
// evitano una query e un parse del file a ogni chunk. I byte NON stanno in cache:
// ogni chunk si legge dal disco all'offset giusto (vedi streamer.readChunk)
const cache = new LRUCache({
    max: 1000,
    ttl: 5 * MIN,
});

//
module.exports = {
    getSongFile: (songid) => cache.get(`song:${songid}`),
    storeSongFile: (songid, info) => cache.set(`song:${songid}`, info),
}
