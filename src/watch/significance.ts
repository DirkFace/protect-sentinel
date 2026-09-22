import type { Incident } from '../protect/types.js';
import type { ScoredIncident, WatchMatch } from './types.js';
import { describeWatchMatch } from './format.js';

export interface SignificanceOptions {
  /** Confidence below which a solitary, brief detection barely counts at all. */
  lowConfidenceFloor: number;
  /** Typical activity count for this hour-of-night, from trend history (0 if unknown). */
  baselineForHour: number;
}

/**
 * A rough, explainable 0-100 score — not a probability of anything. It exists
 * so the morning brief can say "these three deserve a look" instead of
 * listing forty equally-weighted rows.
 *
 * Weighted on: peak confidence, sustained duration, repeat detections
 * (loitering vs. a single frame), rarity vs. this hour's usual baseline, and
 * any watch-list match (which dominates — a plate hit at 3am matters more
 * than anything else on the page).
 */
export function scoreIncident(
  incident: Incident,
  hourOfNight: number,
  watchMatches: WatchMatch[],
  opts: SignificanceOptions,
): ScoredIncident {
  const reasons: string[] = [];
  let score = 0;

  const confidencePoints = Math.round((incident.peakScore / 100) * 35);
  score += confidencePoints;
  if (incident.peakScore >= 80) reasons.push(`high-confidence detection (${incident.peakScore}%)`);
  else if (incident.peakScore < opts.lowConfidenceFloor) reasons.push(`low confidence (${incident.peakScore}%)`);

  const durationMs = incident.end - incident.start;
  const durationPoints = Math.min(20, Math.round(durationMs / 60_000) * 4);
  score += durationPoints;
  if (durationMs >= 120_000) reasons.push(`sustained for ${Math.round(durationMs / 60_000)} min`);

  const countPoints = Math.min(15, (incident.count - 1) * 3);
  score += countPoints;
  if (incident.count >= 4) reasons.push(`${incident.count} detections clustered together`);

  if (opts.baselineForHour === 0) {
    score += 10;
    reasons.push('unusual for this time of night — no prior activity in this hour');
  } else if (opts.baselineForHour < 1) {
    score += 5;
    reasons.push('quieter-than-usual hour to see activity');
  }

  if (watchMatches.length) {
    score += 40;
    const seen = new Set<string>();
    for (const m of watchMatches) {
      const reason = describeWatchMatch(m);
      if (!seen.has(reason)) {
        seen.add(reason);
        reasons.push(reason);
      }
    }
  }

  // A sensitive-zone hit overrides everything else on the scale — a single
  // low-confidence blip on a camera that should see nothing overnight is
  // exactly as worth a look as a sustained, high-confidence one. Confidence
  // and duration still matter for ordinary incidents, but not here.
  if (watchMatches.some((m) => m.rule.kind === 'sensitive-zone')) {
    score = 100;
  }

  score = Math.max(0, Math.min(100, score));
  const label = score >= 65 ? 'significant' : score >= 35 ? 'notable' : 'routine';

  return { incident, significance: score, label, reasons, watchMatches };
}
