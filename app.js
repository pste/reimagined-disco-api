const server = require('./src/server');
const filescan = require('./src/filescan');

filescan.scan()
    .then(() => server.run());