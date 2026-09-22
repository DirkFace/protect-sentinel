/**
 * Extractors for UniFi Protect's actual smart-detect event shape.
 *
 * Confirmed against a real controller (firmware/console version unknown,
 * captured via `sentinel inspect`): a face/person event carries
 * `metadata.detectedThumbnails`, an array with one entry per detected
 * object — `{ type: "person", ... }` and, when a face was also picked up,
 * a separate `{ type: "face", name: "...", group: { name: "..." }, ... }`
 * entry. A matched face's name sits at the top level of that entry AND
 * under `group.name` / `attributes.matchedName` (all three lined up in the
 * sample we saw) — this reads all three and takes whichever exists first.
 *
 * Licence plates: CONFIRMED against both an unrecognised plate read and a
 * named ("known") vehicle. A plate read does NOT get its own
 * `detectedThumbnails` entry — it lives on the `vehicle`-typed entry
 * itself, flagged by `smartDetectTypes` including `"licensePlate"`
 * alongside `"vehicle"`.
 *
 * Unlike faces, the fields do NOT all line up once a vehicle has been named
 * in Protect (the vehicle equivalent of a face group):
 *   - Unrecognised plate: top-level `name`, `attributes.matchedName`, and
 *     `group.matchedName` are all the same raw OCR string (e.g. "SO64FVU"),
 *     and `group.name` is absent (`groupType:unknown` in `labels`).
 *   - Named ("known") vehicle: top-level `name` and `group.name` hold the
 *     FRIENDLY NAME you gave it in Protect (e.g. "Graham"), while the raw
 *     plate only survives in `attributes.matchedName` / `group.matchedName`
 *     (e.g. "FV65OAE") — `groupType:known` in `labels`.
 * So a plate rule needs to check both the friendly name and the raw plate
 * to work regardless of whether the vehicle has been named yet.
 */

type RawEvent = Record<string, unknown> | undefined;

interface DetectedThumbnail {
  type?: string;
  name?: string;
  group?: { name?: string; matchedName?: string };
  attributes?: { matchedName?: string; name?: string; plate?: string };
  labels?: string[];
}

function detectedThumbnails(raw: RawEvent): DetectedThumbnail[] {
  const metadata = raw?.metadata as Record<string, unknown> | undefined;
  const thumbs = metadata?.detectedThumbnails;
  return Array.isArray(thumbs) ? (thumbs as DetectedThumbnail[]) : [];
}

/** The recognised name on a matched face, if this event includes one. Undefined if no face, or an unmatched/unknown face. */
export function extractFaceName(raw: RawEvent): string | undefined {
  const face = detectedThumbnails(raw).find((t) => t.type === 'face');
  if (!face) return undefined;
  const name = face.name ?? face.group?.name ?? face.attributes?.matchedName;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

/** True if this event has a face detection at all (matched or not). */
export function hasFaceDetection(raw: RawEvent): boolean {
  return detectedThumbnails(raw).some((t) => t.type === 'face');
}

function vehicleThumb(raw: RawEvent): DetectedThumbnail | undefined {
  return detectedThumbnails(raw).find((t) => t.type === 'vehicle');
}

/**
 * The raw OCR plate string, if this event's vehicle detection includes a
 * plate read — regardless of whether the vehicle has also been given a
 * friendly name in Protect. Undefined if no plate was read at all.
 */
export function extractPlate(raw: RawEvent): string | undefined {
  const vehicle = vehicleThumb(raw);
  const val = vehicle?.attributes?.matchedName ?? vehicle?.group?.matchedName;
  return typeof val === 'string' && val.trim() ? val.trim() : undefined;
}

/**
 * The friendly name given to this vehicle in Protect (its "known vehicle"
 * label, e.g. "Graham" or "Josh's van"), if any. Undefined for an
 * unrecognised plate — i.e. when the top-level name is just the same raw
 * plate string as `extractPlate`, there's no friendly name to report.
 */
export function extractVehicleName(raw: RawEvent): string | undefined {
  const vehicle = vehicleThumb(raw);
  const name = (vehicle?.name ?? vehicle?.group?.name)?.trim();
  if (!name) return undefined;
  const plate = extractPlate(raw);
  return name === plate ? undefined : name;
}

/** True if this event's vehicle detection includes a plate read at all (named or not). */
export function hasPlateDetection(raw: RawEvent): boolean {
  return extractPlate(raw) !== undefined;
}
