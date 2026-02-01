'use strict';

/**
 * Playlist Manager Module
 *
 * Handles track loading, metadata parsing, playlist state management,
 * shuffle logic, and file system watching for new tracks.
 *
 * @module player/playlist-manager
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const mm = require('music-metadata');
const { createLogger } = require('../lib/utils/logger');
const { ignoreErrors } = require('../lib/utils/errors');

const { log, warn, error } = createLogger('playlist');

/**
 * @typedef {Object} TrackMetadata
 * @property {string} title - Track title
 * @property {string} artist - Artist name
 * @property {string} album - Album name
 * @property {number|null} duration - Duration in seconds
 * @property {string} filename - File name
 * @property {string} fullPath - Absolute file path
 */

/**
 * @typedef {Object} PlaylistState
 * @property {TrackMetadata[]} playlist - Array of all available tracks
 * @property {Map<string, TrackMetadata>} trackMap - Map of file path to track metadata
 * @property {number} currentIndex - Index of currently playing track
 * @property {TrackMetadata|null} currentTrack - Currently playing track metadata
 * @property {number[]} history - History of played track indices
 * @property {number[]} shuffledQueue - Shuffled track indices when shuffle mode is enabled
 * @property {boolean} shuffle - Whether shuffle mode is active
 */

/**
 * Creates a new PlaylistManager instance
 * @param {Object} options - Configuration options
 * @param {string} options.musicDir - Path to music directory
 * @param {boolean} [options.shuffle=true] - Whether to enable shuffle mode
 * @returns {Object} PlaylistManager instance
 */
