import fs from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { Config } from './config.js';
import { log } from './logger.js';
import { ProtectClient } from './protect/client.js';
import type { Detection, ProtectCamera, ProtectEvent } from './protect/types.js';
import { buildReportData, toDetections } from './report/aggregate.js';
import { renderReport } from './report/pdf.js';
import { buildNightWindow, lastNight, type NightWindow } from './report/window.js';
import { sendReport } from './mail/mailer.js';
import { demoCameras, demoEvents, demoThumbnail } from './demo.js';
import { parseWatchList } from './watch/rules.js';
import { matchWatches, unknownPersonDetections, recognisedLabelOf, indexLabelOf, sensitiveZoneMatches } from './watch/matcher.js';
import { correlateCrossCamera } from './watch/correlate.js';
import { scoreIncident } from './watch/significance.js';
import { recordNight, baselineForHour, describeRepeatPattern } from './watch/trends.js';
import { buildNightBrief, briefToText, briefToHtml, briefToPush } from './watch/summary.js';
import { notifyHass } from './notify/hass.js';
import { CRITICAL_PUSH_DATA } from './notify/critical.js';
import { publishNightState } from './notify/mqtt.js';
import { writeLastState } from './server/state.js';
import type { ScoredIncident, WatchMatch } from './watch/types.js';

export interface RunOptions {
  /** yyyy-MM-dd morning the report is filed on. Defaults to today. */
  date?: string;
  demo?: boolean;
  email?: boolean;
  outDir?: string;
}

export interface RunResult {
  pdfPath: string;
  detections: number;
  incidents: number;
  emailed: boolean;
}

