const logger = require('./src/logger');
const server = require('./src/server');
const filescan = require('./src/filescan');

async function start() {
    await server.run();
    await filescan.installJob();
    // run on boot
    if (process.env.BOOTSCAN === "yes") {
        await filescan.fastscan();
    }
    else {
        logger.info("*** DEVSERVER MODE ON *** (no scan on boot)")
    }
}

start()