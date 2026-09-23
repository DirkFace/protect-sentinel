import fs from "node:fs";
import { spawn } from "node:child_process";

const optionsPath = "/data/options.json";
const options = JSON.parse(fs.readFileSync(optionsPath, "utf8"));

const env = {
  ...process.env,
  PROTECT_HOST: String(options.protect_host ?? ""),
  PROTECT_PORT: String(options.protect_port ?? 443),
  PROTECT_USERNAME: String(options.protect_username ?? ""),
  PROTECT_PASSWORD: String(options.protect_password ?? ""),
  PROTECT_API_KEY: String(options.protect_api_key ?? ""),
  PROTECT_VERIFY_TLS: String(options.protect_verify_tls ?? false),
  TZ_NAME: String(options.timezone ?? "Europe/London"),
  NIGHT_START: String(options.night_start ?? "22:00"),
  NIGHT_END: String(options.night_end ?? "06:00"),
  DETECT_TYPES: String(options.detect_types ?? "person"),
  MIN_SCORE: String(options.min_score ?? 0),
  CLUSTER_GAP_SECONDS: String(options.cluster_gap_seconds ?? 60),
  EXCLUDE_CAMERAS: String(options.exclude_cameras ?? ""),
  INCLUDE_CAMERAS: String(options.include_cameras ?? ""),
  REPORT_TITLE: String(options.report_title ?? "Overnight Person Detection Report"),
  SITE_NAME: String(options.site_name ?? ""),
  MAX_THUMBS_PER_CAMERA: String(options.max_thumbs_per_camera ?? 12),
  THUMB_WIDTH: String(options.thumb_width ?? 640),
  INCLUDE_EVENT_TABLE: String(options.include_event_table ?? true),
  SEND_IF_EMPTY: String(options.send_if_empty ?? true),
  SMTP_HOST: String(options.smtp_host ?? ""),
  SMTP_PORT: String(options.smtp_port ?? 587),
  SMTP_SECURE: String(options.smtp_secure ?? false),
  SMTP_USER: String(options.smtp_user ?? ""),
  SMTP_PASS: String(options.smtp_pass ?? ""),
  MAIL_FROM: String(options.mail_from ?? ""),
  MAIL_TO: String(options.mail_to ?? ""),
  MAIL_CC: String(options.mail_cc ?? ""),
  MAIL_SUBJECT: String(options.mail_subject ?? "{site}Overnight person detections — {date} ({count})"),
  CRON: String(options.cron ?? "30 6 * * *"),
  OUT_DIR: "/share/protect_sentinel",
  STATE_FILE: "/data/last-state.json",
  RETAIN_DAYS: String(options.retain_days ?? 30),
  LOG_LEVEL: String(options.log_level ?? "info"),

  // ── Watch engine (new in v2) ─────────────────────────────────────────
  WATCH_LIST: String(options.watch_list ?? ""),
  FACE_NAME_FIELD: String(options.face_name_field ?? ""),
  PLATE_NAME_FIELD: String(options.plate_name_field ?? ""),
  FLAG_UNKNOWN_PERSON: String(options.flag_unknown_person ?? false),
  SENSITIVE_CAMERAS: String(options.sensitive_cameras ?? ""),
  SENSITIVE_DETECT_TYPES: String(options.sensitive_detect_types ?? ""),
  CROSS_CAMERA_WINDOW_SECONDS: String(options.cross_camera_window_seconds ?? 45),
  TREND_LOOKBACK_NIGHTS: String(options.trend_lookback_nights ?? 14),
  MORNING_SUMMARY: String(options.morning_summary ?? true),
  NOTIFY_SERVICE: String(options.notify_service ?? ""),
  PUSH_FULL_DETAIL_ON_URGENT: String(options.push_full_detail_on_urgent ?? true),

  // ── MQTT entities (new in v2) ────────────────────────────────────────
  MQTT_HOST: String(options.mqtt_host ?? ""),
  MQTT_PORT: String(options.mqtt_port ?? 1883),
  MQTT_USERNAME: String(options.mqtt_username ?? ""),
  MQTT_PASSWORD: String(options.mqtt_password ?? ""),

  // ── Ingress panel (new in v2) ────────────────────────────────────────
  // Must match `ingress_port` in config.yaml — not user-configurable, so it's
  // not read from options.json.
  INGRESS_PORT: "8099",
};

// Forwards whatever command the caller wants (defaults to "schedule") so the
// same options.json -> env mapping works for one-off commands too, e.g.
// `node run-app.mjs inspect` or `node run-app.mjs check` via `docker exec`.
const forwardedArgs = process.argv.slice(2);
const child = spawn("node", ["dist/index.js", ...(forwardedArgs.length ? forwardedArgs : ["schedule"])], {
  cwd: "/app",
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
