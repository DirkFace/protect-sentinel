import type { WatchKind, WatchRule } from './types.js';

/**
 * Parses the WATCH_LIST env var. One rule per line (or comma-separated),
 * prefixed by kind:
 *
 *   face:Dirk
 *   plate:AB12 CDE
 *   camera:Front Door
 *
 * "unknown-person" is a standalone toggle (FLAG_UNKNOWN_PERSON), not a value
 * here — there's nothing to name.
 */
export function parseWatchList(raw: string): WatchRule[] {
  const rules: WatchRule[] = [];
  for (const line of raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(face|plate|camera)\s*:\s*(.+)$/i.exec(line);
    if (!m) {
      throw new Error(
        `WATCH_LIST entry "${line}" isn't understood. Use "face:Name", "plate:AB12CDE" or "camera:Name".`,
      );
    }
    const kind = m[1]!.toLowerCase() as WatchKind;
    const value = m[2]!.trim();
    rules.push({ kind, value, raw: line });
  }
  return rules;
}
