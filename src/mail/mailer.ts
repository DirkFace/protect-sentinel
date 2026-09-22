import nodemailer from 'nodemailer';
import type { Config } from '../config.js';
import { log } from '../logger.js';
import type { ReportData } from '../report/aggregate.js';
import { fmtTime } from '../report/window.js';

export function buildSubject(template: string, data: ReportData, siteName: string): string {
  return template
    .replaceAll('{site}', siteName ? `${siteName} — ` : '')
    .replaceAll('{date}', data.window.reportDate)
    .replaceAll('{count}', String(data.totals.detections))
    .replaceAll('{incidents}', String(data.totals.incidents))
    .replaceAll('{cameras}', String(data.totals.cameras));
}

export function buildBody(
  data: ReportData,
  siteName: string,
  brief?: { text: string; html: string },
): { text: string; html: string } {
  const { zone } = data.window;
  const header = [siteName, `${data.window.startLabel} → ${data.window.endLabel}`]
    .filter(Boolean)
    .join(' · ');

  const lines = data.byCamera.map(
    (c) =>
      `${c.cameraName}: ${c.incidents} incident${c.incidents === 1 ? '' : 's'} (${c.detections} detections), ` +
      `${fmtTime(c.firstMs, zone)}–${fmtTime(c.lastMs, zone)}`,
  );

  const text = [
    header,
    '',
    ...(brief?.text ? [brief.text, ''] : []),
    data.totals.detections === 0
      ? 'No person detections during the overnight window.'
      : `${data.totals.incidents} incidents across ${data.totals.cameras} cameras (${data.totals.detections} detections).`,
    '',
    ...lines,
    '',
    'Full report attached as PDF.',
  ].join('\n');

  const rows = data.byCamera
    .map(
      (c) =>
        `<tr><td style="padding:5px 12px 5px 0">${escapeHtml(c.cameraName)}</td>` +
        `<td style="padding:5px 12px 5px 0;text-align:right">${c.incidents}</td>` +
        `<td style="padding:5px 12px 5px 0;text-align:right">${c.detections}</td>` +
        `<td style="padding:5px 0;text-align:right;color:#6b7484">${fmtTime(c.firstMs, zone)}–${fmtTime(c.lastMs, zone)}</td></tr>`,
    )
    .join('');

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2c3340;font-size:14px;line-height:1.5">
  <p style="margin:0 0 4px;font-size:12px;color:#6b7484;letter-spacing:.06em;text-transform:uppercase">Overnight person detections</p>
  <p style="margin:0 0 16px;font-size:15px;color:#101522"><strong>${escapeHtml(header)}</strong></p>
  ${brief?.html ?? ''}
  <p style="margin:0 0 16px">${
    data.totals.detections === 0
      ? 'No person detections during the overnight window.'
      : `<strong>${data.totals.incidents}</strong> incidents across <strong>${data.totals.cameras}</strong> cameras (${data.totals.detections} detections).`
  }</p>
  ${
    rows
      ? `<table style="border-collapse:collapse;font-size:13px">
    <tr style="font-size:11px;color:#6b7484;text-transform:uppercase">
      <th style="text-align:left;padding:0 12px 6px 0">Camera</th>
      <th style="text-align:right;padding:0 12px 6px 0">Incidents</th>
      <th style="text-align:right;padding:0 12px 6px 0">Detections</th>
      <th style="text-align:right;padding:0 0 6px">Window</th>
    </tr>${rows}</table>`
      : ''
  }
  <p style="margin:18px 0 0;color:#6b7484;font-size:12px">Full report with stills attached as PDF.</p>
</div>`;

  return { text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export async function sendReport(
  cfg: Config,
  data: ReportData,
  pdf: Buffer,
  filename: string,
  brief?: { text: string; html: string },
): Promise<void> {
  if (!cfg.SMTP_HOST) throw new Error('SMTP_HOST is not set; cannot email the report.');
  if (cfg.MAIL_TO.length === 0) throw new Error('MAIL_TO is empty; nobody to send the report to.');

  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? '' } : undefined,
  });

  const { text, html } = buildBody(data, cfg.SITE_NAME, brief);
  const info = await transport.sendMail({
    from: cfg.MAIL_FROM ?? cfg.SMTP_USER,
    to: cfg.MAIL_TO,
    cc: cfg.MAIL_CC.length ? cfg.MAIL_CC : undefined,
    subject: buildSubject(cfg.MAIL_SUBJECT, data, cfg.SITE_NAME),
    text,
    html,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  });

  log.info(`Emailed report to ${cfg.MAIL_TO.join(', ')} (${info.messageId})`);
}

export async function verifySmtp(cfg: Config): Promise<void> {
  if (!cfg.SMTP_HOST) throw new Error('SMTP_HOST is not set.');
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS ?? '' } : undefined,
  });
  await transport.verify();
  log.info(`SMTP OK: ${cfg.SMTP_HOST}:${cfg.SMTP_PORT}`);
}
