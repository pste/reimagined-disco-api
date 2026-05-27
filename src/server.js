const logger = require('./logger');
const fastifyApp = require('fastify');
const cors = require('@fastify/cors');
const cookie = require('@fastify/cookie');
const session = require('@fastify/session');
const fastifyRange = require('fastify-range'); // needed to stream data
const db = require('./db');
const cache = require('./cache');
const streamer = require('./streamer');
const params = require('./parameters');

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
        "http://music.saba.net",
        "http://music.sepo.net",
        "https://music.nestix.dev"
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

    instance.get('/song/id3', async function(req, reply) {
        const songid = req?.query?.id;
        const song = await db.getSongInfo(songid);
        const data = await streamer.readId3(song.fullpath);
        return data;
    })

    instance.post('/song/id3', async function(req, reply) {
        const songid = req?.query?.id;
        const song = await db.getSongInfo(songid);
        logger.trace(`/song/id3 [${songid}] ${song.fullpath}`);
        try {
            await streamer.writeId3(song.fullpath, req.body);
            logger.trace(`/song/id3 [${songid}] write ok`);
            return { ok: true };
        } catch(err) {
            logger.error(err, `/song/id3 [${songid}] write failed`);
            return reply.status(403).send({ error: 'Cannot write to file: ' + err.message });
        }
    })

    instance.get('/search/songs', async function(req, reply) {
        const albumid = req?.query?.albumid;
        const title = req?.query?.title || '';
        logger.trace(`/search/songs [${albumid}|${title}]`);
        //
        const data = await db.getSongs({albumid, title});
        return data;
    })

    // update song stats
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
        const chunkIndex = req?.query?.chunkIndex ?? '1';
        const chunkId = `${songid}:${chunkIndex}`;
        logger.trace(`Chunking ${chunkId}`);

        // cache fail: refresh whole song
        if (!cache.has(chunkId))  {
            const song = await db.getSongInfo(songid);
            logger.trace(`Now caching ${JSON.stringify(song)}`);
            const [chunked, metadata] = await Promise.all([
                streamer.chunkFile(song.fullpath),
                streamer.readMetadata(song.fullpath)
            ]);
            logger.trace(`Now cached ${JSON.stringify(song)}`)
            const totalChunks = await cache.storeChunks(songid, chunked);
            cache.storeMetadata(songid, { ...metadata, totalChunks });
            logger.trace(`Chunked ${chunkId}`);
        }

        // return buffer block
        logger.trace(`Chunk cached ${chunkId}`);
        const chunk = cache.get(chunkId);
        const data = chunk ? chunk.toString('base64') : null;
        if (chunkIndex === '1') {
            return { metadata: cache.getMetadata(songid), data };
        }
        return { data };
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

    instance.get('/parameters', async function(req, reply) {
        logger.trace(`/parameters`);
        const data = await db.getParameters();
        return data;
    })

    instance.post('/parameters', async function(req, reply) {
        const { cronScan } = req.body;
        logger.trace(`/parameters [cronScan:${cronScan}]`);
        await db.saveParameters(cronScan);
        return { ok: true };
    })

    instance.get('/user/me', async function(req, reply) {
        const authuser = req.session.get('user');
        return { username: authuser.username }
    })

    instance.get('/jobs', async function(req, reply) {
        return db.getJobs();
    })

    instance.post('/jobs', async function(req, reply) {
        const { name, when } = req.body;
        return db.createJob(name, when);
    })

    instance.delete('/jobs/:id', async function(req, reply) {
        const { id } = req.params;
        await db.deleteJob(id);
        return { ok: true };
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

// INTERNAL ROUTES — bearer token auth, used by the jobs pod
fastify.register((instance, opts, done) => {

    instance.addHook('preHandler', (req, reply, next) => {
        const auth = req.headers['authorization'];
        if (auth === `Bearer ${process.env.BEARER_TOKEN}`) {
            next();
        }
        else {
            logger.error('internal: 401 - invalid bearer token');
            reply.status(401).send({ error: '401 - unauthorized' });
        }
    });

    // jobs
    instance.post('/jobs/claim', async (req, reply) => {
        return db.claimNextJob(); // returns null (no pending job) or job object
    });

    instance.patch('/jobs/:id', async (req, reply) => {
        const { id } = req.params;
        const { status, result } = req.body;
        await db.updateJobStatus(id, status, result);
        return { ok: true };
    });

    // scan support
    instance.get('/scan/basedir', async (req, reply) => {
        const basedir = await params.baseDir();
        return { basedir };
    });

    instance.get('/scan/files', async (req, reply) => {
        return db.getFiles();
    });

    instance.post('/scan/song', async (req, reply) => {
        const fileinfo = req.body;
        // Reconstruct Buffer from JSON-serialized form ({type:'Buffer',data:[...]})
        if (fileinfo.tags?.image?.imageBuffer) {
            fileinfo.tags.image.imageBuffer = Buffer.from(fileinfo.tags.image.imageBuffer);
        }
        await db.updateSong(fileinfo);
        return { ok: true };
    });

    instance.delete('/scan/song/:id', async (req, reply) => {
        const { id } = req.params;
        await db.removeFile(id);
        return { ok: true };
    });

    instance.post('/scan/cleanup', async (req, reply) => {
        await db.clearEmptyAlbums();
        return { ok: true };
    });

    done();
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