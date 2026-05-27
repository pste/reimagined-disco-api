# Reimagined Disco API

A REST API for a music streaming web application. The API stores and streams music files, manages a library organized by artists, albums, and songs, and tracks user listening statistics.

Built with Fastify and PostgreSQL, featuring automatic file scanning to import music files with ID3 tag parsing.

## Stack

- **Framework**: Fastify (Node.js)
- **Database**: PostgreSQL
- **Session Management**: Cookie-based sessions with `@fastify/session`
- **ID3 Reading**: node-id3, music-metadata (used for `GET /api/song/id3`)

## Getting Started

```bash
# After cloning the repository: activate the hook(s)
git config core.hooksPath .githooks
```

## Build
`docker build -t reimagined-disco-api:v0.0.1 -f .docker/Dockerfile .`

## Run
`npm run dev` (development) or `npm run prod` (production)

## API Endpoints

All endpoints are prefixed with `/api`.

### Authentication (Open Routes)

| Method | Endpoint | Parameters | Response | Description |
|--------|----------|------------|----------|-------------|
| POST | `/api/login` | Body: `{ username, password }` | `{ username, user_id, authenticated: true }` | Authenticates user and creates session |
| POST | `/api/logout` | None | `{ message: 'Logout OK' }` | Destroys user session |

### Collection & Search (Authenticated Routes)

| Method | Endpoint | Parameters | Response | Description |
|--------|----------|------------|----------|-------------|
| GET | `/api/collection` | None | Array of albums with artist, year, stats | Returns full album collection with play statistics |
| GET | `/api/search/cover` | Query: `album_id` | Image data (binary) | Returns album cover image |
| GET | `/api/sources` | None | Array of source paths | Returns configured music source directories |
| GET | `/api/search/albums` | Query: `title` (optional), `artistid` (optional) | Array of albums | Search albums by title or filter by artist |
| GET | `/api/search/songs` | Query: `albumid` (optional), `title` (optional) | Array of songs | Search songs by title or filter by album |

### Streaming (Authenticated Routes)

| Method | Endpoint | Parameters | Response | Description |
|--------|----------|------------|----------|-------------|
| POST | `/api/stream/song` | Body: `{ song_id }` | `{ song_id, user_id, played, playcount }` | Updates song play statistics for current user |
| GET | `/api/stream/song` | Query: `id` (song_id) | Audio stream (1MB chunks) | Streams a song file with HTTP range support |
| GET | `/api/chunk/song` | Query: `id` (song_id), `chunkIndex` (default: 1) | Chunk 1: `{ metadata: { totalChunks, filesize, bitrate, duration }, data }` — others: `{ data }` | Streams a song file as 1MB base64-encoded chunks. First chunk includes audio metadata. |
| GET | `/api/song/id3` | Query: `id` (song_id) | `{ title, artist, album, year, genre, track, disk, bitrate }` | Returns ID3 tag data for a song |
| POST | `/api/song/id3` | Query: `id` (song_id) — Body: `{ title?, artist?, album?, year?, genre?, track?, disk? }` | `{ ok: true }` | Queues an async `id3write` job; saves edits to `user_id3` table; NULL fields are skipped when writing to file |

### Jobs (Authenticated Routes)

| Method | Endpoint | Parameters | Response | Description |
|--------|----------|------------|----------|-------------|
| GET | `/api/jobs` | None | Array of jobs | Returns all jobs (sorted by scheduled time desc) |
| POST | `/api/jobs` | Body: `{ name, when }` | Job object | Creates a new pending job |
| DELETE | `/api/jobs/:id` | Path: `id` (job_id) | `{ ok: true }` | Deletes a job |

### User Management (Authenticated Routes)

| Method | Endpoint | Parameters | Response | Description |
|--------|----------|------------|----------|-------------|
| POST | `/api/user/password` | Body: `{ value }` (new password) | Success status | Changes current user's password |

## Data Models

**Album**: `{ album_id, artist, album, year, genre, cover?, added?, played?, playcount?, stars? }`

**Song**: `{ song_id, title, trackNumber, discNumber, album_id }`

**Song Info**: `{ song_id, sourcepath, filepath, filename, fullpath, modified, title, trackNumber, discNumber, artist, album, year, genre, cover? }`

## Environment Variables

- `PORT` - Server port (default: from .env)
- `SESSION_SECRET` - Secret for session encryption
- `SESSION_TIMEOUTSECS` - Session timeout in seconds
- `DATABASE_URL` - PostgreSQL connection string
