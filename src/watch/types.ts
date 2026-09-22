import type { Detection, Incident } from '../protect/types.js';

export type WatchKind = 'face' | 'plate' | 'unknown-person' | 'camera' | 'sensitive-zone';

export interface WatchRule {
  kind: WatchKind;
  /** What the user typed, e.g. "Dirk" or "AB12 CDE". Case-insensitive, trimmed. */
  value: string;
  /** Original config line, for logging when a rule never matches all night. */
  raw: string;
}

export interface WatchMatch {
  rule: WatchRule;
  detection: Detection;
  /** The value actually read out of the event metadata that satisfied the rule. */
  matchedValue: string;
}

/** A cluster of detections plausibly following one subject across cameras. */
export interface CrossCameraTrail {
  cameras: string[];
  start: number;
  end: number;
  detections: Detection[];
  /** This is a heuristic (time + adjacency), never a confirmed re-identification. */
  confidence: 'heuristic';
}

export interface ScoredIncident {
  incident: Incident;
  /** 0-100. Not a probability — a relative "how much does this deserve a look" score. */
  significance: number;
  label: 'routine' | 'notable' | 'significant';
  reasons: string[];
  watchMatches: WatchMatch[];
}

export interface NightBrief {
  headline: string;
  bullets: string[];
  topIncidents: ScoredIncident[];
  watchMatches: WatchMatch[];
  trendNote: string | null;
}
