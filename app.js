const server = require('./src/server');
const filescan = require('./src/filescan');

async function start() {
    await filescan.fastscan();
    //await filescan.fullscan();
    await server.run();
}

start()