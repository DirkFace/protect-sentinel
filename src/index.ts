#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { loadConfig } from './config.js';
import { log, setLogLevel } from './logger.js';
import { ProtectClient } from './protect/client.js';
import { runOnce } from './run.js';
import { verifySmtp } from './mail/mailer.js';
import { lastNight } from './report/window.js';
import { startIngressServer } from './server/ingress.js';
import { connectMqtt, publishRunError } from './notify/mqtt.js';

loadDotEnv();

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith('-')) ?? 'help';
const flag = (name: string): boolean => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  if (command === 'help' || flag('help')) return usage();

  const cfg = loadConfig();
  setLogLevel(cfg.LOG_LEVEL);

  switch (command) {
    case 'run': {
      const result = await runOnce(cfg, {
        date: value('date'),
        demo: flag('demo'),
        email: !flag('no-email'),
        outDir: value('out'),
      });
      log.info(
        `Done: ${result.incidents} incidents / ${result.detections} detections · ${result.pdfPath}` +
          (result.emailed ? ' · emailed' : ''),
      );
      break;
    }

    case 'schedule': {
      if (!cron.validate(cfg.CRON)) throw new Error(`Invalid CRON expression: ${cfg.CRON}`);
      log.info(`Scheduled "${cfg.CRON}" (${cfg.TZ_NAME}); covering ${cfg.NIGHT_START}–${cfg.NIGHT_END}`);
      if (cfg.INGRESS_PORT > 0) startIngressServer(cfg, cfg.INGRESS_PORT);
      connectMqtt(cfg);
      if (flag('run-now')) await safeRun(cfg);
      cron.schedule(cfg.CRON, () => void safeRun(cfg), { timezone: cfg.TZ_NAME });
      process.on('SIGTERM', () => process.exit(0));
      break;
    }

    case 'check': {
      const window = lastNight(cfg.TZ_NAME, cfg.NIGHT_START, cfg.NIGHT_END);
      log.info(`Window would be ${window.startLabel} → ${window.endLabel}`);
      const client = new ProtectClient({
        host: cfg.PROTECT_HOST,
        port: cfg.PROTECT_PORT,
        username: cfg.PROTECT_USERNAME,
        password: cfg.PROTECT_PASSWORD,
        apiKey: cfg.PROTECT_API_KEY,
        verifyTls: cfg.PROTECT_VERIFY_TLS,
      });
      await client.login();
      const cameras = await client.getCameras();
      log.info(`${cameras.length} cameras:`);
      for (const c of cameras) {
        console.log(`  ${c.isConnected ? '●' : '○'} ${c.name}  (${c.id})`);
      }
      const events = await client.getSmartDetectEvents(window.startMs, window.endMs);
      log.info(`${events.length} smart-detect events in the last night window`);
      await client.close();
      if (cfg.SMTP_HOST) await verifySmtp(cfg);
      break;
    }

    case 'inspect': {
      const window = lastNight(cfg.TZ_NAME, cfg.NIGHT_START, cfg.NIGHT_END);
      const client = new ProtectClient({
        host: cfg.PROTECT_HOST,
        port: cfg.PROTECT_PORT,
        username: cfg.PROTECT_USERNAME,
        password: cfg.PROTECT_PASSWORD,
        apiKey: cfg.PROTECT_API_KEY,
        verifyTls: cfg.PROTECT_VERIFY_TLS,
      });
      await client.login();
      const events = await client.getSmartDetectEvents(window.startMs, window.endMs);
      const n = Number(value('n') ?? '3');
      log.info(
        `Raw metadata for up to ${n} event(s), so you can find the dot-path for FACE_NAME_FIELD / ` +
          `PLATE_NAME_FIELD. Look for whatever field holds a recognised name or a plate string.`,
      );
      for (const ev of events.slice(0, n)) {
        console.log(`\n── event ${ev.id} (${ev.smartDetectTypes?.join(',')}) on camera ${ev.camera} — full raw event ──`);
        console.log(JSON.stringify(ev, null, 2));
      }
      if (events.length === 0) log.warn('No smart-detect events in the last night window to inspect.');
      await client.close();
      break;
    }

    case 'test-mail': {
      await verifySmtp(cfg);
      await runOnce(cfg, { demo: true, email: true, outDir: value('out') });
      break;
    }

    default:
      usage();
      process.exitCode = 1;
  }
}

async function safeRun(cfg: ReturnType<typeof loadConfig>): Promise<void> {
  try {
    const r = await runOnce(cfg, {});
    log.info(`Scheduled run complete: ${r.incidents} incidents, emailed=${r.emailed}`);
  } catch (err) {
    log.error(`Scheduled run failed: ${(err as Error).message}`, err);
    publishRunError((err as Error).message);
  }
}

function usage(): void {
  console.log(`protect-sentinel — overnight UniFi Protect person-detection reports

  sentinel run [--date YYYY-MM-DD] [--demo] [--no-email] [--out DIR]
      Build one report. --date is the MORNING the report is filed on.
      --demo uses synthetic detections so you can check the layout offline.

  sentinel schedule [--run-now]
      Stay resident and build the report on the CRON schedule.

  sentinel check
      Verify controller login, list cameras, count last night's events,
      and verify SMTP if configured.

  sentinel inspect [--n COUNT]
      Dump raw metadata for last night's events, to find the field names for
      FACE_NAME_FIELD / PLATE_NAME_FIELD (varies by firmware/camera).

  sentinel test-mail
      Verify SMTP then email a demo report to MAIL_TO.

Configuration is read from the environment, or a .env beside the process.
See .env.example.`);
}

/** Minimal .env support so the tool works without an extra dependency. */
function loadDotEnv(): void {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(file);
    return;
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const key = m[1]!;
    let val = (m[2] ?? '').trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

main().catch((err) => {
  log.error((err as Error).message);
  process.exitCode = 1;
});