function createPlaylistManager(options) {
  const { musicDir, shuffle: shuffleDefault = true } = options;

  /** @type {PlaylistState} */
  const state = {
    playlist: [],
    trackMap: new Map(),
    currentIndex: -1,
    currentTrack: null,
    history: [],
    shuffledQueue: [],
    shuffle: shuffleDefault,
  };

  let watcher = null;
  let onTrackAddedCallback = null;

  /**
   * Ensures the music directory exists, creating it if necessary
   * @returns {Promise<void>}
   * @throws {Error} If directory cannot be created
   */
  async function ensureMusicDir() {
    try {
      await fs.promises.mkdir(musicDir, { recursive: true });
    } catch (err) {
      error('Failed to ensure music directory:', err.message);
      throw err;
    }
  }

  /**
   * Reads and parses metadata from an audio file
   * @param {string} fullPath - Absolute path to audio file
   * @returns {Promise<TrackMetadata>} Parsed track metadata
   */
  async function readTrackMetadata(fullPath) {
    try {
      const metadata = await mm.parseFile(fullPath);
      const common = metadata.common || {};
      const format = metadata.format || {};
      const title = common.title || path.basename(fullPath, path.extname(fullPath));
      const artist =
        Array.isArray(common.artists) && common.artists.length > 0
          ? common.artists.join(', ')
          : common.artist || 'Unknown Artist';
      const album = common.album || 'Unknown Album';
      const duration = typeof format.duration === 'number' ? Math.round(format.duration) : null;
      return {
        title,
        artist,
        album,
        duration,
        filename: path.basename(fullPath),
        fullPath,
      };
    } catch (err) {
      warn(`Metadata parse failed for ${fullPath}:`, err.message);
      return {
        title: path.basename(fullPath, path.extname(fullPath)),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: null,
        filename: path.basename(fullPath),
        fullPath,
      };
    }
  }

  /**
   * Shuffles array in place using Fisher-Yates algorithm
   * @template T
   * @param {T[]} arr - Array to shuffle
   * @returns {T[]} Shuffled array (same reference)
   */
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Regenerates the shuffle queue excluding the current track
   * @param {number} [excludeIndex=-1] - Index to exclude from shuffle
   */
  function refreshShuffleQueue(excludeIndex = -1) {
    const indices = state.playlist
      .map((_, idx) => idx)
      .filter((idx) => idx !== excludeIndex || state.playlist.length === 1);
    state.shuffledQueue = shuffleArray(indices);
  }

  /**
   * Picks the next track index based on shuffle mode
   * @returns {number} Next track index, or -1 if playlist is empty
   */
  function pickNextIndex() {
    if (state.playlist.length === 0) {
      return -1;
    }
    if (!state.shuffle) {
      if (state.currentIndex === -1) {
        return 0;
      }
      return (state.currentIndex + 1) % state.playlist.length;
    }
    if (state.shuffledQueue.length === 0) {
      refreshShuffleQueue(state.currentIndex);
    }
    const next = state.shuffledQueue.shift();
    if (typeof next !== 'number') {
      return -1;
    }
    return next;
  }

  /**
   * Recursively walks a directory and yields all file paths
   * @param {string} dir - Directory path to walk
   * @yields {string} Full path to each file found
   */
  async function* walkDirectory(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      warn(`Skipping unreadable directory ${dir}: ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkDirectory(fullPath);
      } else {
        yield fullPath;
      }
    }
  }

  /**
   * Loads all MP3 files from the music directory into the playlist
   * @returns {Promise<void>} Resolves when all tracks are loaded
   */
  async function loadInitialPlaylist() {
    let successCount = 0;
    let errorCount = 0;
    for await (const fullPath of walkDirectory(musicDir)) {
      if (!fullPath.toLowerCase().endsWith('.mp3')) {
        continue;
      }
      if (state.trackMap.has(fullPath)) {
        continue;
      }
      try {
        const track = await readTrackMetadata(fullPath);
        state.trackMap.set(fullPath, track);
        state.playlist.push(track);
        successCount += 1;
      } catch (err) {
        errorCount += 1;
        error(`Failed to load track ${fullPath}:`, err instanceof Error ? err.message : err);
      }
    }
    if (state.shuffle) {
      refreshShuffleQueue();
    }
    log(`Loaded ${successCount} tracks (${errorCount} failed)`);
    if (state.playlist.length === 0 && errorCount > 0) {
      warn('No tracks loaded successfully. Check file formats and permissions.');
    }
  }

  /**
   * Handles a newly detected track by adding it to the playlist
   * @param {string} fullPath - Full path to the new track file
   * @returns {Promise<void>} Resolves when the track is added
   */
  async function handleNewTrack(fullPath) {
    if (!fullPath.toLowerCase().endsWith('.mp3')) {
      return;
    }
    if (state.trackMap.has(fullPath)) {
      return;
    }
    try {
      const track = await readTrackMetadata(fullPath);
      state.trackMap.set(fullPath, track);
      state.playlist.push(track);
      if (state.shuffle) {
        refreshShuffleQueue(state.currentIndex);
      }
      log(`New track detected: ${track.filename}`);
      if (onTrackAddedCallback) {
        onTrackAddedCallback(track);
      }
    } catch (err) {
      error(`Failed to add new track ${fullPath}:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Watches the music directory for new MP3 files and adds them to the playlist
   */
  function watchMusicDirectory() {
    watcher = chokidar.watch('**/*.mp3', {
      cwd: musicDir,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    watcher.on('add', (relativePath) => {
      const fullPath = path.join(musicDir, relativePath);
      ignoreErrors(handleNewTrack(fullPath), error, 'Failed to add new track');
    });

    watcher.on('error', (err) => {
      error('Watcher error:', err.message);
    });
  }

  /**
   * Returns the playlist with track details
   * @returns {Array<{index: number, title: string, artist: string, album: string, duration: number, filename: string}>} Playlist array
   */
  function listPlaylist() {
    return state.playlist.map((track, idx) => ({
      index: idx,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      filename: track.filename,
    }));
  }

  /**
   * Gets information about the currently playing track
   * @returns {Object|null} Track info, or null if no track
   */
  function getCurrentTrackInfo() {
    if (state.currentIndex === -1 || !state.playlist[state.currentIndex]) {
      return null;
    }
    const { title, artist, album, duration, filename } = state.playlist[state.currentIndex];
    return { title, artist, album, duration, filename };
  }

  /**
   * Gets the track at a specific playlist index
   * @param {number} index - Playlist index
   * @returns {TrackMetadata|null} Track at index, or null
   */
  function getTrackAtIndex(index) {
    return state.playlist[index] || null;
  }

  /**
   * Sets the current track index
   * @param {number} index - New current index
   */
  function setCurrentIndex(index) {
    state.currentIndex = index;
    state.currentTrack = state.playlist[index] || null;
  }

  /**
   * Adds the current track to history
   */
  function addToHistory() {
    if (state.currentIndex !== -1) {
      state.history.push(state.currentIndex);
    }
  }

  /**
   * Gets the previous track index from history
   * @returns {number|null} Previous track index, or null if no history
   */
  function popFromHistory() {
    if (state.history.length === 0) {
      return null;
    }
    const previousIndex = state.history.pop();
    if (typeof previousIndex !== 'number' || !state.playlist[previousIndex]) {
      return null;
    }
    return previousIndex;
  }

  /**
   * Sets a callback to be called when a new track is added
   * @param {Function} callback - Callback function
   */
  function onTrackAdded(callback) {
    onTrackAddedCallback = callback;
  }

  /**
   * Stops the file watcher
   */
  function stopWatcher() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  }

  return {
    /* Initialization */
    ensureMusicDir,
    loadInitialPlaylist,
    watchMusicDirectory,
    stopWatcher,

    /* Playlist queries */
    listPlaylist,
    getCurrentTrackInfo,
    getTrackAtIndex,
    get playlist() {
      return state.playlist;
    },
    get currentIndex() {
      return state.currentIndex;
    },
    get currentTrack() {
      return state.currentTrack;
    },
    get isEmpty() {
      return state.playlist.length === 0;
    },

    /* Playlist navigation */
    pickNextIndex,
    setCurrentIndex,
    addToHistory,
    popFromHistory,

    /* Events */
    onTrackAdded,
  };
}

module.exports = { createPlaylistManager };
