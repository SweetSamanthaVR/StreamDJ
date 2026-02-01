# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-31

### Added

- **Music Library Scanning** - Automatically scans MP3 files and extracts metadata
- **Playback Controls** - Shuffle playback with next/previous/pause/resume functionality
- **TCP Audio Pipeline** - Streams decoded audio from player to server
- **FFmpeg Encoding** - Real-time overlay text rendered into the video stream
- **Background Management** - Switch image/video backgrounds and upload images
- **Web UI Control Panel** - Live status, playlist, and overlay style editor
- **Health & Diagnostics** - Status, health, and diagnostics endpoints
- **Auto-Recovery** - FFmpeg crash recovery with exponential backoff
- **HTTP APIs** - RESTful endpoints for server, player, and web UI components
- **Graceful Shutdown** - Proper cleanup handlers for all components
- **Comprehensive Logging** - Debug and error logging throughout the application

### Technical Features

- **TypeScript Support** - Web UI written in TypeScript for type safety
- **Security Headers** - Helmet.js security middleware on all HTTP servers
- **CORS Protection** - Restrictive CORS whitelist for allowed origins
- **Input Validation** - Metadata validation with length limits and null byte protection
- **Error Handling** - Comprehensive error boundaries throughout the codebase
- **Module Organization** - Factory pattern for dependency injection and modular design
- **Configuration** - Environment-based configuration with `.env` templates
- **Secure Defaults** - Web UI binds to localhost (127.0.0.1) by default instead of all interfaces

### Documentation

- Complete README with features, quick start, and API overview
- CONTRIBUTING.md with development setup and guidelines
- Inline JSDoc comments on all exported functions
- MIT License included

### Known Limitations

- Authentication Optional: API key authentication is available but disabled by default. Enable via `STREAMDJ_API_KEY` environment variable for network-exposed deployments.
- No Docker Support: Containerized deployment not currently supported
- Single Player Only: Multi-player setups are not supported
- No Playlist Persistence: Playlists reset on player restart
- FFmpeg Required: Must be installed and in PATH; not bundled

---

For information about reporting bugs or contributing, see [CONTRIBUTING.md](CONTRIBUTING.md).
