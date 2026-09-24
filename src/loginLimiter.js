// Limite ai tentativi di login FALLITI, in memoria (una sola replica dell'API; un riavvio
// azzera i contatori, accettabile). Due chiavi indipendenti:
// - per username: frena chi prova password a raffica su un account, anche da IP diversi.
//   Il rovescio (qualcuno può bloccare un account sbagliando apposta) dura solo WINDOW_MS
// - per IP: frena chi prova molti username dallo stesso client
// Un login riuscito azzera i contatori di quello username e di quell'IP.

const WINDOW_MS = 15 * 60 * 1000; // 15 minuti
const MAX_FAILURES_PER_USER = 10;
const MAX_FAILURES_PER_IP = 20;
const PRUNE_ABOVE = 1000; // oltre questo numero di chiavi si puliscono quelle scadute

const failures = new Map(); // chiave → { count, resetAt }

function userKey(username) {
    return `user:${String(username).toLowerCase()}`;
}

function ipKey(ip) {
    return `ip:${ip}`;
}

function activeEntry(key, now) {
    const entry = failures.get(key);
    if (entry && entry.resetAt <= now) {
        failures.delete(key);
        return null;
    }
    return entry ?? null;
}

function prune(now) {
    if (failures.size <= PRUNE_ABOVE) {
        return;
    }
    for (const [key, entry] of failures) {
        if (entry.resetAt <= now) {
            failures.delete(key);
        }
    }
}

// secondi da aspettare se il login è bloccato, 0 se si può provare
function retryAfterSecs(ip, username) {
    const now = Date.now();
    const checks = [[userKey(username), MAX_FAILURES_PER_USER], [ipKey(ip), MAX_FAILURES_PER_IP]];
    let wait = 0;
    for (const [key, max] of checks) {
        const entry = activeEntry(key, now);
        if (entry && entry.count >= max) {
            wait = Math.max(wait, Math.ceil((entry.resetAt - now) / 1000));
        }
    }
    return wait;
}

function recordFailure(ip, username) {
    const now = Date.now();
    prune(now);
    for (const key of [userKey(username), ipKey(ip)]) {
        const entry = activeEntry(key, now);
        if (entry) {
            entry.count++;
        }
        else {
            failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
        }
    }
}

function recordSuccess(ip, username) {
    failures.delete(userKey(username));
    failures.delete(ipKey(ip));
}

module.exports = {
    retryAfterSecs,
    recordFailure,
    recordSuccess,
};
