import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { log } from '../logger.js';
import { runOnce } from '../run.js';
import { publishRunError, type NightState } from '../notify/mqtt.js';
import { readLastState } from './state.js';
import { fmtDateTime } from '../report/window.js';

/**
 * Tiny dependency-free HTTP server for Home Assistant Ingress: lists past
 * reports out of OUT_DIR, serves them inline, and has a "run now" button.
 *
 * Ingress sits behind Supervisor's own auth/proxy, so this deliberately does
 * no auth of its own — it must not be exposed outside the container network.
 * Every request carries an `X-Ingress-Path` header with the base path this
 * add-on is currently mounted at; every link on the page is built relative
 * to that so it keeps working if Supervisor changes the mount token.
 */
export function startIngressServer(cfg: Config, port: number): void {
  const server = http.createServer((req, res) => {
    void handle(req, res, cfg).catch((err) => {
      log.error(`Ingress request failed: ${(err as Error).message}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal error');
    });
  });
  server.listen(port, () => log.info(`Ingress panel listening on :${port}`));
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, cfg: Config): Promise<void> {
  const base = (req.headers['x-ingress-path'] as string | undefined) ?? '';
  const url = new URL(req.url ?? '/', 'http://internal');
  const rel = url.pathname; // already relative to `base` per Ingress convention

  if (rel === '/' || rel === '') {
    return renderIndex(res, cfg, base);
  }
  if (rel === '/run' && req.method === 'POST') {
    log.info('Ingress: manual run requested');
    try {
      const r = await runOnce(cfg, {});
      res.writeHead(302, { location: `${base}/?ran=1&detections=${r.detections}` });
      res.end();
    } catch (err) {
      publishRunError((err as Error).message);
      res.writeHead(302, { location: `${base}/?ran=0&error=${encodeURIComponent((err as Error).message)}` });
      res.end();
    }
    return;
  }
  if (rel.startsWith('/pdf/')) {
    const name = path.basename(decodeURIComponent(rel.slice('/pdf/'.length)));
    const full = path.resolve(cfg.OUT_DIR, name);
    if (!full.startsWith(path.resolve(cfg.OUT_DIR)) || !name.endsWith('.pdf')) {
      res.writeHead(400).end('Bad filename');
      return;
    }
    try {
      const buf = await fs.readFile(full);
      // "attachment", not "inline" — a PDF rendered inline inside the
      // ingress iframe hits a real iOS Safari limitation: an embedded PDF
      // only shows page 1 and won't scroll past it (the full multi-page
      // viewer only kicks in for a PDF that's the browser's actual
      // top-level document). A download happens within the current
      // authenticated request — no new tab, no lost ingress session — and
      // hands the finished file to the OS's own PDF viewer, fully outside
      // any iframe, so multi-page scrolling works everywhere.
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}"` });
      res.end(buf);
    } catch {
      res.writeHead(404).end('Not found');
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}

async function renderIndex(res: http.ServerResponse, cfg: Config, base: string): Promise<void> {
  const files = (await fs.readdir(cfg.OUT_DIR).catch(() => []))
    .filter((f) => f.startsWith('sentinel-') && f.endsWith('.pdf'))
    .sort()
    .reverse();
  const state = await readLastState(cfg);
  const statusBar = renderStatusBar(state, cfg);

  const rows = (
    await Promise.all(
      files.map(async (f) => {
        const date = f.replace('sentinel-', '').replace('.pdf', '');
        // Best-effort: a report written before this existed (or if the
        // sidecar write ever failed) just shows with no summary line.
        const summary = await fs
          .readFile(path.resolve(cfg.OUT_DIR, `sentinel-${date}.json`), 'utf8')
          .then((raw) => (JSON.parse(raw) as { headline?: string }).headline)
          .catch(() => null);
        // Deliberately no target="_blank" — that breaks out of the ingress
        // iframe into a brand-new top-level browsing context (on the HA
        // companion app, that means the system browser), which has no
        // ingress session at all and gets a 401. A plain same-context
        // navigation keeps the authenticated ingress session intact. The
        // `download` attribute (plus the server's attachment header) makes
        // this a download rather than a navigation at all — see the /pdf/
        // handler above for why.
        return `<div class="report">
      <div class="report-row">
        <span class="report-date">${date}</span>
        <a href="${base}/pdf/${encodeURIComponent(f)}" download="${f}">Download report</a>
      </div>
      ${summary ? `<p class="report-summary">${escapeHtml(summary)}</p>` : ''}
    </div>`;
      }),
    )
  ).join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(cfg.REPORT_TITLE)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px;
         background: #0f1420; color: #e4e8f1; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.sub { color: #8b93a7; margin: 0 0 24px; font-size: 13px; }
  .reports { width: 100%; max-width: 640px; }
  .report { padding: 10px 0; border-bottom: 1px solid #232a3b; }
  .report-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 12px; font-size: 14px; }
  .report-date { color: #e4e8f1; }
  .report-summary { margin: 4px 0 0; font-size: 12px; color: #8b93a7; line-height: 1.4; }
  a { color: #6ea8fe; text-decoration: none; }
  a:hover { text-decoration: underline; }
  button { background: #2563eb; color: white; border: none; padding: 10px 16px; border-radius: 6px;
           font-size: 14px; cursor: pointer; margin-bottom: 20px; }
  button:hover { background: #1d4ed8; }
  .empty { color: #8b93a7; font-size: 14px; }
  .status { border-radius: 8px; padding: 14px 16px; margin: 0 0 20px; max-width: 640px; }
  .status-title { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; margin: 0 0 4px; }
  .status-detail { font-size: 13px; margin: 0; }
  .status-empty { background: #171d2c; color: #8b93a7; }
  .status-ok { background: #12271d; border: 1px solid #1f4a34; }
  .status-ok .status-title { color: #4ade80; }
  .status-ok .status-detail { color: #9fb0a5; }
  .status-watch { background: #2a1c10; border: 1px solid #7c3a10; }
  .status-watch .status-title { color: #fb923c; }
  .status-watch .status-detail { color: #baa392; }
  .status-danger { background: #2a1414; border: 1px solid #b91c1c; }
  .status-danger .status-title { color: #fca5a5; }
  .status-danger .status-detail { color: #dbb8b8; }
</style></head>
<body>
  <h1>${escapeHtml(cfg.REPORT_TITLE)}${cfg.SITE_NAME ? ` — ${escapeHtml(cfg.SITE_NAME)}` : ''}</h1>
  <p class="sub">${files.length} report${files.length === 1 ? '' : 's'} on file, retained ${cfg.RETAIN_DAYS || '∞'} days</p>
  ${statusBar}
  <form method="post" action="${base}/run"><button type="submit">Run report now</button></form>
  <div class="reports">${rows || '<p class="empty">No reports yet.</p>'}</div>
</body></html>`;

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Small fixed-position status card summarising the most recent run — reads
 * straight from the state file the last run wrote (see server/state.ts), so
 * it works whether or not MQTT is configured. Deliberately shows only the
 * latest run, no history. Sensitive-zone activity gets its own distinct red
 * treatment, matching the PDF's urgent banner; a plain watchlist match gets
 * a milder amber treatment; a quiet night gets a calm, muted one. Sits in a
 * fixed spot above the report list so it doesn't get crowded out as PDFs
 * accumulate underneath.
 */
function renderStatusBar(state: NightState | null, cfg: Config): string {
  if (!state) {
    return `<div class="status status-empty">
      <p class="status-title">NO RUN YET</p>
      <p class="status-detail">Click "Run report now" below to generate the first report.</p>
    </div>`;
  }

  const when = fmtDateTime(Date.parse(state.lastRunIso), cfg.TZ_NAME);
  const counts = `${state.detections} detection${state.detections === 1 ? '' : 's'} · ${state.incidents} incident${state.incidents === 1 ? '' : 's'}`;

  if (state.sensitiveZoneAlert) {
    return `<div class="status status-danger">
      <p class="status-title">⚠ URGENT — SENSITIVE ZONE ACTIVITY</p>
      <p class="status-detail">${escapeHtml(when)} · ${counts} · ${escapeHtml(state.brief)}</p>
    </div>`;
  }
  if (state.watchMatch) {
    return `<div class="status status-watch">
      <p class="status-title">WATCHLIST MATCH</p>
      <p class="status-detail">${escapeHtml(when)} · ${counts} · ${escapeHtml(state.brief)}</p>
    </div>`;
  }
  return `<div class="status status-ok">
    <p class="status-title">ALL QUIET</p>
    <p class="status-detail">${escapeHtml(when)} · ${counts}</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
