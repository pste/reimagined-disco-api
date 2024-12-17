const logger = require('./logger');
const db = require('./db');

// =============== FASTIFY =============== //

const fastifyOptions = {
    loggerInstance: logger,
    disableRequestLogging: ( process.env.DISABLE_REQUEST_LOGGING ) ? true : false,
    requestTimeout: 10 * 1000 // 10 secs
}

const fastify = require('fastify')( fastifyOptions );

if (process.env.DEVSERVER) {
    logger.info('DEV SERVER MODE ON');
}
else {
    const bearerAuthPlugin = require('@fastify/bearer-auth');
    const keys = new Set([process.env.BEARER_TOKEN]);
    fastify.register(bearerAuthPlugin, {keys});
}

// =============== ROUTES =============== //

fastify.get('/', function(req, reply) {
    reply.send({ app: true });
})

fastify.get('/some', function(req, reply) {
    const someid = req.query.id;
    const data = db.getSomeData(someid);
    reply.send(data);
})


module.exports.run = () => {
    fastify.listen( { port: process.env.PORT, host: '0.0.0.0' }, function(err) {
        if (err) {
            logger.error(err);
            process.exit(1);
        }
        logger.info('Server up ...')
    } )
}