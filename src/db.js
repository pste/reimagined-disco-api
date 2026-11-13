const path = require('path');
const crypto = require('node:crypto');

const artists = require('./dbmodels/artists');
const albums = require('./dbmodels/albums');
const songs = require('./dbmodels/songs');
const songstats = require('./dbmodels/songstats');
const files = require('./dbmodels/files');
const sources = require('./dbmodels/sources');
const pars = require('./dbmodels/parameters');
const users = require('./dbmodels/users');
const jobs = require('./dbmodels/jobs');
const user_id3 = require('./dbmodels/user_id3');
const favorites = require('./dbmodels/favorites');
const sessions = require('./dbmodels/sessions');
const logs = require('./dbmodels/logs');
const pool = require('./dbmodels/dbpool');

const logger = require('./logger');
const utils = require('./utils');

/////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////

// song details page. null se la song (o il suo file) non esiste: le rotte rispondono 404
async function getSongInfo(song_id) {
    const row = await songs.getSongInfo(song_id);
    if (!row) {
        return null;
    }
    return {
        album_id: row.album_id,
        artist: row.artist,
        album: row.album,
        year: row.year,
        genre: row.genre,
        song_id: row.song_id,
        sourcepath: row.source_path,
        filepath: row.file_path,
        filename: row.file_name,
        fullpath: path.join(row.source_path, row.file_path, row.file_name),
        modified: row.modified,
        title: row.title,
        trackNumber: row.track_nr,
        discNumber: row.disc_nr,
    };
}

// stats page
async function fullStats() {
    const c1 = await artists.countArtists();
    const c2 = await albums.countAlbums();
    const c3 = await songs.countSongs();
    return {
        artists: c1[0].count,
        albums: c2[0].count,
        songs: c3[0].count
    }
}

/////////////////////////////////////////////////////////////////

// filescan 
async function updateSong(fileinfo) {
    // normalize data before upsert
    const UNKNOWN = 'UNKNOWN';
    const songdata = {
        basedir: fileinfo.basedir,
        filepath: fileinfo.parentpath, 
        filename: fileinfo.filename,
        modified: utils.maxDate(fileinfo.mtime, fileinfo.ctime), // last time when file/attributes has changed
        title: fileinfo.tags.title                                  || UNKNOWN,
		artist: fileinfo.tags.artist                                || UNKNOWN,
		album: fileinfo.tags.album                                  || UNKNOWN,
		year: utils.parseNumber(fileinfo.tags.year)                 || 1900,
		genre: fileinfo.tags.genre                                  || UNKNOWN,
		trackNumber: utils.parseNumber(fileinfo.tags.trackNumber)   || 0,
		discNumber: utils.parseNumber(fileinfo.tags.partOfSet)   || 1, // TPOS "1/2" → 1
        cover: fileinfo.tags?.image?.imageBuffer // .data ?
    }
    if (songdata.artist === 'UNKNOWN') {
        logger.debug(songdata, "updateSong UNKNOWN artist");
    }
    const album = await albums.upsertAlbum(songdata.album, songdata.artist, songdata.year, songdata.genre);
    const song = await songs.upsertSong(songdata.title, songdata.trackNumber, songdata.discNumber, album.album_id);
    logger.trace(song, "updateSong SONG:");
    const file = await files.upsertFile(song.song_id, songdata.basedir, songdata.filepath, songdata.filename, songdata.modified, fileinfo.bitrate);
    if (songdata.cover) {
        await albums.upsertCover(song.album_id, songdata.cover);
    }
    return file;
}

/////////////////////////////////////////////////////////////////

async function getUser(user, pwd) {
    const pwdhash = crypto.createHash('sha256').update(pwd).digest('hex');
    return await users.getUser(user, pwdhash);
}

async function savePassword(userid, pwd) {
    const pwdhash = crypto.createHash('sha256').update(pwd).digest('hex');
    return await users.savePassword(userid, pwdhash);
}

/////////////////////////////////////////////////////////////////

// oltre questa durata un job 'running' si considera orfano (pod morto): largo, perché un
// fullscan di una libreria grande via API può durare a lungo
const STALE_JOB_HOURS = 6;
// storico dei job completati: oltre questi mesi i job 'done' vengono cancellati
const PURGE_JOB_MONTHS = 2;
// tabella logs (errori DB + eventi CLIENT della UI): oltre questi mesi le righe si cancellano
const PURGE_LOG_MONTHS = 3;

