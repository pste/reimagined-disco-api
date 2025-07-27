const logger = require('./logger');
const db = require('./db');
const streamer = require('./streamer');
const fastifyRange = require('fastify-range'); // needed to stream data

const cookie = require('@fastify/cookie');
const session = require('@fastify/session');
const formbody = require('@fastify/formbody');

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
    // cors
    fastify.register(cors, {
        credentials: true,
        origin: [
            "http://127.0.0.1:3000", 
            "http://localhost:3000", 
            "http://music.saba.net"
        ]
    });

    // per i form POST
    fastify.register(formbody);

    // plugin cookie
    fastify.register(cookie);

    // plugin per sessione
    fastify.register(session, {
        secret: process.env.SESSION_SECRET,
        cookie: {
            secure: false, // true solo in HTTPS
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 3600 * 8 // 8 ore
        }
    });

    // token - dismissed ?
    //const bearerAuthPlugin = require('@fastify/bearer-auth');
    //const keys = new Set([process.env.BEARER_TOKEN]);
    //fastify.register(bearerAuthPlugin, {keys});
}

fastify.register(fastifyRange, { throwOnInvalid: true });

// =============== ROUTES =============== //

fastify.get('/', function(req, reply) {
    reply.send({ api: "Online" });
})

fastify.post('/login', async function(req, reply) {
    const { username, password } = req.body;
    const user = await db.getUser(username, password);
    if (user) {
        req.session.user = { username: user.username };
        return { message: 'Login Successful!' };
    }
    reply.code(401).send({ error: 'Invalid credentials' });
})

fastify.post('/logout', async (req, reply) => {
  req.destroySession((err) => {
    if (err) return reply.code(500).send({ error: 'Logout failed' });
    reply.send({ message: 'Logout OK' });
  });
});

/*
fastify.get('/search/artists', async function(req, reply) {
    const name = req?.query?.name || '';
    logger.trace(`/search/artists ${name}`);
    //
    const data = await db.getArtists(name);
    await reply.send(data);
})*/

fastify.get('/collection', async function(req, reply) {
    if (req.session.user) {
        logger.trace(`/collection`);
        const data = await db.getCollection();
        await reply.send(data);
    }
    reply.code(401).send({ error: 'Not logged in' });
})

fastify.get('/search/cover', async function(req, reply) {
    if (req.session.user) {
        const album_id = req?.query?.album_id;
        logger.trace(`/search/cover [${album_id}]`);
        const data = await db.getCover(album_id);
        await reply.send(data);
    }
    reply.code(401).send({ error: 'Not logged in' });
})

fastify.get('/sources', async function(req, reply) {
    if (req.session.user) {
        logger.trace(`/sources`);
        const data = await db.getSources();
        await reply.send(data);
    }
    reply.code(401).send({ error: 'Not logged in' });
})

fastify.get('/search/albums', async function(req, reply) {
    if (req.session.user) {
        const title = req?.query?.title || '';
        const artistid = req?.query?.artistid;
        logger.trace(`/search/albums [${title}|${artistid}]`);
        const data = await db.getAlbums({ title, artistid });
        await reply.send(data);
    }
    reply.code(401).send({ error: 'Not logged in' });
})

fastify.get('/search/songs', async function(req, reply) {
    if (req.session.user) {
        const albumid = req?.query?.albumid;
        const title = req?.query?.title || '';
        logger.trace(`/search/songs [${albumid}|${title}]`);
        //
        const data = await db.getSongs({albumid, title});
        await reply.send(data);
    }
    reply.code(401).send({ error: 'Not logged in' });
})

fastify.get('/stream/song', async function(req, reply) {
    if (req.session.user) {
        const songid = req?.query?.id;
        const song = await db.getSongInfo(songid);
        logger.trace("Streaming " + song.fullpath);
        //
        return streamer.streamFile(req, reply, song.fullpath);
    }
    reply.code(401).send({ error: 'Not logged in' });
})

/*
fastify.get('/search/song', async function(req, reply) {
    const id = req.query.id;
    logger.trace(`/search/song ${id}`);
    //
    const data = await db.getSongInfo(id);
    await reply.send(data);
})*/

module.exports.run = () => {
    fastify.listen( { port: process.env.PORT, host: '0.0.0.0' }, function(err) {
        if (err) {
            logger.error(err);
            process.exit(1);
        }
        logger.info('Server up ...')
    } )
}