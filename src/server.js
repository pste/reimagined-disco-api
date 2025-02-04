const logger = require('./logger');
const db = require('./db');

// =============== FASTIFY =============== //

const fastifyOptions = {
    loggerInstance: logger,
    disableRequestLogging: ( process.env.DISABLE_REQUEST_LOGGING ) ? true : false,
    requestTimeout: 10 * 1000 // 10 secs
}

const fastify = require('fastify')( fastifyOptions );
const cors = require('@fastify/cors');

if (process.env.DEVSERVER) {
    logger.info('DEV SERVER MODE ON');
    fastify.register(cors, {
        origin: "*"
    });
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
    const name = req?.query?.name || '';
    const data = await db.getArtists(name);
    await reply.send(data);
})

fastify.get('/search/albums', async function(req, reply) {
    const title = req?.query?.title || '';
    const artistid = req?.query?.artistid;
    // get a list of albums
    let albums = [];
    if (artistid) {
        albums = await db.getAlbumsByArtist(artistid);
    }
    else { //default to this
        albums = await db.getAlbumsByTitle(title);
    }
    // normalize output
    const data = await Promise.all(
        albums.map( async (album) => {
            return await db.getAlbumInfo(album.album_id);
        })
    );
    await reply.send(data);
})

fastify.get('/search/songs', async function(req, reply) {
    const title = req?.query?.title || '';
    const data = await db.getSongs(title);
    await reply.send(data);
})

fastify.get('/search/song', async function(req, reply) {
    const id = req.query.id;
    const data = await db.getSongInfo(id);
    await reply.send(data);
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