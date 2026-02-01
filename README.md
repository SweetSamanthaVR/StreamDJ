# StreamDJ - Streaming Audio DJ Toolkit

StreamDJ is a local streaming toolkit that scans a music library, streams audio to FFmpeg with a real-time overlay, and provides HTTP APIs plus a web UI for playback control and stream status.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue)](https://www.typescriptlang.org/)

## Features

- 🎵 **Music Library Scanning** - Automatically scans MP3 files and extracts metadata
- 🔀 **Playback Controls** - Shuffle playback with next/previous/pause/resume
- 📡 **TCP Audio Pipeline** - Streams decoded audio from player to server
- 🎥 **FFmpeg Encoding** - Real-time overlay text rendered into the video stream
- 🖼️ **Background Management** - Switch image/video backgrounds and upload images
- 🌐 **Web UI Control Panel** - Live status, playlist, and overlay style editor
- 🩺 **Health & Diagnostics** - Status, health, and diagnostics endpoints
- 🔄 **Auto-Recovery** - FFmpeg crash recovery with backoff

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create env file
cp .env.sample .env

# 3. Update .env with RTMP_URL, STREAM_KEY, and MUSIC_DIR (e.g., ./media/music)

# 4. Build the Web UI
npm run build:webui

# 5. Start the server (Terminal 1)
npm start

# 6. Start the player (Terminal 2)
npm run start:player

# 7. Start the Web UI (Terminal 3)
npm run start:webui

# 8. Open in browser
# http://localhost:8080
```

**First-time setup**: Ensure FFmpeg is installed and available in your PATH.

## System Requirements

- **Node.js** 18.0.0 or higher (global `fetch` required)
- **FFmpeg** installed and available in PATH
- **RTMP Endpoint** and **Stream Key** for your streaming service
- **Ports**: 5000/TCP (audio ingest), 4000/HTTP (server API), 3000/HTTP (player API), 8080/HTTP (web UI)
- **Memory / Storage**: 512MB+ RAM (1GB+ recommended). Storage depends on your music library and backgrounds; app/runtime files are ~200MB or less.
- **Operating System**: Windows, macOS, or Linux (FFmpeg supported)

## Documentation

- 📖 **Installation Guide** - See Quick Start section above
- ⚙️ **[Configuration](.env.sample)** - Environment variables template
- 🔧 **Troubleshooting** - See Known Limitations section below
- 🤝 **[Contributing](CONTRIBUTING.md)** - How to contribute
- 🔌 **[API Documentation](docs/API.md)** - Minimal HTTP API reference
- 🔒 **Security** - Local network use by default; optional API key authentication available
- 📌 **[Changelog](CHANGELOG.md)** - Version history

## Production Ready Features

StreamDJ 1.0 includes the following production-ready features:

- ✅ Music library scanning and MP3 metadata extraction
- ✅ TCP audio pipeline from player to server
- ✅ FFmpeg encoding with real-time text overlay
- ✅ Background image/video management
- ✅ Web UI control panel with live status
- ✅ Health and diagnostics endpoints
- ✅ FFmpeg crash recovery with exponential backoff
- ✅ Configurable overlay styling

## Security

### Network Binding (Localhost by Default)

All HTTP services bind to **localhost (127.0.0.1)** by default for security:

| Service    | Default Host | Environment Variable |
| ---------- | ------------ | -------------------- |
| Server API | 127.0.0.1    | `HTTP_HOST`          |
| Player API | 127.0.0.1    | `PLAYER_API_HOST`    |
| Web UI     | 127.0.0.1    | `WEBUI_HOST`         |

To expose services to the network, explicitly set the host to `0.0.0.0` in your `.env` file:

```bash
HTTP_HOST=0.0.0.0
PLAYER_API_HOST=0.0.0.0
WEBUI_HOST=0.0.0.0
```

⚠️ **Warning:** Only expose to the network on trusted networks or enable authentication.

### Authentication

StreamDJ supports two authentication methods. Choose the one that fits your needs:

#### Option 1: Password Login (Recommended)

The simplest way to secure your Web UI. Set credentials and you're done!

1. Add this to your `.env` file:

   ```bash
   STREAMDJ_USERNAME=admin
   STREAMDJ_PASSWORD=your-password-here
   ```

   > **Note:** Username is optional. If you only set `STREAMDJ_PASSWORD`, the login page will only ask for a password.

2. Restart the Web UI (`npm run start:webui`)

**That's it!** You'll now see a login page when you open the Web UI. A "Sign Out" button appears in the top-right corner once logged in.

**Need to generate a secure password?** Run one of these commands:

```bash
# Windows PowerShell
[Convert]::ToBase64String((1..16 | ForEach-Object { Get-Random -Max 256 }))

# Linux/macOS
openssl rand -base64 16

# Node.js (any platform)
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
```

**Security features:**

- ✅ Passwords are compared using constant-time comparison (prevents timing attacks)
- ✅ Sessions use secure httpOnly cookies
- ✅ Rate limiting: 5 failed attempts = 15 minute lockout
- ✅ No passwords are ever logged

#### Option 2: API Key (For Developers)

Use this if you need programmatic access to the API endpoints (scripts, automation, etc.).

1. Add this to your `.env` file:

   ```bash
   STREAMDJ_API_KEY=your-secret-key-here
   ```

2. Restart all StreamDJ processes

3. Include the key in your API requests:
   ```bash
   curl -H "Authorization: Bearer your-secret-key-here" http://localhost:4000/status
   ```

**Generate a secure API key:**

```bash
# Linux/macOS
openssl rand -hex 32

# Node.js (any platform)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You can use **both** options together - password protects the Web UI, API key protects programmatic access.

**Note:** The `/health` endpoint is always accessible without authentication for monitoring purposes.

## Known Limitations

- **Authentication Optional**: Auth is disabled by default. Enable it when exposing to the network.
- **No Docker Support**: Containerized deployment is not currently supported.
- **Single Player Only**: Multi-player setups are not supported.
- **No Playlist Persistence**: Playlists reset on player restart.
- **Large Libraries**: Initial scan may take time for libraries with thousands of files.
- **FFmpeg Required**: FFmpeg must be installed and in PATH; not bundled with StreamDJ.
- **No API Rate Limiting**: API endpoints have no rate limiting or throttling.

## Default Ports

| Component       | Port | Protocol | Purpose                                   |
| --------------- | ---- | -------- | ----------------------------------------- |
| Player → Server | 5000 | TCP      | Audio ingestion from player to server     |
| Server HTTP     | 4000 | HTTP     | Metadata, background, status, diagnostics |
| Player HTTP     | 3000 | HTTP     | Playback control and playlist access      |
| Web UI          | 8080 | HTTP     | Control dashboard                         |

## Components

StreamDJ runs as three coordinated processes:

- **Player (`player.js`)** - Scans the music library, decodes MP3 audio, and exposes control APIs
- **Server (`server.js`)** - Receives audio over TCP, encodes via FFmpeg, and streams to RTMP
- **Web UI (`webui.ts`)** - Renders the control panel and proxies limited actions to the APIs

## Project Structure

```
StreamDJ/
├── src/                        # Source code
│   ├── server.js              # Main server orchestrator
│   ├── player.js              # Main player orchestrator
│   ├── lib/                   # Shared utilities and services
│   ├── server/                # Server submodules
│   │   ├── background-manager.js
│   │   ├── ffmpeg-manager.js
│   │   ├── http-api.js
│   │   └── ...
│   └── player/                # Player submodules
│       ├── audio-socket.js
│       ├── http-api.js
│       ├── music-scanner.js
│       └── ...
├── webui.ts                   # Web UI server (TypeScript source)
├── dist/                      # Compiled Web UI output (generated)
├── config/                    # Default overlay configuration
├── data/                      # Runtime data (gitignored)
├── views/                     # EJS templates
├── media/
│   ├── stream-backgrounds/     # Background assets
│   └── music/                 # Music library (gitignored)
├── types/                     # TypeScript definitions
├── .env.sample                # Environment template
├── CONTRIBUTING.md            # Contribution guidelines
├── LICENSE                    # MIT License
└── README.md                  # This file
```

## Common Commands

```bash
# Build
npm run build           # Compile TypeScript
npm run build:webui     # Compile Web UI TypeScript

# Run
npm start               # Start server
npm run start:player    # Start player
npm run start:webui     # Start Web UI (compiled)
npm run dev:webui       # Start Web UI (ts-node)

# Quality
npm run lint            # Lint JavaScript
npm run lint:fix        # Lint and fix
npm run format          # Format code
npm run format:check    # Check formatting
```

## Technology Stack

- **Runtime**: Node.js (CommonJS)
- **Server**: Express, Helmet
- **Templates**: EJS
- **Streaming**: FFmpeg (RTMP output)
- **Metadata**: music-metadata
- **File Watching**: chokidar
- **Uploads**: multer
- **Web UI**: TypeScript

## Quick Links

- **Web UI**: http://localhost:8080
- **Server Status**: http://localhost:4000/status
- **Server Health**: http://localhost:4000/health
- **Player Status**: http://localhost:3000/status

## Screenshots

### Web UI - Control Panel

_Not documented yet_

### Overlay Style Editor

_Not documented yet_

### Diagnostics View

_Not documented yet_

## Support

- 📋 **Issues**: https://github.com/SweetSamanthaVR/StreamDJ/issues
- 💬 **Discussions**: https://github.com/SweetSamanthaVR/StreamDJ/discussions
- 🐛 **Found a bug?** Open an issue
- 💡 **Feature idea?** Open a feature request

## Contributing

Want to help? Awesome! Check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Quick steps:**

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## Disclaimer

StreamDJ is provided as-is for local streaming use. Users are responsible for:

- Installing and maintaining FFmpeg on their system
- Securing their RTMP endpoint and stream key
- Enabling API key authentication when exposing services to untrusted networks
- Complying with applicable copyright and streaming service agreements

This project is not affiliated with or endorsed by any streaming platforms or services.

---

**Version:** 1.0.0  
**Last Updated:** January 31, 2026
