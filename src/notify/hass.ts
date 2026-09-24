import { log } from '../logger.js';

/**
 * Fires a Home Assistant notify service via the Supervisor's proxied Core
 * API. Only works when the add-on's config.yaml sets `homeassistant_api: true`
 * (which injects SUPERVISOR_TOKEN and grants access to Core's REST API through
 * the Supervisor proxy) — this is a no-op with a log line if that token isn't
 * present, so it's safe to call unconditionally.
 *
 * `service` is the part after "notify." — e.g. "mobile_app_johns_phone" or
 * plain "notify" to fan out to every configured notify target. `extraData`
 * is passed through verbatim as the Companion App's `data` payload (e.g.
 * critical-alert flags) — see notify/critical.ts.
 */
export async function notifyHass(
  service: string,
  title: string,
  message: string,
  extraData?: Record<string, unknown>,
): Promise<void> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    log.debug('SUPERVISOR_TOKEN not set (homeassistant_api not enabled?) — skipping HA notification');
    return;
  }
  if (!service) return;

  try {
    const res = await fetch(`http://supervisor/core/api/services/notify/${service}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(extraData ? { title, message, data: extraData } : { title, message }),
    });
    if (!res.ok) {
      log.warn(`HA notify.${service} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return;
    }
    log.info(`Sent HA notification via notify.${service}`);
  } catch (err) {
    log.warn(`HA notify.${service} failed: ${(err as Error).message}`);
  }
}
