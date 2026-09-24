import type { ReportData } from '../report/aggregate.js';
import type { ScoredIncident, WatchMatch, NightBrief, CrossCameraTrail } from './types.js';
import { fmtTime, fmtTimeShort } from '../report/window.js';
import { describeWatchMatch } from './format.js';

export function buildNightBrief(
  data: ReportData,
  scored: ScoredIncident[],
  watchMatches: WatchMatch[],
  trails: CrossCameraTrail[],
  trendNote: string | null,
): NightBrief {
  const bullets: string[] = [];
  const zone = data.window.zone;

  if (data.totals.detections === 0) {
    return {
      headline: 'Quiet night — nothing detected.',
      bullets: [],
      topIncidents: [],
      watchMatches: [],
      trendNote,
    };
  }

  const significant = scored.filter((s) => s.label !== 'routine').sort((a, b) => b.significance - a.significance);
  const top = significant.slice(0, 5);

  const zoneMatches = watchMatches.filter((m) => m.rule.kind === 'sensitive-zone');
  const otherMatches = watchMatches.filter((m) => m.rule.kind !== 'sensitive-zone');

  const headline =
    zoneMatches.length > 0
      ? `URGENT — activity in ${zoneMatches.length === 1 ? 'a sensitive zone' : `${zoneMatches.length} sensitive zones`} overnight. Check the detail below immediately.`
      : otherMatches.length > 0
        ? `${otherMatches.length} flagged detection${otherMatches.length === 1 ? '' : 's'} overnight — check the detail below.`
        : top.length > 0
          ? `${top.length} incident${top.length === 1 ? '' : 's'} worth a look out of ${data.totals.incidents} total.`
          : `${data.totals.detections} detection${data.totals.detections === 1 ? '' : 's'} overnight, all routine.`;

  // Sensitive-zone alerts lead, ahead of ordinary watchlist matches.
  for (const m of [...zoneMatches, ...otherMatches]) {
    const time = fmtTime(m.detection.start, zone);
    bullets.push(`${time} — ${describeWatchMatch(m)}`);
  }

  for (const s of top) {
    if (s.watchMatches.length) continue; // already listed above
    const time = fmtTime(s.incident.start, zone);
    bullets.push(`${time} — ${s.incident.cameraName}: ${s.reasons[0] ?? 'notable activity'}`);
  }

  for (const t of trails.slice(0, 3)) {
    bullets.push(
      `${fmtTime(t.start, zone)} — probable path across ${t.cameras.join(' → ')} (heuristic, not confirmed identity)`,
    );
  }

  if (trendNote) bullets.push(trendNote);

  return { headline, bullets, topIncidents: top, watchMatches, trendNote };
}

/** Plain-text rendering for a push notification / email preheader. */
export function briefToText(brief: NightBrief): string {
  const lines = [brief.headline];
  for (const b of brief.bullets.slice(0, 6)) lines.push(`• ${b}`);
  return lines.join('\n');
}

/**
 * A compact summary for a push notification, which has none of the room a
 * PDF or email does. Escalates by severity rather than dumping data:
 * quiet/routine/flagged nights get a short headline plus a generic nudge
 * to check the report, not an itemised list of timestamps and camera
 * names — that's what cluttered a phone lock screen. Only a sensitive-
 * zone alert breaks that rule, since it's urgent enough to be worth
 * seeing immediately without opening anything; `fullDetail` controls
 * whether that one tier includes the actual time/camera, on by default.
 */
export function briefToPush(
  data: ReportData,
  scored: ScoredIncident[],
  watchMatches: WatchMatch[],
  fullDetail: boolean,
): { title: string; message: string; urgent: boolean } {
  const zone = data.window.zone;

  if (data.totals.detections === 0) {
    return { title: 'All quiet overnight', message: 'No detections.', urgent: false };
  }

  const zoneMatches = watchMatches.filter((m) => m.rule.kind === 'sensitive-zone');
  if (zoneMatches.length > 0) {
    const title = 'URGENT — sensitive zone activity';
    if (!fullDetail) {
      return { title, message: 'Check the report now.', urgent: true };
    }
    const seen = new Set<string>();
    const items: string[] = [];
    for (const m of zoneMatches) {
      const tag = `${fmtTimeShort(m.detection.start, zone)} ${m.detection.cameraName} (${m.detection.types.join('/')})`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      items.push(tag);
      if (items.length >= 2) break;
    }
    const extra = zoneMatches.length > items.length ? ` (+${zoneMatches.length - items.length} more)` : '';
    return { title, message: items.join(' · ') + extra, urgent: true };
  }

  const otherMatches = watchMatches.filter((m) => m.rule.kind !== 'sensitive-zone');
  if (otherMatches.length > 0) {
    return {
      title: `${otherMatches.length} flagged detection${otherMatches.length === 1 ? '' : 's'} overnight`,
      message: 'Check the report for details.',
      urgent: false,
    };
  }

  const significant = scored.filter((s) => s.label !== 'routine').sort((a, b) => b.significance - a.significance);
  if (significant.length === 0) {
    return {
      title: 'All quiet overnight',
      message: `${data.totals.detections} detection${data.totals.detections === 1 ? '' : 's'}, nothing unusual.`,
      urgent: false,
    };
  }

  return {
    title: `${significant.length} incident${significant.length === 1 ? '' : 's'} worth a look, out of ${data.totals.incidents} total`,
    message: 'Check the report when you get a chance.',
    urgent: false,
  };
}

/** Small HTML block to sit above the existing email summary, before the PDF attachment note. */
export function briefToHtml(brief: NightBrief): string {
  const items = brief.bullets
    .slice(0, 8)
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join('');
  return `
    <div style="margin-bottom:16px;padding:12px 16px;border-left:4px solid #2563eb;background:#eff6ff;">
      <strong>${escapeHtml(brief.headline)}</strong>
      ${items ? `<ul style="margin:8px 0 0;padding-left:20px;">${items}</ul>` : ''}
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
