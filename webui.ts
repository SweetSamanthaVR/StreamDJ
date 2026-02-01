/*
 * Web UI HTTP server responsible for rendering the StreamDJ control page
 * and exposing a thin API that proxies calls to the player and main server.
 */

import path from 'path';
import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createLogger } from './src/lib/utils/logger';

/* Extend express-session types for our custom session data */
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
  }
}

dotenv.config();

/*
 * Dedicated logger instance for this process.
 * All logs are prefixed with "webui".
 */
const { log, warn, error } = createLogger('webui');

/*
 * Parse a port number from an env var string.
 *
 * - If the value is missing or invalid, the provided fallback is returned.
 * - Guard rails: must be a positive, finite integer.
 */
function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/*
 * --- Configuration ---------------------------------------------------------
 */

/*
 * Public HTTP interface for the web UI itself.
 */
const WEBUI_PORT = parsePort(process.env.WEBUI_PORT, 8080);
const WEBUI_HOST = process.env.WEBUI_HOST ?? '127.0.0.1';

/*
 * Ports for talking to the internal player API and status HTTP server.
 */
const PLAYER_API_PORT = parsePort(process.env.PLAYER_API_PORT, 3000);
const SERVER_HTTP_PORT = parsePort(process.env.HTTP_PORT, 4000);

/*
 * Base URLs for downstream services. These can be overridden from env
 * to support remote / containerized deployments.
 */
const PLAYER_API_BASE = process.env.PLAYER_API_BASE ?? `http://127.0.0.1:${PLAYER_API_PORT}`;
const SERVER_STATUS_BASE = process.env.SERVER_STATUS_BASE ?? `http://127.0.0.1:${SERVER_HTTP_PORT}`;

/*
 * How often the browser polls /api/state for updates.
 * The web UI reads this value from the injected configJson in the EJS template.
 */
const POLL_INTERVAL_MS = Math.max(1000, parsePort(process.env.WEBUI_POLL_INTERVAL, 2000));

/*
 * Optional API key authentication (for programmatic API access).
 * When STREAMDJ_API_KEY is set, API endpoints accept this key via headers.
 */
const API_KEY = process.env.STREAMDJ_API_KEY?.trim() || null;

/*
 * Session-based authentication for the Web UI.
 * When STREAMDJ_USERNAME and STREAMDJ_PASSWORD are set, users must log in.
 */
const UI_USERNAME = process.env.STREAMDJ_USERNAME?.trim() || null;
const UI_PASSWORD = process.env.STREAMDJ_PASSWORD?.trim() || null;
const SESSION_AUTH_ENABLED = UI_PASSWORD !== null && UI_PASSWORD.length > 0;
const API_KEY_AUTH_ENABLED = API_KEY !== null && API_KEY.length > 0;
const AUTH_ENABLED = SESSION_AUTH_ENABLED || API_KEY_AUTH_ENABLED;

/*
 * Rate limiting for login attempts to prevent brute force attacks.
 */
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; /* 15 minutes */

function isRateLimited(ip: string): boolean {
  const record = loginAttempts.get(ip);
  if (!record) return false;

  /* Reset if lockout period has passed */
  if (Date.now() - record.lastAttempt > LOGIN_LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return false;
  }

  return record.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const record = loginAttempts.get(ip);
  if (record) {
    record.count++;
    record.lastAttempt = Date.now();
  } else {
    loginAttempts.set(ip, { count: 1, lastAttempt: Date.now() });
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extract API key from request headers.
 */
function extractApiKey(req: Request): string | null {
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') {
    return xApiKey.trim();
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim();
    }
  }
  return null;
}

/**
 * Auth middleware for API endpoints.
 * Accepts either session auth (from login) or API key auth (from headers).
 */
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  /* If no auth is configured, allow all requests */
  if (!AUTH_ENABLED) {
    return next();
  }

  /* Check session-based auth first (from login) */
  if (req.session?.authenticated) {
    return next();
  }

  /* Check API key auth */
  if (API_KEY_AUTH_ENABLED) {
    const providedKey = extractApiKey(req);
    if (providedKey && API_KEY && safeCompare(providedKey, API_KEY)) {
      return next();
    }
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'Authentication required. Please log in or provide a valid API key.',
  });
}

