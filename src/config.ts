import { z } from 'zod';

const csv = (v: string) =>
  v.split(',').map((s) => s.trim()).filter(Boolean);

const bool = z
  .string()
  .optional()
  .transform((v) => v === undefined ? undefined : /^(1|true|yes|on)$/i.test(v));

const Schema = z.object({
  // ── Controller ──────────────────────────────────────────────────────────
  PROTECT_HOST: z.string().min(1),
  PROTECT_PORT: z.coerce.number().int().positive().default(443),
  PROTECT_USERNAME: z.string().optional(),
  PROTECT_PASSWORD: z.string().optional(),
  PROTECT_API_KEY: z.string().optional(),
  PROTECT_VERIFY_TLS: bool.default('false'),
  /** Deep link back into the Protect UI. {host} and {eventId} are substituted. */
  PROTECT_EVENT_URL: z.string().default('https://{host}/protect/events/{eventId}'),

  // ── Report window ───────────────────────────────────────────────────────
  TZ_NAME: z.string().default('Europe/London'),
  /** Local clock time the night starts, on the evening BEFORE the report date. */
  NIGHT_START: z.string().regex(/^\d{1,2}:\d{2}$/).default('22:00'),
  /** Local clock time the night ends, on the report date itself. */
  NIGHT_END: z.string().regex(/^\d{1,2}:\d{2}$/).default('06:00'),

  // ── Detection filtering ─────────────────────────────────────────────────
  /** Smart-detect classes to include. */
  DETECT_TYPES: z.string().default('person').transform(csv),
  /** Drop detections below this Protect confidence score (0-100). */
  MIN_SCORE: z.coerce.number().min(0).max(100).default(0),
  /** Collapse detections on the same camera within this many seconds into one incident. */
  CLUSTER_GAP_SECONDS: z.coerce.number().int().min(0).default(60),
  /** Comma-separated camera names or IDs to exclude (e.g. indoor cams). */
  EXCLUDE_CAMERAS: z.string().default('').transform(csv),
  /** If set, ONLY these camera names or IDs are reported. */
  INCLUDE_CAMERAS: z.string().default('').transform(csv),

  // ── Report shape ────────────────────────────────────────────────────────
  REPORT_TITLE: z.string().default('Overnight Person Detection Report'),
  SITE_NAME: z.string().default(''),
  /** Max thumbnails embedded per camera section. 0 disables thumbnails. */
  MAX_THUMBS_PER_CAMERA: z.coerce.number().int().min(0).default(12),
  THUMB_WIDTH: z.coerce.number().int().positive().default(640),
  /** Include the full chronological event table appendix. */
  INCLUDE_EVENT_TABLE: bool.default('true'),
  /** Still send the report when zero detections were found. */
  SEND_IF_EMPTY: bool.default('true'),

  // ── Email ───────────────────────────────────────────────────────────────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_TO: z.string().default('').transform(csv),
  MAIL_CC: z.string().default('').transform(csv),
  MAIL_SUBJECT: z
    .string()
    .default('{site}Overnight person detections — {date} ({count})'),

  // ── Watch engine ────────────────────────────────────────────────────────
  /** "face:Dirk", "plate:AB12CDE", "camera:Front Door" — one per line or comma-separated. */
  WATCH_LIST: z.string().default(''),
  /** Manual override for a recognised face's name, if your firmware's shape differs from the confirmed default (see watch/unifi-shapes.ts). Leave blank to use it. */
  FACE_NAME_FIELD: z.string().default(''),
  /** Manual override for a read licence plate — the built-in default here is an unconfirmed guess, so this is more likely to be needed. Leave blank to try the default first. */
  PLATE_NAME_FIELD: z.string().default(''),
  /** Flag person detections where a face was seen but not matched to any known face group. */
  FLAG_UNKNOWN_PERSON: bool.default('false'),
  /**
   * Comma-separated camera names or IDs that should see NO activity at all
   * overnight (a back garden, a fuel/materials store, etc). Any smart
   * detection on one of these — of any recognised type, watch-listed or
   * not — is forced to top significance and gets its own red "URGENT"
   * banner at the very top of the PDF and top billing in the push
   * notification, distinct from ordinary watch_list matches.
   */
  SENSITIVE_CAMERAS: z.string().default('').transform(csv),
  /**
   * Smart-detect types that count as an alert on a sensitive-zone camera.
   * Independent of detect_types above — a sensitive zone can (and often
   * should) react to a wider or completely different set of types than the
   * rest of the report, e.g. including "animal" for a garden camera without
   * flooding every other camera's incident log with foxes and cats.
   * Blank means "same as detect_types".
   */
  SENSITIVE_DETECT_TYPES: z.string().default('').transform(csv),
  /** Max gap between detections on different cameras to treat as one probable cross-camera trail. 0 disables. */
  CROSS_CAMERA_WINDOW_SECONDS: z.coerce.number().int().min(0).default(45),
  /** How many recent nights to compare against for the "usual for this hour" trend baseline. */
  TREND_LOOKBACK_NIGHTS: z.coerce.number().int().min(0).default(14),
  /** Prepend a short human-readable brief above the PDF summary in the email body. */
  MORNING_SUMMARY: bool.default('true'),
  /** HA notify service to push the brief to, e.g. "mobile_app_johns_phone". Empty disables. Needs hassio_api: true. */
  NOTIFY_SERVICE: z.string().default(''),
  /**
   * Push notifications escalate by severity: quiet/routine/flagged nights
   * get a short headline only (no raw incident detail — the point is
   * "check the report", not a data dump on the lock screen). A sensitive-
   * zone alert is the one exception, since it's urgent enough to be worth
   * seeing immediately without opening anything — this includes the
   * actual time/camera in the push itself. Set false to keep even that
   * one to a generic headline.
   */
  PUSH_FULL_DETAIL_ON_URGENT: bool.default('true'),

  // ── MQTT entities ───────────────────────────────────────────────────────
  /** MQTT broker host, e.g. the Mosquitto add-on's hostname. Blank disables entity publishing entirely. */
  MQTT_HOST: z.string().default(''),
  MQTT_PORT: z.coerce.number().int().min(1).max(65535).default(1883),
  MQTT_USERNAME: z.string().default(''),
  MQTT_PASSWORD: z.string().default(''),

  // ── Scheduling / output ─────────────────────────────────────────────────
  /** Cron expression for `sentinel schedule`, in TZ_NAME. Default 06:30 daily. */
  CRON: z.string().default('30 6 * * *'),
  OUT_DIR: z.string().default('./out'),
  /** Where the last-run state (for the ingress panel's status bar) is persisted. Small JSON file, one run's worth, overwritten each time. */
  STATE_FILE: z.string().default('./out/.last-state.json'),
  /** Delete generated PDFs older than this many days. 0 keeps everything. */
  RETAIN_DAYS: z.coerce.number().int().min(0).default(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Ingress panel ───────────────────────────────────────────────────────
  /** Port the ingress web panel listens on. Must match `ingress_port` in config.yaml. 0 disables it. */
  INGRESS_PORT: z.coerce.number().int().min(0).default(8099),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;

  const hasLocalAccount = Boolean(cfg.PROTECT_USERNAME && cfg.PROTECT_PASSWORD);
  if (!hasLocalAccount && !cfg.PROTECT_API_KEY) {
    throw new Error(
      'Set PROTECT_USERNAME + PROTECT_PASSWORD (recommended) or PROTECT_API_KEY.',
    );
  }
  return cfg;
}

/** Parse "HH:MM" into {hour, minute}. */
export function parseClock(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return { hour: Number(h), minute: Number(m) };
}
