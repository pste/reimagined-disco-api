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

const logger = require('./logger');
const utils = require('./utils');
// const { getSources } = require('./dbmodels/sources');

/////////////////////////////////////////////////////////////////

// no cover here on purpose: this runs in hot paths (/chunk/song, /stream/song, /scan/song/:id)
// and covers are served separately by /search/cover
async function _getAlbumInfo(album_id) {
    const album = await albums.getAlbum(album_id);
    const artist = await artists.getArtist(album.artist_id);

    const data = {
        album_id,
		artist: artist.name,
		album: album.title,
		year: album.year,
		genre: album.genre,
    }
    return data;
}

/////////////////////////////////////////////////////////////////

// library page
async function getCollection(user_id) {
    let data = [];
    data = await albums.getCollection(user_id);
    return data;
}

async function setFavorite(user_id, album_id, favorite) {
    return await favorites.setFavorite(user_id, album_id, favorite);
}

async function getFavorites(user_id) {
    return await favorites.getFavorites(user_id);
}

async function getCover(album_id) {
    let data = [];
    data = await albums.getCover(album_id);
    return data;
}

// artist page
async function getAlbums(params) {
    // get a list of albums
    let data = [];
    if (params.artistid) {
        logger.trace('getAlbumsByArtist');
        data = await albums.getAlbumsByArtist(params.artistid);
    }
    else { //default to this
        logger.trace('getAlbumsByTitle');
        data = await albums.getAlbumsByTitle(params.title);
    }
    // normalize output
    data = await Promise.all(
        data.map(async (el) => {
            return await _getAlbumInfo(el.album_id);
        })
    );
    return data;
}

// album page
async function getSongs(params) {
    return await songs.getSongs(params);
}

// song details page
async function getSongInfo(song_id) {
    const file = await songs.getSongFile(song_id);
    const song = await songs.getSong(song_id);
    const albumdata = await _getAlbumInfo(song.album_id);

    const data = {
        song_id,
        sourcepath: file.source_path,
        filepath: file.file_path, 
        filename: file.file_name,
        fullpath: path.join(file.source_path, file.file_path, file.file_name),
        modified: file.modified,
        title: song.title,
		trackNumber: song.track_nr,
		discNumber: song.disc_nr,
    }
    return Object.assign(albumdata, data);
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

//
async function updateSongStats(user_id, song_id) {
    return await songstats.touchPlayed(user_id, song_id);
}

/////////////////////////////////////////////////////////////////

// filescan
async function getFiles() {
    return await files.getFiles();
}

// filescan
async function removeFile(song_id) {
    return await files.removeFile(song_id);
}

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
		discNumber: utils.parseAlbumNumber(fileinfo.tags.partOfSet) || 1,
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

// filescan 
async function clearEmptyAlbums() {
    return await albums.clearEmptyAlbums();
}

/////////////////////////////////////////////////////////////////

async function getParameters() {
    return await pars.getParameters();
}

async function saveParameters(cronRequeue, cacheTTLDays, favCacheTTLDays) {
    return await pars.saveParameters(cronRequeue, cacheTTLDays, favCacheTTLDays);
}

async function getUser(user, pwd) {
    const pwdhash = crypto.createHash('sha256').update(pwd).digest('hex');
    return await users.getUser(user, pwdhash);
}

async function savePassword(userid, pwd) {
    const pwdhash = crypto.createHash('sha256').update(pwd).digest('hex');
    return await users.savePassword(userid, pwdhash);
}

/////////////////////////////////////////////////////////////////

async function deleteJob(job_id) {
    return await jobs.deleteJob(job_id);
}

async function getJobs() {
    return await jobs.getJobs();
}

async function claimNextJob() {
    return await jobs.claimNextJob();
}

async function updateJobStatus(job_id, status, result) {
    return await jobs.updateJobStatus(job_id, status, result);
}

async function upsertPendingJob(name, when) {
    return await jobs.upsertPendingJob(name, when);
}

/////////////////////////////////////////////////////////////////

async function getPendingTags() {
    return await user_id3.getPendingTags();
}

async function setAlbumCover(album_id, cover) {
    return await user_id3.setAlbumCover(album_id, cover);
}

async function setReleaseGroup(album_id, mbid) {
    return await albums.setReleaseGroup(album_id, mbid);
}

// Save dell'editor album: write-through sul DB (stato desiderato, subito coerente
// per editor e Collection) + coda user_id3 per il job id3write che scriverà i file.
// Il riferimento resta sulla CHIAVE: il rename aggiorna la riga in-place e album_id
// non cambia mai nel caso comune. La convergenza con lo scan è garantita comunque:
// al rescan upsertAlbum trova per (title, artist_id) proprio la riga rinominata.
// Solo se il rename coincide con un ALTRO album esistente si fa il merge (move).
async function saveAlbumTags(album_id, meta, tracks) {
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
    for (const track of tracks) {
        await songs.updateSongFields(track.song_id, track.title, track.track_nr, track.disc_nr);
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

async function deleteUserTag(song_id, updated_at) {
    return await user_id3.deleteUserTag(song_id, updated_at);
}

async function setUserTagError(song_id) {
    return await user_id3.setUserTagError(song_id);
}

/////////////////////////////////////////////////////////////////
module.exports = {
    // web
    getCollection,
    setFavorite,
    getFavorites,
    getSources: sources.getSources,
    getCover,
    getAlbums,
    getSongs,
    getSongInfo,
    stats: fullStats,
    // filescan:
    getFiles,
    removeFile,
    updateSong,
    clearEmptyAlbums,
    // generic:
    getParameters,
    saveParameters,
    getUser,
    savePassword,
    updateSongStats,
    // jobs
    deleteJob,
    getJobs,
    claimNextJob,
    updateJobStatus,
    upsertPendingJob,
    // user id3
    saveAlbumTags,
    getPendingTags,
    setAlbumCover,
    setReleaseGroup,
    deleteUserTag,
    setUserTagError,
}