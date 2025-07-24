const server = require('./src/server');
const filescan = require('./src/filescan');

async function start() {
    await server.run();
    await filescan.installJob();
    // run on boot
    filescan.fastscan();
}

start()