/**
 * Auth middleware for page routes (redirects to login instead of 401).
 */
function pageAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!SESSION_AUTH_ENABLED) {
    return next();
  }

  if (req.session?.authenticated) {
    return next();
  }

  res.redirect('/login');
}

/*
 * Player commands that this web UI is allowed to trigger.
 */
type PlayerAction = 'next' | 'previous' | 'pause' | 'resume';

/*
 * Single item in the player's playlist.
 */
interface PlayerTrack {
  index: number;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  filename: string;
}

/*
 * Shape returned by the player API for the current playback state.
 */
interface PlayerCurrentResponse {
  track: PlayerTrack | null;
  isPlaying: boolean;
  isPaused: boolean;
  positionSeconds: number;
}

/*
 * Shape returned by the StreamDJ main HTTP server status endpoint.
 */
interface ServerStatusResponse {
  tcpPort: number;
  httpPort: number;
  playerApiPort: number;
  rtmpUrl: string;
  streamKeyPresent: boolean;
  connected: boolean;
  bitrateKbps: number;
  ffmpegRestarts: number;
  backgroundSource: string | null;
  lastMetadata: Record<string, unknown> | null;
  lastUpdate: string | null;
  lastProgress: Record<string, unknown> | null;
}

/*
 * Aggregated view of everything the web UI needs to render.
 *
 * Built by fetchCombinedState() and served at /api/state.
 */
interface CombinedState {
  playerCurrent: PlayerCurrentResponse | null;
  playlist: PlayerTrack[];
  serverStatus: ServerStatusResponse | null;
  timestamp: string;
}

interface OverlayStyleFont {
  color: string;
  opacity: number;
  size: number;
  lineSpacing: number;
  letterSpacing: number;
}

interface OverlayStyleBox {
  enabled: boolean;
  color: string;
  opacity: number;
  borderWidth: number;
}

interface OverlayStyleLayout {
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'center' | 'bottom';
  offsetX: number;
  offsetY: number;
}

interface OverlayStyleLabels {
  showHeader: boolean;
  headerText: string;
  artistPrefix: string;
  albumPrefix: string;
  commentPrefix: string;
}

interface OverlayStyleValues {
  font: OverlayStyleFont;
  box: OverlayStyleBox;
  layout: OverlayStyleLayout;
  labels: OverlayStyleLabels;
}

interface OverlayStyleCapabilities {
  letterSpacing: boolean;
}

interface OverlayStyleSnapshot {
  version: number;
  updatedAt: string;
  values: OverlayStyleValues;
  capabilities?: OverlayStyleCapabilities;
}

/*
 * Result wrapper used by fetchJson().
 * If the request fails, `error` is set and `data` is undefined.
 */
interface FetchResult<T> {
  data?: T;
  error?: { status: number; message: string };
}

/*
 * --- Express app setup -----------------------------------------------------
 */

const app = express();

/*
 * Harden default HTTP headers with Helmet, and define a locked down CSP.
 * - script/style allow inline so the EJS template can inject the boot script.
 * - img and connect are restricted to same-origin.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", `http://127.0.0.1:${SERVER_HTTP_PORT}`],
      },
    },
  })
);

/*
 * Tell Express where to find the EJS templates and enable JSON / form parsing.
 * Resolve from the project root so compiled output in dist/ still works.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');
app.set('views', path.join(PROJECT_ROOT, 'views'));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
 * Session middleware for login-based authentication.
 * Generate a random secret if none is provided via env.
 */
const SESSION_SECRET =
  process.env.STREAMDJ_SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'streamdj.sid',
    cookie: {
      httpOnly: true,
      secure: false /* Set to true if using HTTPS */,
      maxAge: 24 * 60 * 60 * 1000 /* 24 hours */,
      sameSite: 'lax',
    },
  })
);

