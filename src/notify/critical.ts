/**
 * The Companion App `data` payload that makes a push notification bypass
 * silent/Do Not Disturb and show at the top of the lock screen — see
 * https://companion.home-assistant.io/docs/notifications/critical-notifications
 *
 * iOS and Android use different fields (`push.interruption-level` vs
 * `priority`/`ttl`/`channel`), but they're safe to send together in one
 * call: each platform's app only reads the fields it understands and
 * ignores the rest, so a single toggle works for both from the add-on's
 * side. What it can't do from here: on both platforms, actually bypassing
 * Do Not Disturb needs a one-time permission granted on the phone itself
 * (iOS: enable "Critical Alerts" for the Home Assistant app in Settings →
 * Notifications; Android: allow the "alarm_stream" channel to override Do
 * Not Disturb in the app's own notification channel settings). Without
 * that, this still gets a louder, more immediate notification — just not
 * a guaranteed DND bypass.
 */
export const CRITICAL_PUSH_DATA: Record<string, unknown> = {
  push: { 'interruption-level': 'critical' },
  priority: 'high',
  ttl: 0,
  channel: 'alarm_stream',
};
