# Contributing to StreamDJ

Thank you for your interest in contributing to StreamDJ! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct: be respectful, inclusive, and constructive in all interactions.

## How to Contribute

### Reporting Bugs

Before reporting a bug, please:

1. Search existing [issues](https://github.com/SweetSamanthaVR/StreamDJ/issues) to avoid duplicates
2. Verify the bug with the latest version
3. Collect relevant information:
   - Operating system and version
   - Node.js version (`node --version`)
   - FFmpeg version (`ffmpeg -version`)
   - Relevant log output

When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs **actual behavior**
- **Environment details** (OS, Node.js, FFmpeg versions)
- **Log output** if applicable (redact any sensitive information)

### Suggesting Features

Feature requests are welcome! Please:

1. Check existing issues for similar suggestions
2. Provide a clear description of the feature
3. Explain the use case and benefits
4. Consider implementation complexity

### Pull Requests

#### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/StreamDJ.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `npm install`
5. Make your changes
6. Test thoroughly
7. Commit with clear messages
8. Push and create a pull request

#### Development Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.sample .env

# Edit .env with your configuration
# At minimum, set RTMP_URL, STREAM_KEY, and MUSIC_DIR (e.g., ./media/music)

# Run in development mode
# Terminal 1: Start server
npm start

# Terminal 2: Start player
npm run start:player

# Terminal 3: Start WebUI (development)
npm run dev:webui
```

#### Code Style

- Follow the existing code style
- Run linting before committing: `npm run lint`
- Format code with Prettier: `npm run format`
- Use meaningful variable and function names
- Add JSDoc comments for public functions
- Keep functions focused and reasonably sized

#### Commit Messages

Follow conventional commit format:

```
type(scope): brief description

Longer description if needed.

Fixes #123
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:

- `feat(player): add track queue management`
- `fix(server): handle FFmpeg crash during startup`
- `docs(readme): update installation instructions`

#### Testing

- Test your changes manually with all three components running
- Verify the web UI functions correctly
- Check that streams work with your target RTMP endpoint
- Test edge cases (no music files, disconnected server, etc.)

### Code Review Process

1. A maintainer will review your PR
2. Feedback may be provided for improvements
3. Once approved, the PR will be merged
4. Your contribution will be credited in the changelog

## Project Structure

```
StreamDJ/
├── src/
│   ├── server.js       # Server orchestrator (thin bootstrap module)
│   ├── server/         # Server submodules
│   │   ├── index.js            # Module re-exports
│   │   ├── constants.js        # Audio/video encoding constants
│   │   ├── overlay-renderer.js # Text overlay and drawtext filter
│   │   ├── background-manager.js   # Background image/video management
│   │   ├── silence-generator.js    # Silence audio generation
│   │   ├── tcp-server.js       # TCP server for audio ingestion
│   │   ├── ffmpeg-manager.js   # FFmpeg process lifecycle
│   │   └── http-routes.js      # Express API endpoints
│   ├── player.js       # Player orchestrator (thin bootstrap module)
│   ├── player/         # Player submodules
│   │   ├── index.js            # Module re-exports
│   │   ├── playlist-manager.js # Track loading, metadata, shuffle
│   │   ├── playback-controller.js  # FFmpeg process, play/pause/skip
│   │   ├── audio-socket.js     # TCP connection management
│   │   └── http-api.js         # Express API endpoints
│   └── lib/
│       ├── config/
│       │   └── index.js        # Shared configuration
│       ├── utils/
│       │   ├── env.js          # Environment variable helpers
│       │   ├── errors.js       # Error handling utilities
│       │   └── logger.js       # Logging utilities
│       └── services/
│           ├── diagnostics.js  # Diagnostics utilities
│           ├── ffmpeg.js       # FFmpeg utilities
│           └── overlayStyleStore.js  # Overlay style persistence
├── public/             # Static assets served by webui.ts
│   ├── css/            # Stylesheets
│   ├── js/             # Client-side JavaScript
│   └── images/         # Image assets
├── webui.ts            # Web interface server (TypeScript)
├── types/
│   └── logger.d.ts     # TypeScript type definitions
├── views/
│   └── webui.ejs       # Web UI template
├── config/
│   └── default-ffmpeg-overlay.json  # Default overlay settings
└── data/               # Runtime data (user-specific, gitignored)
```

## Areas for Contribution

Current priorities:

- **Documentation**: Improve guides, add examples
- **Testing**: Add automated tests
- **Docker**: Containerization support
- **Performance**: Optimize encoding, reduce CPU usage
- **Features**: See issues labeled `enhancement`

## Questions?

- Open a [discussion](https://github.com/SweetSamanthaVR/StreamDJ/discussions)
- Check existing issues and documentation
- Tag your issue with `question` if needed

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to StreamDJ! 🎵
