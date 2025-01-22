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

fastify.get('/search/artists', async function(req, reply) {
    const name = req.query.name;
    const data = await db.getArtists(name);
    reply.send(data);
})

fastify.get('/search/albums', async function(req, reply) {
    const title = req.query.title;
    const data = await db.getAlbums(title);
    reply.send(data);
})

fastify.get('/search/song', async function(req, reply) {
    const id = req.query.id;
    const data = await db.getSongInfo(id);
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