/*
 * Serve static assets from the public/ directory.
 * Files are served from /css, /js, /images paths.
 */
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

/*
 * Login page route (only shown when session auth is enabled).
 */
app.get('/login', (req: Request, res: Response) => {
  if (!SESSION_AUTH_ENABLED) {
    return res.redirect('/');
  }
  if (req.session?.authenticated) {
    return res.redirect('/');
  }
  res.render('login', {
    error: null,
    requireUsername: UI_USERNAME !== null && UI_USERNAME.length > 0,
  });
});

/*
 * Login form submission handler with rate limiting.
 */
app.post('/login', (req: Request, res: Response) => {
  if (!SESSION_AUTH_ENABLED || !UI_PASSWORD) {
    return res.redirect('/');
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const requireUsername = UI_USERNAME !== null && UI_USERNAME.length > 0;

  /* Check rate limiting */
  if (isRateLimited(clientIp)) {
    warn(`Rate limited login attempt from ${clientIp}`);
    res.render('login', {
      error: 'Too many failed attempts. Please try again in 15 minutes.',
      requireUsername,
    });
    return;
  }

  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  /* Validate username if required */
  const usernameValid =
    !requireUsername || (username && UI_USERNAME && safeCompare(username, UI_USERNAME));
  const passwordValid = password && safeCompare(password, UI_PASSWORD);

  if (usernameValid && passwordValid) {
    clearLoginAttempts(clientIp);
    req.session.authenticated = true;
    log('User logged in successfully');
    return res.redirect('/');
  }

  recordFailedLogin(clientIp);
  warn(`Failed login attempt from ${clientIp}`);
  res.render('login', {
    error: 'Invalid credentials. Please try again.',
    requireUsername,
  });
});

/*
 * Logout route.
 */
app.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      warn('Failed to destroy session:', err);
    }
    res.redirect('/login');
  });
});

/*
 * Apply auth middleware to /api/* routes when auth is enabled.
 */
app.use('/api', authMiddleware);

if (SESSION_AUTH_ENABLED) {
  log('Password authentication enabled for web UI');
}
if (API_KEY_AUTH_ENABLED) {
  log('API key authentication enabled for API endpoints');
}

/*
 * Safely stringify a value so it can be embedded into an inline <script> tag.
 *
 * Replaces characters that might prematurely close the script tag or
 * accidentally introduce HTML entities.
 */
function serializeForScript(value: unknown): string {
  /* Escape backslashes FIRST to avoid double-escaping other replacements */
  return JSON.stringify(value)
    .replace(/\\/g, '\\\\')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/'/g, '\\u0027');
}

/**
 * Build common headers for downstream API requests, including auth if enabled.
 */
function getDownstreamHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (AUTH_ENABLED && API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

/*
 * Perform a small JSON GET request with timeout and minimal logging.
 */
async function fetchJson<T>(url: string): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: getDownstreamHeaders(),
    });
    if (!response.ok) {
      const message = `${response.status} ${response.statusText}`;
      warn(`Request to ${url} failed: ${message}`);
      return { error: { status: response.status, message } };
    }
    const data = (await response.json()) as T;
    return { data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Request to ${url} failed:`, message);
    return { error: { status: 0, message } };
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * Send a control command (next / previous / pause / resume) to the player.
 *
 * Returns true if the player API responded with a 2xx status.
 */
async function callPlayerAction(action: PlayerAction): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${PLAYER_API_BASE}/${action}`, {
      method: 'POST',
      headers: getDownstreamHeaders('application/json'),
      signal: controller.signal,
    });
    return response.ok;
  } catch (err) {
    warn(`Player action ${action} failed:`, err instanceof Error ? err.message : err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * Fetch everything the web UI needs in one go:
 *   - current playback state
 *   - full playlist
 *   - server / streaming status
 */
async function fetchCombinedState(): Promise<CombinedState> {
  const [playerCurrentResult, playlistResult, serverStatusResult] = await Promise.all([
    fetchJson<PlayerCurrentResponse>(`${PLAYER_API_BASE}/current`),
    fetchJson<PlayerTrack[]>(`${PLAYER_API_BASE}/playlist`),
    fetchJson<ServerStatusResponse>(`${SERVER_STATUS_BASE}/status`),
  ]);

  return {
    playerCurrent: playerCurrentResult.data ?? null,
    playlist: playlistResult.data ?? [],
    serverStatus: serverStatusResult.data ?? null,
    timestamp: new Date().toISOString(),
  };
}

/*
 * Render the main web UI page.
 * Protected by session auth when STREAMDJ_PASSWORD is set.
 */
app.get('/', pageAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const initialState = await fetchCombinedState();
    res.render('webui', {
      title: 'StreamDJ Control',
      initialStateJson: serializeForScript(initialState),
      configJson: serializeForScript({
        pollInterval: POLL_INTERVAL_MS,
        playerBase: PLAYER_API_BASE,
        serverBase: SERVER_STATUS_BASE,
        apiKey: API_KEY_AUTH_ENABLED ? API_KEY : null,
      }),
      authEnabled: SESSION_AUTH_ENABLED,
      isAuthenticated: req.session?.authenticated ?? false,
    });
  } catch (err) {
    error('Failed to load initial state:', err instanceof Error ? err.message : err);
    res.status(500).send('Failed to load StreamDJ web UI.');
  }
});

