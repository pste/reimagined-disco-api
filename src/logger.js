const pino = require('pino');
const pretty = require('pino-pretty');
const stream = pretty({
    ignore: 'hostname',
    singleLine: true,
    customPrettifiers: {
        pid: pid => `PID${pid}`
    }
})

const logger = pino({ level: process.env.LOG_LEVEL || 'info'}, stream);
module.exports = logger