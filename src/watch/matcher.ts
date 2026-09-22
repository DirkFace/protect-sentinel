import type { Detection } from '../protect/types.js';
import type { WatchMatch, WatchRule } from './types.js';
import { extractFaceName, extractPlate, extractVehicleName, hasFaceDetection } from './unifi-shapes.js';

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const normPlate = (v: unknown): string => norm(v).replace(/\s+/g, '');

/** Simple dot-path reader, for the manual FACE_NAME_FIELD/PLATE_NAME_FIELD override only. */
function readPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export interface MatcherOptions {
  /**
   * Manual override: a dot-path into Detection.raw to use INSTEAD of the
   * built-in detectedThumbnails-based extraction, for controllers whose
   * firmware puts the recognised face name somewhere else. Leave blank to
   * use the confirmed default shape (see unifi-shapes.ts).
   */
  faceNameField: string;
  /**
   * Same idea as faceNameField, but for licence plates. When set, this
   * single dot-path replaces BOTH the raw-plate and friendly-name lookups
   * below — only use it if your firmware's plate field differs from the
   * confirmed default in unifi-shapes.ts.
   */
  plateNameField: string;
  flagUnknownPerson: boolean;
}

function faceNameOf(d: Detection, opts: MatcherOptions): string | undefined {
  if (opts.faceNameField) {
    const v = readPath(d.raw, opts.faceNameField);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }
  return extractFaceName(d.raw);
}

/**
 * Both values a plate rule can match against: the raw OCR plate, and (if
 * the vehicle has been named in Protect) its friendly name — see
 * unifi-shapes.ts for why these can differ. When plateNameField is set,
 * that override is used for both and there's no separate friendly name.
 */
function plateValuesOf(d: Detection, opts: MatcherOptions): { plate?: string; name?: string } {
  if (opts.plateNameField) {
    const v = readPath(d.raw, opts.plateNameField);
    const val = typeof v === 'string' && v.trim() ? v.trim() : undefined;
    return { plate: val };
  }
  return { plate: extractPlate(d.raw), name: extractVehicleName(d.raw) };
}

/**
 * Matches detections against configured watch rules.
 *
 * Both face and plate matching use the confirmed UniFi Protect event shape
 * by default (see unifi-shapes.ts) — no configuration needed.
 * FACE_NAME_FIELD/PLATE_NAME_FIELD let you override either if your firmware
 * differs. A `plate:` rule matches either the raw plate string (e.g.
 * `plate:SO64FVU`) or, once you've named the vehicle in Protect itself, its
 * friendly name (e.g. `plate:Graham`) — both work regardless of which one
 * you write in watch_list. Plate matching is an exact match against the
 * controller's single best OCR read — the raw event also carries a ranked
 * list of close alternates (e.g. reading "0" as "O"), which this does not
 * currently check. If a plate rule seems to "miss" a real pass, that OCR
 * ambiguity is the most likely reason.
 */
export function matchWatches(detections: Detection[], rules: WatchRule[], opts: MatcherOptions): WatchMatch[] {
  const matches: WatchMatch[] = [];
  const faceRules = rules.filter((r) => r.kind === 'face');
  const plateRules = rules.filter((r) => r.kind === 'plate');
  const cameraRules = rules.filter((r) => r.kind === 'camera');

  for (const d of detections) {
    if (faceRules.length) {
      const seen = norm(faceNameOf(d, opts));
      if (seen) {
        for (const rule of faceRules) {
          if (norm(rule.value) === seen || seen.includes(norm(rule.value))) {
            matches.push({ rule, detection: d, matchedValue: seen });
          }
        }
      }
    }
    if (plateRules.length) {
      const { plate, name } = plateValuesOf(d, opts);
      const seenPlate = normPlate(plate);
      const seenName = norm(name);
      if (seenPlate || seenName) {
        for (const rule of plateRules) {
          const target = norm(rule.value);
          if ((seenPlate && normPlate(rule.value) === seenPlate) || (seenName && target === seenName)) {
            matches.push({ rule, detection: d, matchedValue: name ?? plate ?? '' });
          }
        }
      }
    }
    for (const rule of cameraRules) {
      if (norm(rule.value) === norm(d.cameraName) || norm(rule.value) === norm(d.cameraId)) {
        matches.push({ rule, detection: d, matchedValue: d.cameraName });
      }
    }
  }
  return matches;
}

/**
 * Sensitive zones are a different concept from the watch_list above: not
 * "alert me if I see this specific face/plate", but "this camera should see
 * NO activity at all overnight, so any smart detection here — of any type,
 * matched or not — is inherently worth flagging". A back garden, a fuel or
 * materials store, anywhere with no legitimate overnight foot/vehicle
 * traffic. Every hit is wrapped as a WatchMatch (kind: 'sensitive-zone') so
 * it flows through the same significance boost, PDF highlighting and push
 * pipeline as any other watch hit, but callers can filter on the kind to
 * give it its own distinct "urgent" treatment on top of that.
 */
export function sensitiveZoneMatches(detections: Detection[], cameras: string[]): WatchMatch[] {
  if (cameras.length === 0) return [];
  const wanted = new Set(cameras.map((c) => norm(c)));
  const matches: WatchMatch[] = [];
  for (const d of detections) {
    if (wanted.has(norm(d.cameraName)) || wanted.has(norm(d.cameraId))) {
      matches.push({
        rule: { kind: 'sensitive-zone', value: d.cameraName, raw: `sensitive-zone:${d.cameraName}` },
        detection: d,
        matchedValue: d.cameraName,
      });
    }
  }
  return matches;
}

/**
 * A person detection where a face was seen but not matched to any known
 * face group — the honest definition of "unknown", as opposed to every
 * person being "unknown" by default when face recognition isn't running at all.
 */
export function unknownPersonDetections(detections: Detection[], opts: MatcherOptions): Detection[] {
  return detections.filter((d) => {
    if (!d.types.includes('person')) return false;
    if (!hasFaceDetection(d.raw)) return false; // no face at all -- not a meaningful "unknown", just no data
    return !faceNameOf(d, opts);
  });
}

/**
 * The name Protect itself has already put on this detection — a known face
 * group or a named vehicle — regardless of whether it's on your watch_list
 * at all. Undefined for an unrecognised face, an unread/unnamed plate, or a
 * detection with no face/vehicle thumbnail. Used to label PDF thumbnails so
 * a recognised face or car shows its name even when you haven't watch-listed
 * it, distinct from the highlighted `watch_list` matches.
 */
export function recognisedLabelOf(d: Detection, opts: MatcherOptions): string | undefined {
  if (d.types.includes('person')) {
    const name = faceNameOf(d, opts);
    if (name) return name;
  }
  if (d.types.includes('vehicle')) {
    const { name } = plateValuesOf(d, opts);
    if (name) return name;
  }
  return undefined;
}

/**
 * Everything the incident log's "Index" column can show for one detection —
 * richer than recognisedLabelOf. Falls back to the raw plate string when a
 * vehicle has no friendly name yet, and to "no match" when a face was
 * detected but not recognised (as opposed to no face data at all, which has
 * nothing to say and returns undefined, same as recognisedLabelOf).
 */
export function indexLabelOf(d: Detection, opts: MatcherOptions): string | undefined {
  const recognised = recognisedLabelOf(d, opts);
  if (recognised) return recognised;
  if (d.types.includes('person') && hasFaceDetection(d.raw)) return 'no match';
  if (d.types.includes('vehicle')) {
    const plate = extractPlate(d.raw);
    if (plate) return plate;
  }
  return undefined;
}