/*
 * JSON endpoint consumed by the browser to poll current state.
 */
app.get('/api/state', async (_req: Request, res: Response) => {
  const state = await fetchCombinedState();
  res.json(state);
});

/*
 * Proxy a limited set of control actions to the player API.
 */
app.post('/api/player/:action', async (req: Request, res: Response) => {
  const action = req.params.action as PlayerAction;
  if (!['next', 'previous', 'pause', 'resume'].includes(action)) {
    res.status(400).json({ error: 'Unsupported action' });
    return;
  }
  const ok = await callPlayerAction(action);
  if (!ok) {
    res.status(502).json({ error: 'Player rejected request' });
    return;
  }
  res.status(204).end();
});

/*
 * Accepts a relative path to a background image / video and forwards it
 * to the main server. Basic validation is done here to avoid obviously
 * bad input before touching the downstream service.
 */
app.post('/api/background', async (req: Request, res: Response) => {
  const pathValue = typeof req.body?.path === 'string' ? req.body.path.trim() : '';

  if (pathValue && pathValue.length > 1024) {
    res.status(400).json({ error: 'Path exceeds maximum length' });
    return;
  }

  if (pathValue && pathValue.includes('\0')) {
    res.status(400).json({ error: 'Path contains invalid characters' });
    return;
  }

  const payload = pathValue ? { path: pathValue } : { path: '' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${SERVER_STATUS_BASE}/background`, {
      method: 'POST',
      headers: getDownstreamHeaders('application/json'),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: text || 'Background update failed' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    warn('Background update failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Background update failed' });
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/api/overlay/style', async (_req: Request, res: Response) => {
  const result = await fetchJson<OverlayStyleSnapshot>(`${SERVER_STATUS_BASE}/overlay/style`);
  if (result.error || !result.data) {
    res.status(502).json({ error: result.error?.message ?? 'Unable to load overlay style' });
    return;
  }
  res.json(result.data);
});

app.put('/api/overlay/style', async (req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${SERVER_STATUS_BASE}/overlay/style`, {
      method: 'PUT',
      headers: getDownstreamHeaders('application/json'),
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json(payload || { error: 'Overlay style update failed' });
      return;
    }
    res.json(payload);
  } catch (err) {
    warn('Overlay style update proxy failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Overlay style update failed' });
  } finally {
    clearTimeout(timeout);
  }
});

