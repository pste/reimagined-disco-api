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
const coverFetch = require('./coverFetch');

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

    instance.get('/collection', async (req, reply) => {
        logger.trace(`/collection`);
        const data = await db.getCollection();
        return data;
    })

    instance.get('/sources', async function(req, reply) {
        logger.trace(`/sources`);
        const data = await db.getSources();
        return data;
    })

    instance.get('/search/cover', async (req, reply) => {
        const album_id = req?.query?.album_id;
        logger.trace(`/search/cover [${album_id}]`);
        const data = await db.getCover(album_id);
        return data;
    })

    instance.get('/search/albums', async function(req, reply) {
        const title = req?.query?.title || '';
        const artistid = req?.query?.artistid;
        logger.trace(`/search/albums [${title}|${artistid}]`);
        const data = await db.getAlbums({ title, artistid });
        return data;
    })

    // Save dell'editor album: write-through su songs/albums (DB = stato desiderato,
    // subito coerente per editor e Collection) + coda user_id3 + un solo job id3write.
    // Ritorna album_id (può cambiare se il rename atterra su un altro album row).
    instance.post('/album/id3', async function(req, reply) {
        const { album_id, album, artist, year, genre, tracks } = req.body;
        logger.trace(`/album/id3 [${album_id}] queuing id3write job`);
        if (!album_id || !Array.isArray(tracks) || tracks.length === 0) {
            return reply.status(400).send({ error: 'album_id and tracks required' });
        }
        const meta = {
            album:  album  || null,
            artist: artist || null,
            year:   year   ? parseInt(year) : null,
            genre:  genre  || null,
        };
        const trackList = tracks.map((t) => ({
            song_id:  t.song_id,
            title:    t.title ?? null,
            track_nr: t.track_nr != null ? parseInt(t.track_nr) : null,
            disc_nr:  t.disc_nr  != null ? parseInt(t.disc_nr)  : null,
        }));
        let newAlbumId;
        try {
            newAlbumId = await db.saveAlbumTags(album_id, meta, trackList);
        }
        catch (err) {
            // merge bloccato da tracce omonime: errore parlante alla UI (il toast mostra "error")
            if (err.code === 'MERGE_DUPLICATE_TITLES') {
                return reply.status(409).send({ error: err.message });
            }
            throw err;
        }
        await db.upsertPendingJob('id3write', new Date());
        return { ok: true, album_id: newAlbumId };
    })

    // Fast path: poche proposte cover da Cover Art Archive (1 HEAD sul release-group)
    instance.get('/cover/fetch', async function(req, reply) {
        const artist = req?.query?.artist;
        const album  = req?.query?.album;
        const mbid   = req?.query?.mbid;
        logger.trace(`/cover/fetch [${artist}|${album}|${mbid}]`);
        return coverFetch.proposeCovers({ artist, album, mbid });
    })

    // Lazy path, parte 1: gli id delle release del gruppo (1 chiamata MB, veloce).
    // La UI poi pagina chiamando /cover/fetch/front?id= per ognuna (Promise.all a batch).
    instance.get('/cover/fetch/releases', async function(req, reply) {
        const mbid = req?.query?.mbid;
        logger.trace(`/cover/fetch/releases [${mbid}]`);
        if (!mbid) {
            return reply.status(400).send({ error: 'mbid required' });
        }
        const releaseIds = await coverFetch.listReleaseIds(mbid);
        return { releaseIds };
    })

    // Lazy path, parte 2: risolve la front di UNA release (una HEAD, throttlata lato API).
    // candidate=null se quella release non ha front: la UI la salta. Mai 500 per una flaky.
    instance.get('/cover/fetch/front', async function(req, reply) {
        const id = req?.query?.id;
        logger.trace(`/cover/fetch/front [${id}]`);
        if (!id) {
            return reply.status(400).send({ error: 'id required' });
        }
        const candidate = await coverFetch.frontForRelease(id);
        return { candidate };
    })

    // Salva la cover scelta su tutti i brani dell'album: scarica i byte ORA (lato API),
    // li scrive in user_id3.cover e accoda l'id3write. Se il download fallisce (archive.org
    // intermittente) torna 502 alla UI invece di salvare byte vuoti.
    instance.post('/cover/save', async function(req, reply) {
        const { album_id, imageUrl, mbid } = req.body;
        logger.trace(`/cover/save [${album_id}|${imageUrl}|${mbid}]`);
        if (!album_id || !imageUrl) {
            return reply.status(400).send({ error: 'album_id and imageUrl required' });
        }
        let image;
        try {
            image = await coverFetch.downloadImage(imageUrl);
        }
        catch(err) {
            logger.error(err, '/cover/save downloadImage failed');
            return reply.status(502).send({ error: 'cover download failed' });
        }
        await db.setAlbumCover(album_id, image.buffer);
        if (mbid) {
            await db.setReleaseGroup(album_id, mbid);
        }
        await db.upsertPendingJob('id3write', new Date());
        // torna i byte già scaricati: la UI aggiorna subito la cache cover senza riscaricare
        return { ok: true, mime: image.mime, cover: image.buffer.toString('base64') };
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

        // past-the-end probe: metadata already cached → answer null without re-chunking the file
        let metadata = cache.getMetadata(songid);
        if (metadata && Number(chunkIndex) > metadata.totalChunks) {
            logger.trace(`Chunk ${chunkId} beyond totalChunks ${metadata.totalChunks}`);
            return { data: null };
        }

        // cache fail: refresh whole song
        // get-then-check (not has-then-get): the chunk could expire between the two calls.
        // chunk 1 must also carry metadata, so refresh if that expired too.
        let chunk = cache.get(chunkId);
        if (!chunk || (chunkIndex === '1' && !metadata)) {
            const song = await db.getSongInfo(songid);
            logger.trace(`Now caching ${JSON.stringify(song)}`);
            const [chunked, fileMeta] = await Promise.all([
                streamer.chunkFile(song.fullpath),
                streamer.readMetadata(song.fullpath)
            ]);
            logger.trace(`Now cached ${JSON.stringify(song)}`)
            const totalChunks = await cache.storeChunks(songid, chunked);
            metadata = { ...fileMeta, totalChunks };
            cache.storeMetadata(songid, metadata);
            logger.trace(`Chunked ${chunkId}`);
            chunk = cache.get(chunkId);
        }

        // return buffer block
        logger.trace(`Chunk cached ${chunkId}`);
        const data = chunk ? chunk.toString('base64') : null;
        if (chunkIndex === '1') {
            return { metadata, data };
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
        const { cronRequeue, cacheTTLDays } = req.body;
        logger.trace(`/parameters [cronRequeue:${cronRequeue}] [cacheTTLDays:${cacheTTLDays}]`);
        await db.saveParameters(cronRequeue, cacheTTLDays);
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
        return db.upsertPendingJob(name, when);
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

    instance.get('/scan/song/:id', async (req, reply) => {
        const { id } = req.params;
        const song = await db.getSongInfo(id);
        return { fullpath: song.fullpath };
    });

    instance.get('/scan/id3/pending', async (req, reply) => {
        return db.getPendingTags();
    });

    instance.delete('/scan/id3/:song_id', async (req, reply) => {
        const { song_id } = req.params;
        // updated_at (opzionale): delete condizionale, vedi deleteUserTag
        const { updated_at } = req.query;
        await db.deleteUserTag(song_id, updated_at);
        return { ok: true };
    });

    instance.patch('/scan/id3/:song_id', async (req, reply) => {
        const { song_id } = req.params;
        await db.setUserTagError(song_id);
        return { ok: true };
    });

    instance.get('/parameters/scan', async (req, reply) => {
        return db.getParameters();
    });

    instance.post('/jobs/scan', async (req, reply) => {
        const { name, when } = req.body;
        return db.upsertPendingJob(name, when);
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