export async function runOnce(cfg: Config, opts: RunOptions = {}): Promise<RunResult> {
  const window: NightWindow = opts.date
    ? buildNightWindow(opts.date, cfg.TZ_NAME, cfg.NIGHT_START, cfg.NIGHT_END)
    : lastNight(cfg.TZ_NAME, cfg.NIGHT_START, cfg.NIGHT_END);

  log.info(`Window: ${window.startLabel} → ${window.endLabel} (${window.zone})`);

  let cameras: ProtectCamera[];
  let events: ProtectEvent[];
  let client: ProtectClient | null = null;

  if (opts.demo) {
    log.warn('Demo mode — using synthetic detections, not the controller');
    cameras = demoCameras();
    events = demoEvents(window);
  } else {
    client = new ProtectClient({
      host: cfg.PROTECT_HOST,
      port: cfg.PROTECT_PORT,
      username: cfg.PROTECT_USERNAME,
      password: cfg.PROTECT_PASSWORD,
      apiKey: cfg.PROTECT_API_KEY,
      verifyTls: cfg.PROTECT_VERIFY_TLS,
    });
    await client.login();
    cameras = await client.getCameras();
    log.info(`${cameras.length} cameras on the controller`);
    events = await client.getSmartDetectEvents(window.startMs, window.endMs);
    log.info(`${events.length} smart-detect events in window`);
  }

  const detections: Detection[] = toDetections(events, cameras, {
    detectTypes: cfg.DETECT_TYPES,
    minScore: cfg.MIN_SCORE,
    includeCameras: cfg.INCLUDE_CAMERAS,
    excludeCameras: cfg.EXCLUDE_CAMERAS,
  });
  log.info(`${detections.length} ${cfg.DETECT_TYPES.join('/')} detections after filtering`);

  const data = buildReportData(window, detections, cameras, cfg.CLUSTER_GAP_SECONDS);

  // Cross-camera correlation runs before thumbnail fetching so a trail's
  // detections can be guaranteed a thumbnail even if the per-camera cap
  // (MAX_THUMBS_PER_CAMERA) would otherwise have skipped them — otherwise
  // the PDF's path-ordered trail strip could show blanks for a trail on a
  // busy camera.
  const trails = correlateCrossCamera(detections, cfg.CROSS_CAMERA_WINDOW_SECONDS);
  if (trails.length) log.info(`${trails.length} probable cross-camera trail(s) (heuristic)`);
  const trailDetectionIds = new Set(trails.flatMap((t) => t.detections.map((d) => d.id)));

  if (cfg.MAX_THUMBS_PER_CAMERA > 0) {
    await attachThumbnails(data.detections, data.byCamera.map((c) => c.cameraId), cfg, client, opts.demo === true, trailDetectionIds);
  }

  const outDir = opts.outDir ?? cfg.OUT_DIR;
  await fs.mkdir(outDir, { recursive: true });

  // ── Watch engine: watchlists, significance, trends ──
  const watchRules = parseWatchList(cfg.WATCH_LIST);
  const matcherOpts = {
    faceNameField: cfg.FACE_NAME_FIELD,
    plateNameField: cfg.PLATE_NAME_FIELD,
    flagUnknownPerson: cfg.FLAG_UNKNOWN_PERSON,
  };
  const namedMatches: WatchMatch[] = matchWatches(detections, watchRules, matcherOpts);
  const unknownPeople = cfg.FLAG_UNKNOWN_PERSON ? unknownPersonDetections(detections, matcherOpts) : [];
  const unknownMatches: WatchMatch[] = unknownPeople.map((d) => ({
    rule: { kind: 'unknown-person', value: 'unrecognised', raw: 'unknown-person' },
    detection: d,
    matchedValue: 'unrecognised',
  }));
  // Merged so every downstream consumer (brief, PDF, significance scoring,
  // MQTT) treats an unrecognised face exactly like a named watch-list hit —
  // consistent with it being at least as high a priority, per the reasoning
  // that an unknown face at night deserves at least as much attention as a
  // recognised one, arguably more.
  // Sensitive-zone hits are a different concept from watch_list (see
  // matcher.ts), and deliberately re-filter the raw events against their
  // own type list (sensitive_detect_types, defaulting to detect_types)
  // rather than reusing `detections` above — a sensitive zone often needs
  // to react to types (e.g. "animal") that the rest of the report doesn't
  // track at all, without widening detect_types globally and flooding
  // every other camera's incident log with foxes and cats. These hits still
  // flow through the same WatchMatch shape so they get the significance
  // boost, PDF banner and MQTT/push handling automatically, and — because
  // a sensitive-zone hit is meant to be rare and worth a proper look — they
  // get their own preview thumbnail below regardless of MAX_THUMBS_PER_CAMERA.
  // What a type outside detect_types still doesn't get is a row in the main
  // incident table, since that's built entirely from `detections` above.
  const sensitiveTypes = cfg.SENSITIVE_DETECT_TYPES.length ? cfg.SENSITIVE_DETECT_TYPES : cfg.DETECT_TYPES;
  const sensitiveDetections: Detection[] = cfg.SENSITIVE_CAMERAS.length
    ? toDetections(events, cameras, {
        detectTypes: sensitiveTypes,
        minScore: cfg.MIN_SCORE,
        includeCameras: cfg.SENSITIVE_CAMERAS,
        excludeCameras: [],
      })
    : [];
  // A sensitive-zone hit is rare and important enough to always get a
  // preview in the PDF banner, regardless of MAX_THUMBS_PER_CAMERA and
  // regardless of whether its type is even in the global detect_types list
  // — so it gets its own unconditional thumbnail fetch rather than relying
  // on the main attachThumbnails pass below, which only ever sees
  // detections that already passed the global type filter.
  if (sensitiveDetections.length) {
    await attachThumbnails(sensitiveDetections, [], cfg, client, opts.demo === true, new Set(sensitiveDetections.map((d) => d.id)));
  }
  const zoneMatches: WatchMatch[] = sensitiveZoneMatches(sensitiveDetections, cfg.SENSITIVE_CAMERAS);
  const watchMatches: WatchMatch[] = [...namedMatches, ...unknownMatches, ...zoneMatches];
  if (namedMatches.length) log.info(`${namedMatches.length} named watch-list match(es) tonight`);
  if (unknownMatches.length) log.info(`${unknownMatches.length} unrecognised-face detection(s) tonight`);
  if (zoneMatches.length) log.warn(`${zoneMatches.length} sensitive-zone detection(s) tonight — URGENT`);

  // Every name Protect itself has already put on a detection (a known face
  // group or a named vehicle), independent of watch_list — lets the PDF
  // label a recognised thumbnail even when it isn't something you're
  // actively watching for.
  const recognisedLabels = new Map<string, string>();
  for (const d of detections) {
    const label = recognisedLabelOf(d, matcherOpts);
    if (label) recognisedLabels.set(d.id, label);
  }

  // Richer than recognisedLabels — used only in the incident log's "Index"
  // column, where a raw plate or an explicit "no match" is still useful
  // even without a friendly name.
  const indexLabels = new Map<string, string>();
  for (const d of detections) {
    const label = indexLabelOf(d, matcherOpts);
    if (label) indexLabels.set(d.id, label);
  }

  const trendStore = await recordNight(outDir, window.reportDate, window.zone, detections);
  const trendNote = describeRepeatPattern(
    trendStore,
    window.reportDate,
    trendStore.nights.find((n) => n.date === window.reportDate)?.byHour ?? {},
  );

  const matchesByIncident = (inc: (typeof data.incidents)[number]): WatchMatch[] =>
    watchMatches.filter((m) => inc.detections.some((d) => d.id === m.detection.id));

  const scored: ScoredIncident[] = data.incidents.map((inc) => {
    const hour = DateTime.fromMillis(inc.start, { zone: window.zone }).hour;
    return scoreIncident(inc, hour, matchesByIncident(inc), {
      lowConfidenceFloor: Math.max(cfg.MIN_SCORE, 30),
      baselineForHour: baselineForHour(trendStore, window.reportDate, hour, cfg.TREND_LOOKBACK_NIGHTS),
    });
  });

  const brief = buildNightBrief(data, scored, watchMatches, trails, trendNote);

  const pdf = await renderReport(
    data,
    {
      title: cfg.REPORT_TITLE,
      siteName: cfg.SITE_NAME,
      eventUrlTemplate: opts.demo ? undefined : cfg.PROTECT_EVENT_URL,
      host: opts.demo ? undefined : cfg.PROTECT_HOST,
      includeEventTable: cfg.INCLUDE_EVENT_TABLE,
      maxThumbsPerCamera: cfg.MAX_THUMBS_PER_CAMERA,
    },
    watchMatches,
    trails,
    recognisedLabels,
    indexLabels,
  );

  const filename = `sentinel-${window.reportDate}.pdf`;
  const pdfPath = path.resolve(outDir, filename);
  await fs.writeFile(pdfPath, pdf);
  log.info(`Wrote ${pdfPath} (${(pdf.length / 1024).toFixed(0)} KB)`);

  // Small sidecar so the ingress panel can show a one-line summary next to
  // each past report without re-reading (or re-parsing) the PDF itself.
  // Best-effort — a report list entry just has no summary line if this is
  // missing, e.g. for PDFs written before this existed.
  const summaryPath = path.resolve(outDir, `sentinel-${window.reportDate}.json`);
  await fs.writeFile(summaryPath, JSON.stringify({ headline: brief.headline })).catch((err) => {
    log.warn(`Could not write report summary sidecar: ${(err as Error).message}`);
  });

  let emailed = false;
  const shouldEmail = opts.email !== false && cfg.MAIL_TO.length > 0;
  const emailBrief = cfg.MORNING_SUMMARY ? { text: briefToText(brief), html: briefToHtml(brief) } : undefined;
  if (shouldEmail && data.totals.detections === 0 && !cfg.SEND_IF_EMPTY) {
    log.info('No detections and SEND_IF_EMPTY is false — skipping email');
  } else if (shouldEmail) {
    await sendReport(cfg, data, pdf, filename, emailBrief);
    emailed = true;
  } else {
    log.info('Email skipped');
  }

  if (cfg.NOTIFY_SERVICE && data.totals.detections > 0) {
    const push = briefToPush(data, scored, watchMatches, cfg.PUSH_FULL_DETAIL_ON_URGENT);
    const critical = push.urgent && cfg.PUSH_CRITICAL_ON_URGENT ? CRITICAL_PUSH_DATA : undefined;
    await notifyHass(cfg.NOTIFY_SERVICE, push.title, push.message, critical);
  }

  if (!opts.demo) {
    const nightState = {
      lastRunIso: new Date().toISOString(),
      incidents: data.totals.incidents,
      detections: data.totals.detections,
      watchMatch: watchMatches.length > 0,
      sensitiveZoneAlert: zoneMatches.length > 0,
      brief: brief.headline,
    };
    publishNightState(nightState);
    // Kept independent of MQTT — the ingress panel's status bar reads this
    // file directly, so it works whether or not mqtt_host is configured.
    await writeLastState(cfg, nightState);
  }

  await client?.close();
  if (cfg.RETAIN_DAYS > 0) await prune(outDir, cfg.RETAIN_DAYS);

  return {
    pdfPath,
    detections: data.totals.detections,
    incidents: data.totals.incidents,
    emailed,
  };
}