app.post('/api/overlay/style/reset', async (_req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${SERVER_STATUS_BASE}/overlay/style/reset`, {
      method: 'POST',
      headers: getDownstreamHeaders(),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json(payload || { error: 'Overlay style reset failed' });
      return;
    }
    res.json(payload);
  } catch (err) {
    warn('Overlay style reset proxy failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Overlay style reset failed' });
  } finally {
    clearTimeout(timeout);
  }
});

/*
 * --- Diagnostics API Proxy Routes ---
 */

/*
 * Get full diagnostics snapshot
 */
app.get('/api/diagnostics', async (_req: Request, res: Response) => {
  const result = await fetchJson<Record<string, unknown>>(`${SERVER_STATUS_BASE}/diagnostics`);
  if (result.error || !result.data) {
    res.status(502).json({ error: result.error?.message ?? 'Unable to load diagnostics' });
    return;
  }
  res.json(result.data);
});

/*
 * Get diagnostic logs with filtering
 */
app.get('/api/diagnostics/logs', async (req: Request, res: Response) => {
  const level = typeof req.query.level === 'string' ? req.query.level : 'DEBUG';
  const limit = typeof req.query.limit === 'string' ? req.query.limit : '1000';
  const url = `${SERVER_STATUS_BASE}/diagnostics/logs?level=${encodeURIComponent(level)}&limit=${encodeURIComponent(limit)}`;

  const result = await fetchJson<Record<string, unknown>>(url);
  if (result.error || !result.data) {
    res.status(502).json({ error: result.error?.message ?? 'Unable to load logs' });
    return;
  }
  res.json(result.data);
});

/*
 * Get diagnostic events
 */
app.get('/api/diagnostics/events', async (req: Request, res: Response) => {
  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const limit = typeof req.query.limit === 'string' ? req.query.limit : '100';
  const url = `${SERVER_STATUS_BASE}/diagnostics/events?type=${encodeURIComponent(type)}&limit=${encodeURIComponent(limit)}`;

  const result = await fetchJson<Record<string, unknown>>(url);
  if (result.error || !result.data) {
    res.status(502).json({ error: result.error?.message ?? 'Unable to load events' });
    return;
  }
  res.json(result.data);
});

/*
 * Get restart history
 */
app.get('/api/diagnostics/restarts', async (req: Request, res: Response) => {
  const limit = typeof req.query.limit === 'string' ? req.query.limit : '50';
  const url = `${SERVER_STATUS_BASE}/diagnostics/restarts?limit=${encodeURIComponent(limit)}`;

  const result = await fetchJson<Record<string, unknown>>(url);
  if (result.error || !result.data) {
    res.status(502).json({ error: result.error?.message ?? 'Unable to load restart history' });
    return;
  }
  res.json(result.data);
});

/*
 * Export full diagnostics bundle
 */
app.get('/api/diagnostics/export', async (_req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${SERVER_STATUS_BASE}/diagnostics/export`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: getDownstreamHeaders(),
    });
    if (!response.ok) {
      res.status(response.status).json({ error: 'Export failed' });
      return;
    }
    const data = await response.json();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="streamdj-diagnostics-${Date.now()}.json"`
    );
    res.json(data);
  } catch (err) {
    warn('Diagnostics export failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Export failed' });
  } finally {
    clearTimeout(timeout);
  }
});

/*
 * Clear diagnostic data
 */
app.post('/api/diagnostics/clear', async (_req: Request, res: Response) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${SERVER_STATUS_BASE}/diagnostics/clear`, {
      method: 'POST',
      headers: getDownstreamHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) {
      res.status(response.status).json({ error: 'Clear failed' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    warn('Diagnostics clear failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Clear failed' });
  } finally {
    clearTimeout(timeout);
  }
});

/*
 * Fallback for any unknown route.
 */
app.use((_req: Request, res: Response) => {
  res.status(404).send('Not found');
});

/*
 * Start the HTTP server and print a small summary to the logs.
 */
app.listen(WEBUI_PORT, WEBUI_HOST, () => {
  const displayedHost = WEBUI_HOST === '0.0.0.0' ? '127.0.0.1' : WEBUI_HOST;
  log(`Web UI running on http://${displayedHost}:${WEBUI_PORT}`);
  log(`Player API base -> ${PLAYER_API_BASE}`);
  log(`Server API base -> ${SERVER_STATUS_BASE}`);
});
