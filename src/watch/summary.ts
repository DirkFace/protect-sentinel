import type { ReportData } from '../report/aggregate.js';
import type { ScoredIncident, WatchMatch, NightBrief, CrossCameraTrail } from './types.js';
import { fmtTime, fmtTimeShort } from '../report/window.js';
import { describeWatchMatch, shortMatchTag } from './format.js';

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
 * PDF or email does — most phone lock screens truncate well before the
 * point buildNightBrief's bullets end, which just showed as clutter. This
 * says either "all quiet" or names the one or two things actually worth a
 * look, each condensed to a short phrase, and leaves everything else for the
 * PDF/email. Trails aren't included here — a trail is corroborating detail
 * for something already listed above (a watch match or a notable incident),
 * not a separate headline of its own.
 */
export function briefToPush(data: ReportData, scored: ScoredIncident[], watchMatches: WatchMatch[]): { title: string; message: string } {
  const zone = data.window.zone;

  if (data.totals.detections === 0) {
    return { title: 'All quiet overnight', message: 'No detections.' };
  }

  const zoneMatches = watchMatches.filter((m) => m.rule.kind === 'sensitive-zone');
  if (zoneMatches.length > 0) {
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
    return {
      title: `URGENT — sensitive zone activity`,
      message: items.join(' · ') + extra,
    };
  }

  const otherMatches = watchMatches.filter((m) => m.rule.kind !== 'sensitive-zone');
  if (otherMatches.length > 0) {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const m of otherMatches) {
      const tag = `${shortMatchTag(m)} · ${m.detection.cameraName}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      items.push(tag);
      if (items.length >= 2) break;
    }
    const extra = otherMatches.length > items.length ? ` (+${otherMatches.length - items.length} more)` : '';
    return {
      title: `${otherMatches.length} flagged detection${otherMatches.length === 1 ? '' : 's'} overnight`,
      message: items.join(' · ') + extra,
    };
  }

  const significant = scored.filter((s) => s.label !== 'routine').sort((a, b) => b.significance - a.significance);
  if (significant.length === 0) {
    return {
      title: 'All quiet overnight',
      message: `${data.totals.detections} detection${data.totals.detections === 1 ? '' : 's'}, nothing unusual.`,
    };
  }

  const top = significant.slice(0, 2);
  const items = top.map((s) => `${fmtTimeShort(s.incident.start, zone)} ${s.incident.cameraName}: ${shortReason(s)}`);
  const extra = significant.length > top.length ? ` (+${significant.length - top.length} more)` : '';
  return {
    title: `${significant.length} incident${significant.length === 1 ? '' : 's'} worth a look, out of ${data.totals.incidents} total`,
    message: items.join(' · ') + extra,
  };
}

/** Condenses a scored incident's leading reason into a short push-friendly phrase. */
function shortReason(s: ScoredIncident): string {
  const r = s.reasons.find(Boolean) ?? '';
  if (r.includes('unusual for this time')) return 'unusual timing';
  if (r.includes('quieter-than-usual')) return 'quiet-hour activity';
  if (r.includes('high-confidence')) return 'high-confidence';
  if (r.includes('sustained')) return 'sustained activity';
  if (r.includes('clustered')) return 'repeated activity';
  return 'notable activity';
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
