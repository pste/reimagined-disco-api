const path = require('path');
const artists = require('./dbmodels/artists');
const albums = require('./dbmodels/albums');
const songs = require('./dbmodels/songs');
const files = require('./dbmodels/files');
const sources = require('./dbmodels/sources');
const pars = require('./dbmodels/parameters');
const users = require('./dbmodels/users');

const logger = require('./logger');
const utils = require('./utils');
// const { getSources } = require('./dbmodels/sources');

/////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////

async function _getAlbumInfo(album_id) {
    const album = await albums.getAlbum(album_id);
    const cover = await albums.getCover(album_id);
    const artist = await artists.getArtist(album.artist_id);

    const data = {
        album_id,
		artist: artist.name,
		album: album.title,
		year: album.year,
		genre: album.genre,
        cover: cover?.imagedata
    }
    return data;
}

/////////////////////////////////////////////////////////////////

// library page
async function getCollection() {
    let data = [];
    data = await albums.getCollection();
    return data;
}
async function getCollectionOrig() {
    let data = [];
    data = await artists.getArtists();
    data = await Promise.all(
        data.map( async(el) => {
            const cover = await artists.getCover(el.artist_id)
            el.cover = cover.imagedata;
            return el;
        })
    );
    return data;
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
    if (params.albumid) {
        logger.trace('getAlbum');
        data = [{album_id: params.albumid}]; // prepare a fake array of albums; no db needed
    }
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
async function stats() {
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
async function getFiles() {
    return await files.getFiles();
}

// filescan
async function removeFile() {
    return await files.removeFile();
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
        logger.debug(songdata);
    }
    const album = await albums.upsertAlbum(songdata.album, songdata.artist, songdata.year, songdata.genre);
    const song = await songs.upsertSong(songdata.title, songdata.trackNumber, songdata.discNumber, album.album_id);
    logger.trace(song)
    const file = await files.upsertFile(song.song_id, songdata.basedir, songdata.filepath, songdata.filename, songdata.modified);
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

async function getUser(user, pwd) {
    return await users.getUser(user, pwd);
}

/////////////////////////////////////////////////////////////////
module.exports = {
    // web
    getCollection,
    getSources: sources.getSources,
    getCover,
   // getArtists,
    getAlbums,
    getSongs,
    getSongInfo,
    stats,
    // filescan:
    getFiles,
    removeFile,
    updateSong,
    clearEmptyAlbums,
    // generic:
    getParameters,
    getUser,
}