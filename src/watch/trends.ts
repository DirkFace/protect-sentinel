import fs from 'node:fs/promises';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { Detection } from '../protect/types.js';
import { log } from '../logger.js';

export interface NightRecord {
  /** yyyy-MM-dd report date. */
  date: string;
  /** Count of detections per local hour-of-day (0-23), only hours inside that night's window get entries. */
  byHour: Record<number, number>;
  total: number;
}

interface Store {
  nights: NightRecord[];
}

const FILE_NAME = 'history.json';
const MAX_NIGHTS = 120;

async function load(dir: string): Promise<Store> {
  try {
    const raw = await fs.readFile(path.join(dir, FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw) as Store;
    return Array.isArray(parsed.nights) ? parsed : { nights: [] };
  } catch {
    return { nights: [] };
  }
}

async function save(dir: string, store: Store): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, FILE_NAME), JSON.stringify(store, null, 2));
}

/** Record tonight's per-hour detection counts, keeping only the most recent MAX_NIGHTS. */
export async function recordNight(
  dir: string,
  reportDate: string,
  zone: string,
  detections: Detection[],
): Promise<Store> {
  const byHour: Record<number, number> = {};
  for (const d of detections) {
    const hour = DateTime.fromMillis(d.start, { zone }).hour;
    byHour[hour] = (byHour[hour] ?? 0) + 1;
  }
  const store = await load(dir);
  const withoutTonight = store.nights.filter((n) => n.date !== reportDate);
  withoutTonight.push({ date: reportDate, byHour, total: detections.length });
  withoutTonight.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = withoutTonight.slice(-MAX_NIGHTS);
  const next = { nights: trimmed };
  await save(dir, next).catch((err) => log.warn(`Could not persist trend history: ${(err as Error).message}`));
  return next;
}

/** Average detections seen in `hour` across the last `lookbackNights` recorded nights, excluding tonight. */
export function baselineForHour(store: Store, reportDate: string, hour: number, lookbackNights: number): number {
  const prior = store.nights.filter((n) => n.date < reportDate).slice(-lookbackNights);
  if (!prior.length) return 0;
  const sum = prior.reduce((acc, n) => acc + (n.byHour[hour] ?? 0), 0);
  return sum / prior.length;
}

/**
 * "This is the third night this week with activity around 03:00" — looks for
 * an hour that had activity on tonight and on at least two of the last six
 * nights too.
 */
export function describeRepeatPattern(store: Store, reportDate: string, tonightByHour: Record<number, number>): string | null {
  const recent = store.nights.filter((n) => n.date < reportDate).slice(-6);
  const activeHoursTonight = Object.entries(tonightByHour)
    .filter(([, count]) => count > 0)
    .map(([h]) => Number(h));

  for (const hour of activeHoursTonight) {
    const priorNightsActive = recent.filter((n) => (n.byHour[hour] ?? 0) > 0).length;
    if (priorNightsActive >= 2) {
      const nightsInvolved = priorNightsActive + 1;
      return `This is the ${ordinal(nightsInvolved)} night recently with activity around ${String(hour).padStart(2, '0')}:00.`;
    }
  }
  return null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
