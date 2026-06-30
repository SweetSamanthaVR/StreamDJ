# StreamDJ

A local toolkit for running an unattended music stream: it scans a folder of MP3s, decodes and pipes the audio to FFmpeg with a live text overlay burnt in, and gives you a web UI to control playback and watch the stream's health.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue)](https://www.typescriptlang.org/)

## What it does

- Scans your music library and pulls metadata out of the MP3 tags
- Shuffles playback, with next/previous/pause/resume from the control panel
- Streams decoded audio from the player to the server over a local TCP socket
- Encodes with FFmpeg and burns a configurable text overlay into the video
- Lets you swap backgrounds (image or video) and upload new ones on the fly
- Ships a web UI with live status, the playlist, and an overlay style editor
- Exposes health and diagnostics endpoints so you can keep an eye on it
- Restarts FFmpeg itself with backoff if it falls over

It runs as three separate processes: player, server, web UI, talking to each other over localhost. More on that below.

## Getting started

```bash
# install dependencies
npm install

# copy the env template and fill it in
cp .env.sample .env
# set RTMP_URL, STREAM_KEY, and MUSIC_DIR (e.g. ./media/music)

# build the web UI
npm run build:webui

# three terminals:
npm start               # server
npm run start:player    # player
npm run start:webui     # web UI

# then open http://localhost:8080
```

You'll need FFmpeg on your PATH before any of this works.

## What you need

- **Node.js** 18 or newer (it uses the global `fetch`)
- **FFmpeg**, installed and on PATH
- An **RTMP endpoint and stream key** from wherever you're streaming to
- These ports free: 5000/TCP (audio ingest), 4000/HTTP (server API), 3000/HTTP (player API), 8080/HTTP (web UI)
- 512MB RAM at a minimum, 1GB+ is more comfortable. The app itself is small; storage is really down to your music and background files
- Windows, macOS or Linux, anywhere FFmpeg runs

## The pieces

- **Player** (`player.js`): scans the library, decodes MP3s, exposes playback control over HTTP
- **Server** (`server.js`): takes audio over TCP, runs it through FFmpeg, pushes it out to RTMP
- **Web UI** (`webui.ts`): the control panel, proxying a limited set of actions through to the other two

## Security

### Everything binds to localhost by default

| Service    | Default host | Override          |
| ---------- | ------------ | ------------------ |
| Server API | 127.0.0.1    | `HTTP_HOST`         |
| Player API | 127.0.0.1    | `PLAYER_API_HOST`   |
| Web UI     | 127.0.0.1    | `WEBUI_HOST`         |

If you want any of it reachable from the network, set the relevant host to `0.0.0.0` in `.env`:

```bash
HTTP_HOST=0.0.0.0
PLAYER_API_HOST=0.0.0.0
WEBUI_HOST=0.0.0.0
```

Only do this on a network you trust, or with authentication switched on, there isn't any by default.

### Authentication

Two ways to lock it down, and you can run both at once.

**Password login**, for the web UI. Add to `.env`:

```bash
STREAMDJ_USERNAME=admin
STREAMDJ_PASSWORD=your-password-here
```

Username is optional, leave it out and the login page just asks for a password. Restart the web UI and you'll see a login screen, with a sign-out button once you're in.

Need a password? Any of these will do:

```bash
# Windows PowerShell
[Convert]::ToBase64String((1..16 | ForEach-Object { Get-Random -Max 256 }))

# Linux/macOS
openssl rand -base64 16

# Node.js, any platform
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
```

Passwords are checked with a constant-time comparison, sessions use secure httpOnly cookies, five failed attempts buys a 15-minute lockout, and nothing gets logged.

**API key**, if you're scripting against the endpoints. Add to `.env`:

```bash
STREAMDJ_API_KEY=your-secret-key-here
```

Restart everything, then send it as a bearer token:

```bash
curl -H "Authorization: Bearer your-secret-key-here" http://localhost:4000/status
```

Generate one with:

```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`/health` is always open, regardless of auth, so monitoring tools can poll it.

## Worth knowing before you rely on this

- Auth is off unless you turn it on, do that before exposing anything to a network
- No Docker image yet
- One player at a time; no multi-player setups
- Playlists aren't persisted, restart the player and you start fresh
- A library with a few thousand files will take a moment to scan on first run
- FFmpeg isn't bundled, you have to install it yourself
- No rate limiting on the API endpoints

## Ports

| Component       | Port | Protocol | Purpose                                   |
| ---------------- | ---- | -------- | ------------------------------------------ |
| Player → Server  | 5000 | TCP      | Audio handed off from player to server      |
| Server HTTP      | 4000 | HTTP     | Metadata, backgrounds, status, diagnostics  |
| Player HTTP      | 3000 | HTTP     | Playback control, playlist                  |
| Web UI           | 8080 | HTTP     | The control panel                           |

## Layout

```
StreamDJ/
├── src/                        # source
│   ├── server.js                # server orchestrator
│   ├── player.js                # player orchestrator
│   ├── lib/                     # shared utilities
│   ├── server/                  # server submodules
│   │   ├── background-manager.js
│   │   ├── ffmpeg-manager.js
│   │   ├── http-api.js
│   │   └── ...
│   └── player/                  # player submodules
│       ├── audio-socket.js
│       ├── http-api.js
│       ├── music-scanner.js
│       └── ...
├── webui.ts                    # web UI server (TypeScript)
├── dist/                       # compiled web UI (generated)
├── config/                     # default overlay config
├── data/                       # runtime data (gitignored)
├── views/                      # EJS templates
├── media/
│   ├── stream-backgrounds/     # background assets
│   └── music/                  # your music (gitignored)
├── types/                      # TypeScript definitions
├── .env.sample
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Commands

```bash
# build
npm run build           # compile TypeScript
npm run build:webui     # compile the web UI

# run
npm start                # server
npm run start:player     # player
npm run start:webui      # web UI (compiled)
npm run dev:webui        # web UI via ts-node

# quality
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## Stack

Node (CommonJS) on the server side, Express and Helmet, EJS for templates, FFmpeg doing the actual encoding to RTMP, `music-metadata` for tags, `chokidar` watching files, `multer` handling uploads, and TypeScript for the web UI.

## Once it's running

- Web UI: http://localhost:8080
- Server status: http://localhost:4000/status
- Server health: http://localhost:4000/health
- Player status: http://localhost:3000/status

## Contributing

Pull requests welcome. Fork it, branch off, make your change, test it properly, and send it over. See [CONTRIBUTING.md](CONTRIBUTING.md) for the details.

## Issues

Found a bug or want to suggest something? Open an issue or start a discussion:

- https://github.com/SweetSamanthaVR/StreamDJ/issues
- https://github.com/SweetSamanthaVR/StreamDJ/discussions

## Licence

MIT, see [LICENSE](LICENSE).

## Disclaimer

You're responsible for installing and keeping FFmpeg up to date, for securing your own RTMP endpoint and stream key, for switching on authentication if you expose this beyond your own machine, and for staying on the right side of copyright and your streaming service's terms. StreamDJ isn't affiliated with or endorsed by any streaming platform.

---

**Version:** 1.0.0
