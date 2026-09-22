import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { NightState } from '../notify/mqtt.js';
import { log } from '../logger.js';

/**
 * Persists the most recent run's state (the same values published to MQTT)
 * so the ingress panel can show it without depending on MQTT at all — it
 * works identically whether or not `mqtt_host` is configured. Deliberately
 * keeps only the latest run, no history: a single small JSON file at
 * `cfg.STATE_FILE`, overwritten every run.
 */

export async function writeLastState(cfg: Config, state: NightState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cfg.STATE_FILE), { recursive: true });
    await fs.writeFile(cfg.STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    // Best-effort — the panel just falls back to "no state yet" if this
    // fails, and the run itself (PDF, email, MQTT) is unaffected.
    log.warn(`Could not write last-run state file: ${(err as Error).message}`);
  }
}

export async function readLastState(cfg: Config): Promise<NightState | null> {
  try {
    const raw = await fs.readFile(cfg.STATE_FILE, 'utf8');
    return JSON.parse(raw) as NightState;
  } catch {
    return null;
  }
}
