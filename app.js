const server = require('./src/server');
const filescan = require('./src/filescan');

async function start() {
    await filescan.installJob();
    await server.run();
}

start()