import { Agent, request } from 'undici';
import { log } from '../logger.js';
import type { ProtectCamera, ProtectEvent } from './types.js';

export interface ProtectClientOptions {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  apiKey?: string;
  verifyTls?: boolean;
  /** Split long event queries into slices of this many ms (controllers cap results). */
  sliceMs?: number;
}

export class ProtectAuthError extends Error {}

/**
 * Minimal UniFi Protect local-API client.
 *
 * Auth precedence:
 *   1. `apiKey`  -> sent as `X-API-KEY` (UniFi OS API key; support varies by version)
 *   2. username/password -> `POST /api/auth/login`, cookie + X-CSRF-Token
 *
 * The local account must NOT have MFA enabled, and needs at least
 * "View Only" rights on Protect.
 */
export class ProtectClient {
  private readonly base: string;
  private readonly opts: ProtectClientOptions;
  private readonly dispatcher: Agent;
  private cookie = '';
  private csrf = '';
  private loggedIn = false;

  constructor(opts: ProtectClientOptions) {
    this.opts = opts;
    const port = opts.port ?? 443;
    this.base = `https://${opts.host}${port === 443 ? '' : `:${port}`}`;
    this.dispatcher = new Agent({
      connect: { rejectUnauthorized: opts.verifyTls ?? false },
      headersTimeout: 30_000,
      bodyTimeout: 120_000,
    });
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  // ── auth ────────────────────────────────────────────────────────────────

  async login(): Promise<void> {
    if (this.opts.apiKey) {
      this.loggedIn = true;
      log.debug('Using API-key auth');
      return;
    }
    const { username, password } = this.opts;
    if (!username || !password) throw new ProtectAuthError('No credentials configured');

    const res = await request(`${this.base}/api/auth/login`, {
      method: 'POST',
      dispatcher: this.dispatcher,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, rememberMe: true }),
    });
    const body = await res.body.text();

    if (res.statusCode === 499 || /mfa|2fa/i.test(body)) {
      throw new ProtectAuthError(
        'Controller demanded MFA. Create a dedicated local account without 2FA for the reporter.',
      );
    }
    if (res.statusCode >= 400) {
      throw new ProtectAuthError(`Login failed (HTTP ${res.statusCode}): ${body.slice(0, 200)}`);
    }

    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    this.cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    const csrf = res.headers['x-csrf-token'] ?? res.headers['x-updated-csrf-token'];
    this.csrf = Array.isArray(csrf) ? (csrf[0] ?? '') : (csrf ?? '');

    if (!this.cookie) throw new ProtectAuthError('Login succeeded but no session cookie returned');
    this.loggedIn = true;
    log.info(`Authenticated to Protect at ${this.opts.host}`);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' };
    if (this.opts.apiKey) h['x-api-key'] = this.opts.apiKey;
    if (this.cookie) h['cookie'] = this.cookie;
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    return h;
  }

  // ── transport ───────────────────────────────────────────────────────────

  private async get(path: string, binary = false, retry = true): Promise<Buffer | unknown> {
    if (!this.loggedIn) await this.login();

    const res = await request(`${this.base}${path}`, {
      method: 'GET',
      dispatcher: this.dispatcher,
      headers: this.headers(),
    });

    if (res.statusCode === 401 || res.statusCode === 403) {
      await res.body.dump();
      if (retry && !this.opts.apiKey) {
        log.warn('Session rejected, re-authenticating');
        this.loggedIn = false;
        await this.login();
        return this.get(path, binary, false);
      }
      throw new ProtectAuthError(`HTTP ${res.statusCode} for ${path}`);
    }
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`HTTP ${res.statusCode} for ${path}: ${text.slice(0, 200)}`);
    }

    if (binary) return Buffer.from(await res.body.arrayBuffer());
    return res.body.json();
  }

  // ── endpoints ───────────────────────────────────────────────────────────

  async getCameras(): Promise<ProtectCamera[]> {
    const data = (await this.get('/proxy/protect/api/cameras')) as ProtectCamera[];
    return (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      mac: c.mac,
      state: c.state,
      type: c.type,
      isConnected: c.state === 'CONNECTED',
    }));
  }

  /**
   * Fetch smart-detect events between two epoch-ms timestamps.
   *
   * The window is walked in slices because controllers silently cap how many
   * events a single query returns; results are de-duplicated by event id.
   */
  async getSmartDetectEvents(startMs: number, endMs: number): Promise<ProtectEvent[]> {
    const slice = this.opts.sliceMs ?? 2 * 60 * 60 * 1000;
    const byId = new Map<string, ProtectEvent>();

    for (let from = startMs; from < endMs; from += slice) {
      const to = Math.min(from + slice, endMs);
      const qs = new URLSearchParams({
        start: String(from),
        end: String(to),
        types: 'smartDetectZone',
        orderDirection: 'ASC',
        limit: '1000',
      });
      // smartDetectLine (line-crossing) is a separate type on newer firmware.
      qs.append('types', 'smartDetectLine');

      const batch = (await this.get(`/proxy/protect/api/events?${qs}`)) as ProtectEvent[];
      for (const ev of batch ?? []) byId.set(ev.id, ev);
      log.debug(
        `events ${new Date(from).toISOString()}..${new Date(to).toISOString()}: ${batch?.length ?? 0}`,
      );
    }

    return [...byId.values()].sort((a, b) => a.start - b.start);
  }

  /** JPEG thumbnail for an event, or null if the controller has none. */
  async getEventThumbnail(eventId: string, width: number): Promise<Buffer | null> {
    const height = Math.round((width * 9) / 16);
    try {
      const buf = (await this.get(
        `/proxy/protect/api/events/${eventId}/thumbnail?w=${width}&h=${height}`,
        true,
      )) as Buffer;
      return buf.length > 0 ? buf : null;
    } catch (err) {
      log.debug(`No thumbnail for event ${eventId}: ${(err as Error).message}`);
      return null;
    }
  }

  eventUrl(template: string, eventId: string): string {
    return template.replaceAll('{host}', this.opts.host).replaceAll('{eventId}', eventId);
  }
}
