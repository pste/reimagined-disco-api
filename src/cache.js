const { LRUCache } = require('lru-cache');
const MB = 1024 * 1024; // reading code helper
const MIN = 60 * 1000; // reading code helper

const cache = new LRUCache({
    maxSize: 500 * MB,
    sizeCalculation: (value) => value.length, // using Buffer.length property
    ttl: 5 * MIN,
});

//
module.exports = {
    get: (key) => cache.get(key),
    set: (key, value) => cache.set(key, value),
    has: (key) => cache.has(key),
    storeChunks: async (songid, buffer) => {
        // buffer is an array of chunks
        let idx = 0;
        for await (const chunk of buffer) {
            const key = `${songid}:${++idx}`
            cache.set(key, chunk);
        }
    }
}  