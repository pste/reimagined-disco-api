const logger = require('./logger');
const fastifyApp = require('fastify');
const cors = require('@fastify/cors');
const cookie = require('@fastify/cookie');
const session = require('@fastify/session');
const db = require('./db');
const cache = require('./cache');
const streamer = require('./streamer');
const params = require('./parameters');
const coverFetch = require('./coverFetch');
const sessionStore = require('./sessionStore');
const loginLimiter = require('./loginLimiter');
const cronParser = require('cron-parser');

// variabili senza le quali l'API partirebbe "rotta" in silenzio: senza BEARER_TOKEN le
// rotte interne accetterebbero "Bearer undefined", senza SESSION_* le sessioni non funzionano
const REQUIRED_ENV = ['BEARER_TOKEN', 'SESSION_SECRET', 'SESSION_TIMEOUTSECS'];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
    logger.error(`server: variabili d'ambiente mancanti: ${missingEnv.join(', ')}`);
    process.exit(1);
}

// =============== FASTIFY =============== // 

const fastifyOptions = {
    loggerInstance: logger,
    disableRequestLogging: ( process.env.DISABLE_REQUEST_LOGGING ) ? true : false,
    requestTimeout: 10 * 1000, // 10 secs
    // l'API sta dietro Traefik (Service ClusterIP): senza, req.ip sarebbe l'IP del pod di
    // Traefik per tutti. 1 = ci si fida di UN proxy: req.ip è l'indirizzo che Traefik
    // aggiunge in X-Forwarded-For (serve al limite dei tentativi di login per IP)
    trustProxy: 1,
    // POST /scan/song porta la cover APIC nel body, serializzata come Buffer JSON
    // ({type:'Buffer',data:[...]}): ogni byte diventa un numero+virgola, quindi una
    // cover di pochi MB gonfia oltre il default Fastify di 1 MB → 413. Alzato a 20 MB.
    bodyLimit: 20 * 1024 * 1024 // 20 MB
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
// sessioni persistenti su PostgreSQL (sopravvivono ai riavvii del pod); con rolling la
// scadenza (SESSION_TIMEOUTSECS, 90 giorni in k8s) riparte a ogni richiesta: si resta
// loggati finché si usa l'app, come nelle app di streaming commerciali
fastify.register(session, {
    cookieName: 'discocookie',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
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

// =============== ROUTES =============== //

// job che il pod jobs sa eseguire (vedi HANDLERS in reimagined-disco-jobs/src/jobs.js).
// libcheck (report dei problemi della libreria) si lancia solo a mano: nessuno lo ri-accoda
const JOB_NAMES = ['filescan', 'fullscan', 'id3write', 'libcheck'];

// errore di validazione della creazione di un job, o null se la richiesta è valida
function jobRequestError(name, when) {
    if (!JOB_NAMES.includes(name)) {
        return `job sconosciuto: ${name} (ammessi: ${JOB_NAMES.join(', ')})`;
    }
    if (!when || isNaN(new Date(when).getTime())) {
        return 'when mancante o non è una data valida';
    }
    return null;
}

// intero >= min (accetta anche la stringa numerica di params/query), altrimenti null
function toInt(value, min = 1) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isInteger(n) || n < min) {
        return null;
    }
    return n;
}

function isValidCron(expression) {
    if (typeof expression !== 'string' || !expression.trim()) {
        return false;
    }
    try {
        cronParser.parseExpression(expression);
        return true;
    }
    catch (err) {
        return false;
    }
}

const SONG_NOT_FOUND = { error: 'brano non trovato' };
// OPEN ROUTES
fastify.register((instance, opts, done) => {
    instance.post('/login', async (req, reply) => {
        const { username, password } = req.body ?? {};
        // body malformato: 400 (prima finiva in un 500 dentro l'hash della password)
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password
            || username.length > 200 || password.length > 200) {
            return reply.status(400).send({ error: 'username and password required' });
        }
        // troppi tentativi falliti (per username o per IP): 429, senza nemmeno interrogare il DB
        const wait = loginLimiter.retryAfterSecs(req.ip, username);
        if (wait > 0) {
            logger.warn(`server: /login 429 - too many failed attempts [${req.ip}]`);
            reply.header('Retry-After', wait);
            return reply.status(429).send({ error: `Troppi tentativi di login falliti: riprova tra ${Math.ceil(wait / 60)} minuti` });
        }
        const dbuser = await db.getUser(username, password);
        if (dbuser) {
            loginLimiter.recordSuccess(req.ip, username);
            const authuser = { username: dbuser.username, user_id: dbuser.user_id, authenticated: true };
            req.session.set('user', authuser);
            // pulizia sessioni scadute (fire-and-forget): al login basta, niente cron
            db.deleteExpiredSessions().catch((err) => logger.error(err, 'server: /login deleteExpiredSessions failed'));
            return authuser;
        }
        else {
            loginLimiter.recordFailure(req.ip, username);
            logger.error(`server: /login 401 - invalid credentials [${req.ip}]`);
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
        const user = req.session.get('user');
        logger.trace(`/collection ${user?.user_id}`);
        const data = await db.getCollection(user.user_id);
        return data;
    })

    // toggle preferito (per utente) su un album
    instance.post('/favorite', async (req, reply) => {
        const { favorite } = req.body ?? {};
        const album_id = toInt(req.body?.album_id);
        if (album_id === null) {
            return reply.status(400).send({ error: 'album_id invalido' });
        }
        const user = req.session.get('user');
        logger.trace(`/favorite [album:${album_id}] [favorite:${favorite}] ${user?.user_id}`);
        await db.setFavorite(user.user_id, album_id, favorite === true);
        return { ok: true };
    })

    // eventi diagnostici della UI (player): la UI li accumula in localStorage e li invia
    // a blocchi, anche in ritardo (pagina congelata in background) → ora del client in `t`
    const CLIENTLOG_MAX_EVENTS = 200;
    const CLIENTLOG_MAX_EVENT_LEN = 64;
    instance.post('/clientlog', async (req, reply) => {
        const events = req.body?.events;
        if (!Array.isArray(events) || events.length === 0 || events.length > CLIENTLOG_MAX_EVENTS) {
            return reply.status(400).send({ error: `events required (1-${CLIENTLOG_MAX_EVENTS})` });
        }
        const invalid = events.some((e) => typeof e?.event !== 'string' || e.event.length === 0 || e.event.length > CLIENTLOG_MAX_EVENT_LEN);
        if (invalid) {
            return reply.status(400).send({ error: 'event invalido' });
        }
        const user = req.session.get('user');
        const userAgent = req.headers['user-agent'] ?? '';
        const rows = events.map((e) => {
            const details = (e.details && typeof e.details === 'object') ? e.details : {};
            // i campi fissi dopo i details: il client non può sovrascrivere user_id
            return {
                message: `CLIENT ${e.event}`,
                details: JSON.stringify({ ...details, t: e.t, user_id: user.user_id, ua: userAgent }),
            };
        });
        logger.trace(`/clientlog [events:${rows.length}] ${user?.user_id}`);
        await db.saveClientLogs(rows);
        return { ok: true };
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
            // merge bloccato da tracce omonime / titoli duplicati tra le tracce inviate:
            // errore parlante alla UI (il toast mostra "error"). Il save è in transazione,
            // quindi in ogni caso di errore il DB è tornato allo stato di prima
            if (err.code === 'MERGE_DUPLICATE_TITLES' || err.code === 'DUPLICATE_TRACK_TITLES') {
                return reply.status(409).send({ error: err.message });
            }
            // 23505 = unique_violation di PostgreSQL (es. un titolo uguale a una traccia
            // dell'album non inclusa nel salvataggio)
            if (err.code === '23505') {
                return reply.status(409).send({ error: 'Titolo duplicato: esiste già un brano o un album con questo nome' });
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
        if (mbid && !coverFetch.isMbid(mbid)) {
            return reply.status(400).send({ error: 'mbid non valido' });
        }
        return coverFetch.proposeCovers({ artist, album, mbid });
    })

    // Lazy path, parte 1: gli id delle release del gruppo (1 chiamata MB, veloce).
    // La UI poi pagina chiamando /cover/fetch/front?id= per ognuna (Promise.all a batch).
    instance.get('/cover/fetch/releases', async function(req, reply) {
        const mbid = req?.query?.mbid;
        logger.trace(`/cover/fetch/releases [${mbid}]`);
        if (!coverFetch.isMbid(mbid)) {
            return reply.status(400).send({ error: 'mbid required (UUID)' });
        }
        const releaseIds = await coverFetch.listReleaseIds(mbid);
        return { releaseIds };
    })

    // Lazy path, parte 2: risolve la front di UNA release (una HEAD, throttlata lato API).
    // candidate=null se quella release non ha front: la UI la salta. Mai 500 per una flaky.
    instance.get('/cover/fetch/front', async function(req, reply) {
        const id = req?.query?.id;
        logger.trace(`/cover/fetch/front [${id}]`);
        if (!coverFetch.isMbid(id)) {
            return reply.status(400).send({ error: 'id required (UUID)' });
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
        // solo Cover Art Archive / archive.org, https (vedi coverFetch: niente SSRF)
        if (!coverFetch.isAllowedImageUrl(imageUrl)) {
            return reply.status(400).send({ error: 'imageUrl non ammesso: solo coverartarchive.org / archive.org' });
        }
        if (mbid && !coverFetch.isMbid(mbid)) {
            return reply.status(400).send({ error: 'mbid non valido' });
        }
        let image;
        try {
            image = await coverFetch.downloadImage(imageUrl);
        }
        catch(err) {
            logger.error(err, '/cover/save downloadImage failed');
            return reply.status(502).send({ error: `cover download failed: ${err.message}` });
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

    // mp3 intero da scaricare (tag ID3 quelli del file su disco)
    instance.get('/download/song', async function(req, reply) {
        const songid = Number(req?.query?.id);
        if (!Number.isInteger(songid)) {
            return reply.status(400).send({ error: 'song_id invalido' });
        }
        const song = await db.getSongInfo(songid);
        if (!song) {
            return reply.status(404).send(SONG_NOT_FOUND);
        }
        logger.trace(`Download ${song.fullpath}`);
        return streamer.downloadFile(reply, song.fullpath, song.filename);
    })

    // un chunk del brano (1 MB, base64) letto dal disco all'offset giusto. Il chunk 1 porta
    // anche i metadata (durata, bitrate, audioOffset, totalChunks). Oltre la fine: data null
    instance.get('/chunk/song', async function(req, reply) {
        const songid = toInt(req?.query?.id);
        const chunkIndex = toInt(req?.query?.chunkIndex ?? 1);
        if (songid === null || chunkIndex === null) {
            return reply.status(400).send({ error: 'id o chunkIndex invalido' });
        }
        logger.trace(`Chunking ${songid}:${chunkIndex}`);

        // percorso e metadata del file: in cache per qualche minuto (una query e un parse
        // del file per brano, non per chunk)
        let info = cache.getSongFile(songid);
        let filesize = info ? await streamer.fileSize(info.fullpath) : null;
        if (filesize === null) {
            // non in cache, oppure il file in cache è stato spostato/cancellato: si chiede al DB
            const song = await db.getSongInfo(songid);
            if (!song) {
                return reply.status(404).send(SONG_NOT_FOUND);
            }
            info = { fullpath: song.fullpath, filesize: null, metadata: null };
            filesize = await streamer.fileSize(info.fullpath);
            if (filesize === null) {
                return reply.status(404).send({ error: 'file del brano non trovato su disco' });
            }
        }
        // file riscritto nel frattempo (es. id3write: il tag cambia dimensione): i metadata
        // in cache non valgono più
        if (!info.metadata || info.filesize !== filesize) {
            const fileMeta = await streamer.readMetadata(info.fullpath);
            info.filesize = filesize;
            info.metadata = { ...fileMeta, totalChunks: streamer.totalChunks(filesize) };
            cache.storeSongFile(songid, info);
        }

        const chunk = await streamer.readChunk(info.fullpath, chunkIndex);
        const data = chunk ? chunk.toString('base64') : null;
        if (chunkIndex === 1) {
            return { metadata: info.metadata, data };
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
        const { cronRequeue, cacheTTLDays, favCacheTTLDays } = req.body ?? {};
        logger.trace(`/parameters [cronRequeue:${cronRequeue}] [cacheTTLDays:${cacheTTLDays}] [favCacheTTLDays:${favCacheTTLDays}]`);
        // una cron non valida farebbe fallire il requeue del filescan nel pod jobs.
        // Stringa vuota = nessun requeue automatico (il pod lo salta)
        if (cronRequeue !== '' && !isValidCron(cronRequeue)) {
            return reply.status(400).send({ error: 'cronRequeue non è una espressione cron valida' });
        }
        if (toInt(cacheTTLDays) === null || toInt(favCacheTTLDays) === null) {
            return reply.status(400).send({ error: 'cacheTTLDays e favCacheTTLDays devono essere interi maggiori di 0' });
        }
        await db.saveParameters(cronRequeue, toInt(cacheTTLDays), toInt(favCacheTTLDays));
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
        const { name, when } = req.body ?? {};
        const error = jobRequestError(name, when);
        if (error) {
            return reply.status(400).send({ error });
        }
        return db.upsertPendingJob(name, when);
    })

    instance.delete('/jobs/:id', async function(req, reply) {
        const id = toInt(req.params.id);
        if (id === null) {
            return reply.status(400).send({ error: 'job_id invalido' });
        }
        await db.deleteJob(id);
        return { ok: true };
    })

    // report testuale del job come file da scaricare (es. libcheck-123.txt)
    instance.get('/jobs/:id/report', async function(req, reply) {
        const job_id = Number(req.params.id);
        if (!Number.isInteger(job_id)) {
            return reply.status(400).send({ error: 'job_id invalido' });
        }
        const job = await db.getJobReport(job_id);
        if (!job?.report) {
            return reply.status(404).send({ error: 'report non disponibile' });
        }
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${job.name}-${job_id}.txt"`);
        return job.report;
    })

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
        const id = toInt(req.params.id);
        const { status, result } = req.body ?? {};
        // il pod chiude un job solo come done o error
        if (id === null || !['done', 'error'].includes(status)) {
            return reply.status(400).send({ error: 'job_id o status invalido' });
        }
        await db.updateJobStatus(id, status, result);
        return { ok: true };
    });

    // il pod carica il report del job (testo, anche qualche MB: sta nel bodyLimit da 20 MB)
    instance.put('/jobs/:id/report', async (req, reply) => {
        const job_id = Number(req.params.id);
        const { report } = req.body ?? {};
        if (!Number.isInteger(job_id) || typeof report !== 'string') {
            return reply.status(400).send({ error: 'job_id o report invalido' });
        }
        const updated = await db.setJobReport(job_id, report);
        if (updated === 0) {
            return reply.status(404).send({ error: 'job non trovato' });
        }
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

    // libcheck: dati del DB per file, da confrontare con gli ID3 su disco
    instance.get('/scan/files/tags', async (req, reply) => {
        return db.getFilesWithTags();
    });

    instance.post('/scan/song', async (req, reply) => {
        const fileinfo = req.body;
        // La cover arriva in base64 (vedi readid3 nel job): ricostruisci il Buffer
        if (fileinfo.tags?.image?.imageBuffer) {
            fileinfo.tags.image.imageBuffer = Buffer.from(fileinfo.tags.image.imageBuffer, 'base64');
        }
        await db.updateSong(fileinfo);
        return { ok: true };
    });

    // rimozione per file_id (non per song_id): un brano spostato/rinominato ha già la
    // riga nuova con lo stesso song_id, cancellare per song_id la porterebbe via con sé.
    // Song/stats/user_id3 rimasti senza file li raccoglie /scan/cleanup
    instance.delete('/scan/file/:file_id', async (req, reply) => {
        const file_id = Number(req.params.file_id);
        if (!Number.isInteger(file_id)) {
            return reply.status(400).send({ error: 'file_id invalido' });
        }
        await db.removeFile(file_id);
        return { ok: true };
    });

    instance.post('/scan/cleanup', async (req, reply) => {
        await db.clearEmptyAlbums();
        return { ok: true };
    });

    instance.get('/scan/song/:id', async (req, reply) => {
        const { id } = req.params;
        const song = await db.getSongInfo(id);
        if (!song) {
            return reply.status(404).send(SONG_NOT_FOUND);
        }
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
        const { name, when } = req.body ?? {};
        const error = jobRequestError(name, when);
        if (error) {
            return reply.status(400).send({ error });
        }
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