async function claimNextJob() {
    // pulizia dello storico (i job in error restano, si rimuovono a mano dalla pagina Jobs)
    // e dei log vecchi. È solo manutenzione: se fallisce (errore già loggato dal model) il claim prosegue
    try {
        const purged = await jobs.purgeOldJobs(PURGE_JOB_MONTHS);
        if (purged > 0) {
            logger.info(`claimNextJob: purged ${purged} done jobs older than ${PURGE_JOB_MONTHS} months`);
        }
    }
    catch (err) {
        logger.error(err, 'claimNextJob: purgeOldJobs failed');
    }
    try {
        const purged = await logs.purgeOldLogs(PURGE_LOG_MONTHS);
        if (purged > 0) {
            logger.info(`claimNextJob: purged ${purged} logs older than ${PURGE_LOG_MONTHS} months`);
        }
    }
    catch (err) {
        logger.error(err, 'claimNextJob: purgeOldLogs failed');
    }

    // prima del claim: chiude i job orfani e li ri-accoda (when=now). Senza re-accodamento
    // un filescan orfano fermerebbe la cadenza cron (il requeue lo fa il pod a fine job) e
    // un id3write lascerebbe le righe user_id3 pending senza nessun job che le scriva
    const stale = await jobs.reapStaleJobs(STALE_JOB_HOURS);
    for (const job of stale) {
        logger.warn(`claimNextJob: stale job [${job.job_id}] ${job.name} closed as error, requeued`);
        await jobs.upsertPendingJob(job.name, new Date());
    }
    return await jobs.claimNextJob();
}

/////////////////////////////////////////////////////////////////

// Save dell'editor album: write-through sul DB (stato desiderato, subito coerente
// per editor e Collection) + coda user_id3 per il job id3write che scriverà i file.
// Il riferimento resta sulla CHIAVE: il rename aggiorna la riga in-place e album_id
// non cambia mai nel caso comune. La convergenza con lo scan è garantita comunque:
// al rescan upsertAlbum trova per (title, artist_id) proprio la riga rinominata.
// Solo se il rename coincide con un ALTRO album esistente si fa il merge (move).
//
// Tutto in UNA transazione: un errore a metà (vincolo violato, DB giù) fa rollback
// completo invece di lasciare album aggiornato e tracce no.
async function saveAlbumTags(album_id, meta, tracks) {
    // titoli uguali tra le tracce inviate violerebbero UNIQUE(title, album_id): 409 parlante
    const dupes = duplicateValues(tracks.map((t) => t.title).filter((t) => t != null));
    if (dupes.length > 0) {
        const err = new Error(`Più tracce con lo stesso titolo: ${dupes.join(', ')}`);
        err.code = 'DUPLICATE_TRACK_TITLES';
        throw err;
    }
    return await pool.transaction(() => _saveAlbumTags(album_id, meta, tracks));
}

function duplicateValues(values) {
    const seen = new Set();
    const dupes = new Set();
    for (const v of values) {
        if (seen.has(v)) {
            dupes.add(v);
        }
        seen.add(v);
    }
    return [...dupes];
}

