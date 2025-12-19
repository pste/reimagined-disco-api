const logger = require('./logger');
const fastifyApp = require('fastify');
const cors = require('@fastify/cors');
const cookie = require('@fastify/cookie');
const session = require('@fastify/session');
const fastifyRange = require('fastify-range'); // needed to stream data
const db = require('./db');
const streamer = require('./streamer');

// =============== FASTIFY =============== // 

const fastifyOptions = {
    loggerInstance: logger,
    disableRequestLogging: ( process.env.DISABLE_REQUEST_LOGGING ) ? true : false,
    requestTimeout: 10 * 1000 // 10 secs
}

const fastify = fastifyApp( fastifyOptions );

// cors

fastify.register(cors, {
    credentials: true,
    origin: [
        "http://localhost.saba.net:3000",
        "http://music.saba.net"
    ]
});

// cookie session handler
fastify.register(cookie);
fastify.register(session, {
    cookieName: 'discocookie',
    secret: process.env.SESSION_SECRET,
    cookie: {
        secure: 'auto', // true only for HTTPS, also handles sameSite
        //httpOnly: true,
        //sameSite: 'None',
        //path: '/',
        maxAge: parseInt(process.env.SESSION_TIMEOUTSECS) * 1000 // msec
    },
    saveUninitialized: false,
    rolling: true,
});

fastify.register(fastifyRange, { throwOnInvalid: true });

// =============== ROUTES =============== //
/*
fastify.get('/', function(req, reply) {
    reply.send({ api: "Online", authenticated: req.session.authenticated });
})*/

// OPEN ROUTES
fastify.register((instance, opts, done) => {
    instance.post('/login', async (req, reply) => {
        const { username, password } = req.body;
        const dbuser = await db.getUser(username, password);
        if (dbuser) {
            const authuser = { username: dbuser.username, user_id: dbuser.user_id, authenticated: true };
            req.session.set('user', authuser);
            return authuser;
        }
        else {
            logger.error("server: /login 401 - invalid credentials");
            return reply.status(401).send({ error: 'Invalid credentials' });
        }
    })

    instance.post('/logout', async (req, reply) => {
        const user = req.session.get('user');
        if (user) {
            await req.session.destroy();
            return { message: 'Logout OK' };
        }
        else {
            return { message: "Logged out" };
        }
    });

    done()
}, { prefix: '/api' });

// CLOSED ROUTES
fastify.register((instance, opts, done) => {

    instance.addHook('preHandler', (req, reply, next) => {
        const user = req.session.get('user');
        logger.trace(`preHandler ${JSON.stringify(user)}`);
        if (user?.authenticated === true) {
            next()
        }
        else {
            logger.error("server: /prehandler 401 - unauthorized")
            reply.status(401).send({ error: "401 - unauthorized" })
        }
    })

    /*
    instance.get('/search/artists', async function(req, reply) {
        const name = req?.query?.name || '';
        logger.trace(`/search/artists ${name}`);
        //
        const data = await db.getArtists(name);
        return reply.send(data);
    })*/

    instance.get('/collection', async (req, reply) => {
        logger.trace(`/collection`);
        const data = await db.getCollection();
        return data;
    })

    instance.get('/search/cover', async (req, reply) => {
        const album_id = req?.query?.album_id;
        logger.trace(`/search/cover [${album_id}]`);
        const data = await db.getCover(album_id);
        console.log(data)
        return data;
    })

    instance.get('/sources', async function(req, reply) {
        logger.trace(`/sources`);
        const data = await db.getSources();
        return data;
    })

    instance.get('/search/albums', async function(req, reply) {
        const title = req?.query?.title || '';
        const artistid = req?.query?.artistid;
        logger.trace(`/search/albums [${title}|${artistid}]`);
        const data = await db.getAlbums({ title, artistid });
        return data;
    })

    instance.get('/search/songs', async function(req, reply) {
        const albumid = req?.query?.albumid;
        const title = req?.query?.title || '';
        logger.trace(`/search/songs [${albumid}|${title}]`);
        //
        const data = await db.getSongs({albumid, title});
        return data;
    })

    instance.post('/stream/song', async function(req, reply) {
        const { song_id } = req.body;
        const user = req.session.get('user');
        if (user?.user_id) {
            logger.trace(`updateSongStats ${song_id} ${user.user_id}`);
            const data = await db.updateSongStats(user.user_id, song_id);
            return data;
        }
        return {}
    })

    instance.get('/stream/song', async function(req, reply) {
        const songid = req?.query?.id;
        const song = await db.getSongInfo(songid);
        logger.trace(`Streaming ${song.fullpath}`);
        //
        return streamer.streamFile(req, reply, song.fullpath);
    })

    instance.get('/chunk/song', async function(req, reply) {
        const songid = req?.query?.id;
        const song = await db.getSongInfo(songid);
        logger.trace(`Chunking ${song.fullpath}`);
        //
        return streamer.chunkFile(req, reply, song.fullpath);
    })

    instance.post('/user/password', async function(req, reply) {
        const { value } = req.body;
        const user = req.session.get('user');
        if (user?.user_id) {
            logger.trace(`saveUserPassword for ${user.user_id}`);
            const data = await db.savePassword(user.user_id, value);
            return data;
        }
        return {}
    })

    /*
    instance.get('/search/song', async function(req, reply) {
        const id = req.query.id;
        logger.trace(`/search/song ${id}`);
        //
        const data = await db.getSongInfo(id);
        await reply.send(data);
    })*/

    done()
}, { prefix: '/api' });

// 
module.exports.run = () => {
    fastify.listen( { port: process.env.PORT, host: '0.0.0.0' }, function(err) {
        if (err) {
            logger.error(err, "server error.");
            process.exit(1);
        }
        logger.info('Server up ...')
    } )
}