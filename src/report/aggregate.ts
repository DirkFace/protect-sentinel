import { DateTime } from 'luxon';
import type { Detection, Incident, ProtectCamera, ProtectEvent } from '../protect/types.js';
import type { NightWindow } from './window.js';

export interface CameraSummary {
  cameraId: string;
  cameraName: string;
  detections: number;
  incidents: number;
  firstMs: number;
  lastMs: number;
  peakScore: number;
}

export interface ReportData {
  window: NightWindow;
  detections: Detection[];
  incidents: Incident[];
  byCamera: CameraSummary[];
  /** One bucket per 30 minutes across the window: { label, count }. */
  histogram: { label: string; count: number; startMs: number }[];
  quietCameras: string[];
  totals: { detections: number; incidents: number; cameras: number };
}

const matchesCamera = (list: string[], cam: ProtectCamera): boolean =>
  list.some((v) => v === cam.id || v.toLowerCase() === cam.name.toLowerCase());

/** Join raw events to cameras, apply filters, and normalise. */
export function toDetections(
  events: ProtectEvent[],
  cameras: ProtectCamera[],
  opts: {
    detectTypes: string[];
    minScore: number;
    includeCameras: string[];
    excludeCameras: string[];
  },
): Detection[] {
  const wanted = new Set(opts.detectTypes.map((t) => t.toLowerCase()));
  const byId = new Map(cameras.map((c) => [c.id, c]));

  const allowed = new Set(
    cameras
      .filter((c) => (opts.includeCameras.length ? matchesCamera(opts.includeCameras, c) : true))
      .filter((c) => !matchesCamera(opts.excludeCameras, c))
      .map((c) => c.id),
  );

  const out: Detection[] = [];
  for (const ev of events) {
    const types = (ev.smartDetectTypes ?? []).map((t) => t.toLowerCase());
    if (!types.some((t) => wanted.has(t))) continue;
    if (!allowed.has(ev.camera)) continue;
    const score = ev.score ?? 0;
    if (score < opts.minScore) continue;

    const cam = byId.get(ev.camera);
    out.push({
      id: ev.id,
      cameraId: ev.camera,
      cameraName: cam?.name ?? ev.camera,
      start: ev.start,
      end: ev.end,
      durationMs: ev.end ? Math.max(0, ev.end - ev.start) : 0,
      score,
      types,
      raw: ev as unknown as Record<string, unknown>,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Merge detections on the same camera that are less than `gapSeconds` apart.
 * One person loitering for four minutes is one incident, not forty events.
 */
export function clusterIncidents(detections: Detection[], gapSeconds: number): Incident[] {
  const gap = gapSeconds * 1000;
  const byCamera = new Map<string, Detection[]>();
  for (const d of detections) {
    const list = byCamera.get(d.cameraId);
    list ? list.push(d) : byCamera.set(d.cameraId, [d]);
  }

  const incidents: Incident[] = [];
  for (const list of byCamera.values()) {
    let current: Incident | null = null;
    for (const d of list) {
      const dEnd = d.end ?? d.start;
      if (current && d.start - current.end <= gap) {
        current.end = Math.max(current.end, dEnd);
        current.count += 1;
        current.peakScore = Math.max(current.peakScore, d.score);
        current.detections.push(d);
      } else {
        current = {
          cameraId: d.cameraId,
          cameraName: d.cameraName,
          start: d.start,
          end: dEnd,
          count: 1,
          peakScore: d.score,
          detections: [d],
        };
        incidents.push(current);
      }
    }
  }
  return incidents.sort((a, b) => a.start - b.start);
}

export function buildReportData(
  window: NightWindow,
  detections: Detection[],
  cameras: ProtectCamera[],
  gapSeconds: number,
): ReportData {
  const incidents = clusterIncidents(detections, gapSeconds);

  const summaries = new Map<string, CameraSummary>();
  for (const d of detections) {
    const s = summaries.get(d.cameraId) ?? {
      cameraId: d.cameraId,
      cameraName: d.cameraName,
      detections: 0,
      incidents: 0,
      firstMs: d.start,
      lastMs: d.start,
      peakScore: 0,
    };
    s.detections += 1;
    s.firstMs = Math.min(s.firstMs, d.start);
    s.lastMs = Math.max(s.lastMs, d.end ?? d.start);
    s.peakScore = Math.max(s.peakScore, d.score);
    summaries.set(d.cameraId, s);
  }
  for (const inc of incidents) {
    const s = summaries.get(inc.cameraId);
    if (s) s.incidents += 1;
  }

  const byCamera = [...summaries.values()].sort((a, b) => b.detections - a.detections);
  const reported = new Set(byCamera.map((c) => c.cameraId));

  return {
    window,
    detections,
    incidents,
    byCamera,
    histogram: buildHistogram(window, detections),
    quietCameras: cameras
      .filter((c) => !reported.has(c.id))
      .map((c) => c.name)
      .sort(),
    totals: {
      detections: detections.length,
      incidents: incidents.length,
      cameras: byCamera.length,
    },
  };
}

/** Half-hour buckets spanning the whole window, so quiet stretches stay visible. */
function buildHistogram(
  window: NightWindow,
  detections: Detection[],
): { label: string; count: number; startMs: number }[] {
  const bucketMs = 30 * 60 * 1000;
  const buckets: { label: string; count: number; startMs: number }[] = [];

  for (let t = window.startMs; t < window.endMs; t += bucketMs) {
    buckets.push({
      label: DateTime.fromMillis(t, { zone: window.zone }).toFormat('HH:mm'),
      count: 0,
      startMs: t,
    });
  }
  for (const d of detections) {
    const idx = Math.floor((d.start - window.startMs) / bucketMs);
    const bucket = buckets[idx];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