async function _saveAlbumTags(album_id, meta, tracks) {
    const UNKNOWN = 'UNKNOWN';
    // albums ha title/genre NOT NULL e year NOT NULL: stessi default dello scan
    const title = meta.album || UNKNOWN;
    const year  = meta.year  || 1900;
    const genre = meta.genre || UNKNOWN;
    const artist = await artists.upsertArtist(meta.artist || UNKNOWN);

    let albumId = Number(album_id);
    const oldAlbum = await albums.getAlbum(albumId);
    const target = await albums.findAlbum(title, artist.artist_id);
    if (!target || target.album_id === albumId) {
        // caso comune (anche rename): update in-place per chiave
        await albums.updateAlbumById(albumId, title, artist.artist_id, year, genre);
        if (oldAlbum && oldAlbum.artist_id !== artist.artist_id) {
            // rename artista: il vecchio artist row può essere rimasto senza album
            await albums.clearEmptyAlbums();
        }
    }
    else {
        // merge: (title, artist) è un altro album esistente → porta dietro cover e MBID,
        // sposta le tracce, ripulisci gli orfani, poi applica year/genre del form.
        // Tracce omonime nei due album violerebbero UNIQUE(title, album_id) al move:
        // check preventivo PRIMA di ogni mutazione → 409 parlante, niente stato a metà
        const dupes = await songs.getDuplicateTitles(albumId, target.album_id);
        if (dupes.length > 0) {
            const err = new Error(`Esiste già l'album "${title}" di ${artist.name} e contiene tracce omonime: ${dupes.join(', ')}`);
            err.code = 'MERGE_DUPLICATE_TITLES';
            throw err;
        }
        const cover = await albums.getCover(albumId);
        if (cover) { await albums.upsertCover(target.album_id, cover); }
        if (oldAlbum?.mb_release_group_id) { await albums.setReleaseGroup(target.album_id, oldAlbum.mb_release_group_id); }
        await songs.moveSongs(albumId, target.album_id);
        await albums.clearEmptyAlbums();
        albumId = target.album_id;
        await albums.updateAlbumById(albumId, title, artist.artist_id, year, genre);
    }
    // campo vuoto (null) nel form = resta il valore attuale: title/track_nr/disc_nr sono NOT NULL
    const current = new Map();
    for (const s of await songs.getSongs({ albumid: albumId })) {
        current.set(s.song_id, s);
    }
    const final = tracks.map((track) => {
        const row = current.get(track.song_id);
        return {
            song_id:  track.song_id,
            oldTitle: row?.title,
            title:    track.title    ?? row?.title,
            track_nr: track.track_nr ?? row?.track_nr,
            disc_nr:  track.disc_nr  ?? row?.disc_nr,
        };
    });
    // titoli in due passate: quelli che cambiano passano prima da un valore temporaneo
    // unico, così uno scambio (A→"Bar", B→"Foo") non viola UNIQUE(title, album_id) a metà
    for (const f of final) {
        if (f.title !== f.oldTitle) {
            await songs.updateSongFields(f.song_id, `__rename_tmp__${f.song_id}`, f.track_nr, f.disc_nr);
        }
    }
    for (const f of final) {
        await songs.updateSongFields(f.song_id, f.title, f.track_nr, f.disc_nr);
    }
    for (const track of tracks) {
        // in user_id3 i NULL significano "non scrivere quel frame": passa i valori grezzi
        await user_id3.upsertUserTag(track.song_id, {
            title:    track.title    ?? null,
            album:    meta.album     ?? null,
            artist:   meta.artist    ?? null,
            year:     meta.year      ?? null,
            genre:    meta.genre     ?? null,
            track_nr: track.track_nr ?? null,
            disc_nr:  track.disc_nr  ?? null,
        });
    }
    return albumId;
}

/////////////////////////////////////////////////////////////////
// Le funzioni senza logica propria sono quelle dei model, esportate così come sono
module.exports = {
    // web
    getCollection: albums.getCollection,
    setFavorite: favorites.setFavorite,
    saveClientLogs: logs.createLogs, // eventi della UI (player): righe "CLIENT <evento>" nella tabella logs
    getSources: sources.getSources,
    getCover: albums.getCover,
    getSongs: songs.getSongs,
    getSongInfo,
    stats: fullStats,
    updateSongStats: songstats.touchPlayed,
    // filescan / libcheck
    getFiles: files.getFiles,
    getFilesWithTags: files.getFilesWithTags,
    removeFile: files.removeFile,
    updateSong,
    clearEmptyAlbums: albums.clearEmptyAlbums,
    // parameters, users
    getParameters: pars.getParameters,
    saveParameters: pars.saveParameters,
    getUser,
    savePassword,
    // sessioni web (store di @fastify/session, vedi sessionStore.js)
    getSession: sessions.getSession,
    setSession: sessions.setSession,
    deleteSession: sessions.deleteSession,
    deleteExpiredSessions: sessions.deleteExpiredSessions,
    // jobs
    deleteJob: jobs.deleteJob,
    getJobs: jobs.getJobs,
    claimNextJob,
    updateJobStatus: jobs.updateJobStatus,
    upsertPendingJob: jobs.upsertPendingJob,
    setJobReport: jobs.setJobReport,
    getJobReport: jobs.getJobReport,
    // user id3
    saveAlbumTags,
    getPendingTags: user_id3.getPendingTags,
    setAlbumCover: user_id3.setAlbumCover,
    setReleaseGroup: albums.setReleaseGroup,
    deleteUserTag: user_id3.deleteUserTag,
    setUserTagError: user_id3.setUserTagError,
}
