import type { Detection } from '../protect/types.js';
import type { CrossCameraTrail } from './types.js';

/**
 * Groups detections that plausibly belong to one subject moving between
 * cameras: same detect type, different camera, start times within
 * `windowSeconds` of each other, chained transitively (A→B→C counts even if
 * A and C alone are too far apart).
 *
 * This is a heuristic, not identity tracking — UniFi's local API doesn't
 * expose a reliable subject ID that follows someone across separate camera
 * streams. Two different people walking past two doorbells thirty seconds
 * apart will look identical to this. Treat trails as "worth a glance", not fact.
 */
export function correlateCrossCamera(
  detections: Detection[],
  windowSeconds: number,
): CrossCameraTrail[] {
  if (windowSeconds <= 0) return [];
  const windowMs = windowSeconds * 1000;
  const sorted = [...detections].sort((a, b) => a.start - b.start);

  const trails: CrossCameraTrail[] = [];
  let current: Detection[] = [];

  const flush = () => {
    const cameras = new Set(current.map((d) => d.cameraId));
    if (current.length > 1 && cameras.size > 1) {
      trails.push({
        cameras: [...new Set(current.map((d) => d.cameraName))],
        start: current[0]!.start,
        end: Math.max(...current.map((d) => d.end ?? d.start)),
        detections: [...current],
        confidence: 'heuristic',
      });
    }
    current = [];
  };

  for (const d of sorted) {
    const last = current[current.length - 1];
    const sameSubjectType = !last || d.types.some((t) => last.types.includes(t));
    const withinWindow = !last || d.start - (last.end ?? last.start) <= windowMs;
    const differentCamera = !last || d.cameraId !== last.cameraId;

    if (last && withinWindow && sameSubjectType && (differentCamera || d.cameraId === last.cameraId)) {
      current.push(d);
    } else {
      flush();
      current = [d];
    }
  }
  flush();

  return trails.sort((a, b) => a.start - b.start);
}
