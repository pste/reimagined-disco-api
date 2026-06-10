const logger = require('./logger');

const MB_BASE  = 'https://musicbrainz.org/ws/2';
const CAA_BASE = 'https://coverartarchive.org';

// MusicBrainz richiede uno User-Agent descrittivo con contatto reale, altrimenti blocca.
// Il contatto va passato via env MB_USER_AGENT (NON hardcodare email nel repo → finisce su GitHub).
const USER_AGENT = process.env.MB_USER_AGENT || 'reimagined-disco/1.0 ( set MB_USER_AGENT for contact )';

// MusicBrainz impone ~1 req/s: spaziamo le chiamate di poco più di un secondo.
const MB_MIN_INTERVAL = 1100;
// CAA è più permissivo, ma nel percorso lazy facciamo N chiamate: restiamo educati.
const CAA_SPACING = 200;

const JSON_TIMEOUT  = 10000;
const IMAGE_TIMEOUT = 20000;
const RETRY_TRIES   = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ritenta su errori 5xx / di rete: archive.org (dietro CAA) ogni tanto dà 502/503 transitori.
async function withRetry(fn) {
    let lastErr;
    for (let i = 0; i < RETRY_TRIES; i++) {
        try {
            return await fn();
        }
        catch(err) {
            lastErr = err;
            const transient = !err.statusCode || err.statusCode >= 500;
            if (!transient || i === RETRY_TRIES - 1) { throw err; }
            await sleep(300 * (i + 1));
        }
    }
    throw lastErr;
}

// --- MusicBrainz ----------------------------------------------------------

async function fetchJson(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(JSON_TIMEOUT),
    });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.statusCode = res.status;
        throw err;
    }
    return res.json();
}

// Serializza le chiamate a MusicBrainz e le spazia >= MB_MIN_INTERVAL.
let mbChain = Promise.resolve();
let lastMbAt = 0;

function mbFetch(url) {
    const run = mbChain.then(async () => {
        const wait = MB_MIN_INTERVAL - (Date.now() - lastMbAt);
        if (wait > 0) { await sleep(wait); }
        lastMbAt = Date.now();
        logger.trace(`MB: ${url}`);
        return withRetry(() => fetchJson(url));
    });
    mbChain = run.catch(() => {}); // la catena prosegue anche se una chiamata fallisce
    return run;
}

// Serializza e spazia le HEAD verso Cover Art Archive: la UI può sparare N /cover/front
// in parallelo (Promise.all), ma è l'API a fare il throttle, così non martelliamo CAA.
let caaChain = Promise.resolve();
let lastCaaAt = 0;

function caaThrottle(fn) {
    const run = caaChain.then(async () => {
        const wait = CAA_SPACING - (Date.now() - lastCaaAt);
        if (wait > 0) { await sleep(wait); }
        lastCaaAt = Date.now();
        return fn();
    });
    caaChain = run.catch(() => {}); // la catena prosegue anche se una chiamata fallisce
    return run;
}

