# StreamDJ HTTP API (Minimal Reference)

This document lists the main HTTP endpoints used by StreamDJ. It is intentionally minimal and focuses on the routes exposed by each process.

## Authentication

If `STREAMDJ_API_KEY` is set, all endpoints require a valid API key (except `/health`). Provide one of the following headers:

- `Authorization: Bearer <api-key>`
- `X-API-Key: <api-key>`

## Base URLs (defaults)

- **Server API**: `http://127.0.0.1:4000`
- **Player API**: `http://127.0.0.1:3000`
- **Web UI API (proxy)**: `http://127.0.0.1:8080`

Ports and hosts can be changed via `.env` (see [Configuration](../.env.sample)).

---

## Server API (stream/encoding service)

**Base URL:** `http://127.0.0.1:4000`

### Metadata

- `POST /metadata` — Send current track metadata.
  - JSON body fields: `title`, `artist`, `album`, `comment`, `filename` (all optional)

### Backgrounds

- `POST /background` — Change background by path or reset.
  - JSON body: `{ "path": "relative/or/absolute/path" }` or `{ "path": "" }` to reset
- `POST /api/backgrounds/upload` — Upload background image/video.
  - `multipart/form-data` field: `background`
- `GET /api/backgrounds` — List uploaded backgrounds.
- `DELETE /api/backgrounds/:filename` — Delete uploaded background.

### Overlay style

- `GET /overlay/style` — Get current overlay style.
- `PUT /overlay/style` — Update overlay style.
  - JSON body: `values` object (or a flat object of style keys)
  - Optional: `version` for optimistic concurrency
- `POST /overlay/style/reset` — Reset overlay style to defaults.

### Status & diagnostics

- `GET /health` — Health check (no auth required).
- `GET /status` — Server status snapshot.
- `GET /diagnostics` — Full diagnostics snapshot.
- `GET /diagnostics/logs?level=DEBUG&limit=1000` — Diagnostic logs.
- `GET /diagnostics/events?type=&limit=100` — Diagnostic events.
- `GET /diagnostics/restarts?limit=50` — Restart history.
- `GET /diagnostics/export` — Export diagnostics as JSON download.
- `POST /diagnostics/clear` — Clear diagnostics buffers.

### FFmpeg controls

- `POST /ffmpeg/unblock` — Manually unblock FFmpeg if blocked.

---

## Player API (playback service)

**Base URL:** `http://127.0.0.1:3000`

### Playback controls

- `GET|POST /next` — Skip to next track.
- `GET|POST /previous` — Skip to previous track.
- `GET|POST /pause` — Pause playback.
- `GET|POST /resume` — Resume playback.

### Status

- `GET /health` — Health check (no auth required).
- `GET /current` — Current track + playback status.
- `GET /playlist` — Full playlist.

---

## Web UI API (proxy + UI state)

**Base URL:** `http://127.0.0.1:8080`

The Web UI exposes a proxy API that forwards requests to the server/player APIs. Useful if you only want to access a single port.

- `GET /api/state` — Combined state (player current, playlist, server status).
- `POST /api/player/:action` — Proxy player actions (`next`, `previous`, `pause`, `resume`).
- `POST /api/background` — Proxy background change.
- `GET /api/overlay/style` — Proxy overlay style fetch.
- `PUT /api/overlay/style` — Proxy overlay style update.
- `POST /api/overlay/style/reset` — Proxy overlay style reset.
- `GET /api/diagnostics` — Proxy diagnostics snapshot.
- `GET /api/diagnostics/logs` — Proxy diagnostic logs.
- `GET /api/diagnostics/events` — Proxy diagnostic events.
- `GET /api/diagnostics/restarts` — Proxy restart history.
- `GET /api/diagnostics/export` — Proxy diagnostics export.
- `POST /api/diagnostics/clear` — Proxy diagnostics clear.

---

## Source of Truth

If you need more detail, see the route implementations:

- Server routes: `src/server/http-routes.js`
- Player routes: `src/player/http-api.js`
- Web UI proxy routes: `webui.ts`
