/** The subset of the Protect API surface this tool relies on. */

export interface ProtectCamera {
  id: string;
  name: string;
  mac?: string;
  state?: string;
  type?: string;
  isConnected?: boolean;
}

export interface ProtectEvent {
  id: string;
  type: string;
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds. May be null while an event is still open. */
  end: number | null;
  camera: string;
  score?: number;
  smartDetectTypes?: string[];
  thumbnail?: string | null;
  heatmap?: string | null;
  metadata?: Record<string, unknown>;
  /** Anything else the controller sent for this event, keyed by field name — captures whatever isn't listed above. */
  [extra: string]: unknown;
}

/** One detection, joined to its camera and normalised. */
export interface Detection {
  id: string;
  cameraId: string;
  cameraName: string;
  start: number;
  end: number | null;
  durationMs: number;
  score: number;
  types: string[];
  thumbnail?: Buffer;
  /**
   * The complete raw event object from the controller, carried through
   * unmodified so watch rules can key off any field — recognised-face names,
   * licence-plate reads etc. live somewhere in here, but the exact shape is
   * firmware/hardware dependent. Run `sentinel inspect` to see your
   * controller's actual fields before setting FACE_NAME_FIELD / PLATE_NAME_FIELD.
   */
  raw?: Record<string, unknown>;
}

/** Consecutive detections on one camera, merged into a single incident. */
export interface Incident {
  cameraId: string;
  cameraName: string;
  start: number;
  end: number;
  count: number;
  peakScore: number;
  detections: Detection[];
}
