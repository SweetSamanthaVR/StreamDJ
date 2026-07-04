# StreamDJ HTTP API

A short reference for the HTTP endpoints each StreamDJ process exposes. It sticks to the routes you are likely to call; for anything else, read the route implementations listed at the bottom.

## Authentication

If `STREAMDJ_API_KEY` is set, every endpoint except `/health` requires a valid API key. Send it in one of these headers:

- `Authorization: Bearer <api-key>`
- `X-API-Key: <api-key>`

## Base URLs (defaults)

- Server API: `http://127.0.0.1:4000`
- Player API: `http://127.0.0.1:3000`
- Web UI API (proxy): `http://127.0.0.1:8080`

Ports and hosts can be changed in `.env` (see [.env.sample](../.env.sample)).

## Server API (stream/encoding service)

Base URL: `http://127.0.0.1:4000`

### Metadata

- `POST /metadata` sends the current track metadata.
  - JSON body fields: `title`, `artist`, `album`, `comment`, `filename` (all optional)

### Backgrounds

- `POST /background` changes the background by path, or resets it.
  - JSON body: `{ "path": "relative/or/absolute/path" }`, or `{ "path": "" }` to reset
- `POST /api/backgrounds/upload` uploads a background image.
  - `multipart/form-data` field: `background`
  - Accepts images only (.png, .jpg, .jpeg, .bmp, .gif, .webp); video backgrounds can be set by path but not uploaded
- `GET /api/backgrounds` lists uploaded backgrounds.
- `DELETE /api/backgrounds/:filename` deletes an uploaded background.

### Overlay style

- `GET /overlay/style` returns the current overlay style.
- `PUT /overlay/style` updates the overlay style.
  - JSON body: a `values` object (or a flat object of style keys)
  - Optional: `version` for optimistic concurrency
- `POST /overlay/style/reset` resets the overlay style to defaults.

### Status and diagnostics

- `GET /health` is the health check (no auth required).
- `GET /status` returns a server status snapshot.
- `GET /diagnostics` returns the full diagnostics snapshot.
- `GET /diagnostics/logs?level=DEBUG&limit=1000` returns diagnostic logs.
- `GET /diagnostics/events?type=&limit=100` returns diagnostic events.
- `GET /diagnostics/restarts?limit=50` returns the restart history.
- `GET /diagnostics/export` downloads the diagnostics bundle as JSON.
- `POST /diagnostics/clear` clears the diagnostics buffers.

### FFmpeg controls

- `POST /ffmpeg/unblock` manually unblocks FFmpeg after a crash loop.

## Player API (playback service)

Base URL: `http://127.0.0.1:3000`

### Playback controls

- `GET|POST /next` skips to the next track.
- `GET|POST /previous` skips to the previous track.
- `GET|POST /pause` pauses playback.
- `GET|POST /resume` resumes playback.

### Status

- `GET /health` is the health check (no auth required).
- `GET /current` returns the current track and playback status.
- `GET /playlist` returns the full playlist.

## Web UI API (proxy and UI state)

Base URL: `http://127.0.0.1:8080`

The web UI exposes a proxy API that forwards requests to the server and player APIs. Handy if you only want to talk to a single port.

- `GET /api/state` returns the combined state (player current, playlist, server status).
- `POST /api/player/:action` proxies player actions (`next`, `previous`, `pause`, `resume`).
- `POST /api/background` proxies a background change.
- `GET /api/overlay/style` proxies the overlay style fetch.
- `PUT /api/overlay/style` proxies an overlay style update.
- `POST /api/overlay/style/reset` proxies an overlay style reset.
- `GET /api/diagnostics` proxies the diagnostics snapshot.
- `GET /api/diagnostics/logs` proxies diagnostic logs.
- `GET /api/diagnostics/events` proxies diagnostic events.
- `GET /api/diagnostics/restarts` proxies the restart history.
- `GET /api/diagnostics/export` proxies the diagnostics export.
- `POST /api/diagnostics/clear` proxies the diagnostics clear.

## Where the routes live

If you need more detail, read the route implementations:

- Server routes: `src/server/http-routes.js`
- Player routes: `src/player/http-api.js`
- Web UI proxy routes: `webui.ts`
