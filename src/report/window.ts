import { DateTime } from 'luxon';
import { parseClock } from '../config.js';

export interface NightWindow {
  /** The morning the report is filed on, as yyyy-MM-dd in the report timezone. */
  reportDate: string;
  startMs: number;
  endMs: number;
  zone: string;
  startLabel: string;
  endLabel: string;
}

/**
 * Build the overnight window that ENDS on `reportDate`.
 *
 * With the defaults (22:00 -> 06:00) a report dated 2026-03-29 covers
 * 2026-03-28 22:00 through 2026-03-29 06:00 local time. Luxon resolves the
 * offsets, so clock-change nights are 7 or 9 hours long rather than silently
 * shifting by an hour.
 *
 * A window that does not cross midnight (e.g. 01:00 -> 06:00) is treated as
 * sitting entirely on the report date.
 */
export function buildNightWindow(
  reportDate: string,
  zone: string,
  nightStart: string,
  nightEnd: string,
): NightWindow {
  const day = DateTime.fromISO(reportDate, { zone });
  if (!day.isValid) throw new Error(`Invalid report date "${reportDate}": ${day.invalidReason}`);

  const s = parseClock(nightStart);
  const e = parseClock(nightEnd);
  const crossesMidnight = s.hour * 60 + s.minute >= e.hour * 60 + e.minute;

  const start = (crossesMidnight ? day.minus({ days: 1 }) : day).set({
    hour: s.hour,
    minute: s.minute,
    second: 0,
    millisecond: 0,
  });
  const end = day.set({ hour: e.hour, minute: e.minute, second: 0, millisecond: 0 });

  return {
    reportDate: day.toISODate()!,
    startMs: start.toMillis(),
    endMs: end.toMillis(),
    zone,
    startLabel: start.toFormat('ccc d LLL yyyy HH:mm'),
    endLabel: end.toFormat('ccc d LLL yyyy HH:mm'),
  };
}

/** Most recent completed night: yesterday evening through this morning. */
export function lastNight(zone: string, nightStart: string, nightEnd: string): NightWindow {
  return buildNightWindow(DateTime.now().setZone(zone).toISODate()!, zone, nightStart, nightEnd);
}

/**
 * An arbitrary, explicitly-bounded window — NOT derived from `night_start`/
 * `night_end` at all. Used for one-off ad-hoc runs (e.g. the ingress
 * panel's custom-range form) where the caller wants "show me exactly this
 * span", not "the configured overnight window for some date".
 *
 * `reportDate` gets a synthetic, non-ISO-date value (`adhoc-yyyyLLdd-HHmm-HHmm`)
 * deliberately — it's used both as the PDF's filename stem and as the key
 * into trend history (see `watch/trends.ts`). A synthetic key can never
 * collide with a real calendar date, so an ad-hoc run never overwrites or
 * gets mixed into a real night's trend baseline, and always gets its own
 * distinctly-named PDF rather than clobbering a real dated report.
 */
export function adhocWindow(startMs: number, endMs: number, zone: string): NightWindow {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('Ad-hoc window bounds must be finite timestamps');
  }
  if (endMs <= startMs) {
    throw new Error('Ad-hoc window end must be after its start');
  }
  const start = DateTime.fromMillis(startMs, { zone });
  const end = DateTime.fromMillis(endMs, { zone });

  return {
    reportDate: `adhoc-${start.toFormat('yyyyLLdd-HHmm')}-${end.toFormat('HHmm')}`,
    startMs,
    endMs,
    zone,
    startLabel: start.toFormat('ccc d LLL yyyy HH:mm'),
    endLabel: end.toFormat('ccc d LLL yyyy HH:mm'),
  };
}

export function fmtTime(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toFormat('HH:mm:ss');
}

/** HH:mm only, no seconds — for space-constrained contexts like a push notification. */
export function fmtTimeShort(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toFormat('HH:mm');
}

export function fmtDateTime(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toFormat('ccc d LLL HH:mm:ss');
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