/**
 * Pull stills for the detections that will actually be printed, newest-first
 * per camera, so a busy night does not fetch hundreds of JPEGs.
 */
async function attachThumbnails(
  detections: Detection[],
  cameraOrder: string[],
  cfg: Config,
  client: ProtectClient | null,
  demo: boolean,
  forceInclude: Set<string> = new Set(),
): Promise<void> {
  const wanted: Detection[] = [];
  const wantedIds = new Set<string>();
  const add = (d: Detection) => {
    if (!wantedIds.has(d.id)) {
      wanted.push(d);
      wantedIds.add(d.id);
    }
  };
  for (const cameraId of cameraOrder) {
    const forCam = detections.filter((d) => d.cameraId === cameraId);
    pickSpread(forCam, cfg.MAX_THUMBS_PER_CAMERA).forEach(add);
  }
  // Guarantee a thumbnail for every detection that's part of a cross-camera
  // trail, even if the per-camera spread above would have skipped it —
  // otherwise a trail on a busy camera could render with blank thumbnails.
  for (const d of detections) {
    if (forceInclude.has(d.id)) add(d);
  }

  let ok = 0;
  for (const [i, d] of wanted.entries()) {
    if (demo) {
      d.thumbnail = demoThumbnail(d.cameraName, i + 1);
      ok++;
      continue;
    }
    const buf = await client!.getEventThumbnail(d.id, cfg.THUMB_WIDTH);
    if (buf) {
      d.thumbnail = buf;
      ok++;
    }
  }
  log.info(`Fetched ${ok}/${wanted.length} thumbnails`);
}

/** Evenly sample across the night rather than taking the first N of one burst. */
function pickSpread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]!);
}

async function prune(dir: string, retainDays: number): Promise<void> {
  const cutoff = Date.now() - retainDays * 86_400_000;
  let removed = 0;
  for (const name of await fs.readdir(dir).catch(() => [])) {
    if (!name.startsWith('sentinel-') || !name.endsWith('.pdf')) continue;
    const full = path.join(dir, name);
    const stat = await fs.stat(full);
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(full);
      // Remove the matching summary sidecar too, or it'd just accumulate
      // as an orphan forever once its PDF is gone.
      await fs.unlink(full.replace(/\.pdf$/, '.json')).catch(() => {});
      removed++;
    }
  }
  if (removed) log.info(`Pruned ${removed} report(s) older than ${retainDays} days`);
}