function escapeLucene(s) {
    return String(s).replace(/["\\]/g, '\\$&');
}

// Cerca i release-group da artista + titolo album. Torna i top hit con i metadati per la verifica a occhio.
async function searchReleaseGroups(artist, album, limit = 5) {
    const q = `artist:"${escapeLucene(artist)}" AND releasegroup:"${escapeLucene(album)}"`;
    const url = `${MB_BASE}/release-group?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
    const data = await mbFetch(url);
    return (data['release-groups'] || []).map((g) => ({
        mbid: g.id,
        title: g.title,
        artist: g['artist-credit']?.[0]?.name,
        year: g['first-release-date']?.slice(0, 4) || null,
    }));
}

// Elenca le release di un release-group (per il percorso lazy "altre opzioni").
async function listReleaseIds(mbgid, limit = 25) {
    const url = `${MB_BASE}/release?release-group=${mbgid}&fmt=json&limit=${limit}`;
    const data = await mbFetch(url);
    return (data.releases || []).map((r) => r.id);
}

// --- Cover Art Archive ----------------------------------------------------
// Usiamo solo gli endpoint immagine diretti (front-{size}), non il JSON index.json
// che passa per archive.org ed è intermittente. front-500 è il default (vedi scelta 500px).

function frontUrls(entity, mbid) {
    const base = `${CAA_BASE}/${entity}/${mbid}`;
    return {
        thumbUrl: `${base}/front-250`,  // anteprima
        imageUrl: `${base}/front-500`,  // default 500px
        hiResUrl: `${base}/front-1200`, // opzione qualità alta
    };
}

// L'image id finale è nel nome file del redirect: mbid-<rel>-<imageId>_thumb500.jpg
function imageIdFromLocation(location) {
    const m = String(location || '').match(/-(\d+)(?:_thumb\d+)?\.[a-z]+$/i);
    return m ? m[1] : location;
}

// HEAD con redirect manuale: 307 => front esiste (Location ha l'image id), 404 => niente cover.
// Così controlliamo esistenza e dedup senza scaricare nulla e senza toccare archive.org.
async function frontHead(entity, mbid) {
    return caaThrottle(() => withRetry(async () => {
        const res = await fetch(`${CAA_BASE}/${entity}/${mbid}/front-500`, {
            method: 'HEAD',
            redirect: 'manual',
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(JSON_TIMEOUT),
        });
        if (res.status === 404) { return null; }
        if (res.status < 300 || res.status >= 400) {
            const err = new Error(`HTTP ${res.status} for ${entity}/${mbid}/front-500`);
            err.statusCode = res.status;
            throw err;
        }
        return { imageId: imageIdFromLocation(res.headers.get('location')) };
    }));
}

function candidateFor(entity, mbid, imageId, context) {
    return { source: 'coverartarchive', imageId, ...frontUrls(entity, mbid), ...context };
}

function dedup(candidates) {
    const seen = new Set();
    const out = [];
    for (const c of candidates) {
        const key = c.imageId || c.imageUrl;
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push(c);
    }
    return out;
}

// --- public API -----------------------------------------------------------

// Percorso veloce: una HEAD sul release-group (CAA sceglie una release rappresentativa con art).
async function fastFront(mbgid) {
    const head = await frontHead('release-group', mbgid);
    if (!head) { return []; }
    return [candidateFor('release-group', mbgid, head.imageId, { releaseGroupId: mbgid })];
}

// Risolve la front di UNA release (una HEAD). null se non esiste o se l'errore è transitorio:
// la paginazione lato UI deve poter saltare la singola release senza far fallire il batch.
async function frontForRelease(rid) {
    try {
        const head = await frontHead('release', rid);
        return head ? candidateFor('release', rid, head.imageId, { releaseId: rid }) : null;
    }
    catch(err) {
        logger.warn(`frontForRelease: skip ${rid}: ${err.message}`);
        return null;
    }
}

// Entrypoint del fast path usato dalla rotta: con mbid noto basta una HEAD sul gruppo;
// senza, propone una cover per OGNUNO dei top release-group della ricerca testuale,
// così un match sbagliato al primo posto non blocca la scelta (le HEAD sono comunque throttlate).
async function proposeCovers({ artist, album, mbid }) {
    const groups = mbid ? [{ mbid }] : await searchReleaseGroups(artist, album);
    if (!groups.length) { return { releaseGroupId: null, candidates: [] }; }
    const fronts = await Promise.all(groups.map(async (group) => {
        try {
            return await fastFront(group.mbid);
        }
        catch(err) {
            logger.warn(`proposeCovers: skip group ${group.mbid}: ${err.message}`);
            return [];
        }
    }));
    const candidates = [];
    groups.forEach((group, i) => {
        for (const c of fronts[i]) {
            candidates.push({
                ...c,
                album: group.title ?? album,
                artist: group.artist ?? artist,
                year: group.year ?? null,
            });
        }
    });
    const unique = dedup(candidates);
    return { releaseGroupId: unique[0]?.releaseGroupId ?? groups[0].mbid, candidates: unique };
}

// Scarica i byte dell'immagine scelta (al salvataggio). CAA risponde 307 verso archive.org: fetch segue i redirect.
async function downloadImage(url) {
    return withRetry(async () => {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            redirect: 'follow',
            signal: AbortSignal.timeout(IMAGE_TIMEOUT),
        });
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status} downloading ${url}`);
            err.statusCode = res.status;
            throw err;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type') || 'image/jpeg';
        return { buffer, mime };
    });
}

module.exports = {
    searchReleaseGroups,
    proposeCovers,
    fastFront,
    listReleaseIds,
    frontForRelease,
    downloadImage,
};
