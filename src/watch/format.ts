import type { WatchMatch } from './types.js';

/** Full sentence describing what matched (camera name is already baked in) — for the email brief and PDF banner. */
export function describeWatchMatch(m: WatchMatch): string {
  switch (m.rule.kind) {
    case 'camera':
      return `Activity on watched camera "${m.rule.value}"`;
    case 'unknown-person':
      return `Unrecognised face detected on ${m.detection.cameraName}`;
    case 'face':
      return `Face watch "${m.rule.value}" matched on ${m.detection.cameraName}`;
    case 'plate':
      return `Plate watch "${m.rule.value}" matched on ${m.detection.cameraName}`;
    case 'sensitive-zone':
      return `URGENT — ${m.detection.types.join('/')} detected in sensitive zone "${m.detection.cameraName}" (this camera should be clear overnight)`;
  }
}

/** Short tag for the ★ label on a highlighted thumbnail in the PDF stills. */
export function shortMatchTag(m: WatchMatch): string {
  if (m.rule.kind === 'unknown-person') return 'unrecognised';
  if (m.rule.kind === 'sensitive-zone') return 'URGENT';
  return m.rule.value;
}
