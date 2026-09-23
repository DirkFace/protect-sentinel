import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportData } from './aggregate.js';
import { fmtDuration, fmtTime } from './window.js';
import type { WatchMatch, CrossCameraTrail } from '../watch/types.js';
import { describeWatchMatch, shortMatchTag } from '../watch/format.js';

// Resolves next to this module either way: dist/report/pdf.js in the built
// container, or src/report/pdf.ts under tsx in dev — the sibling `assets/`
// folder is populated in both cases (see package.json's `postbuild`).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_PATH = path.join(__dirname, '../assets/icon.png');

const PALETTE = {
  ink: '#101522',
  body: '#2c3340',
  muted: '#6b7484',
  hairline: '#dfe3ea',
  panel: '#f4f6f9',
  band: '#101b2d',
  accent: '#c2410c',
  accentSoft: '#fde3d3',
  ok: '#15803d',
  info: '#2563eb',
  infoSoft: '#eff6ff',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
};

const PAGE = { size: 'A4' as const, margin: 44 };

export interface PdfMeta {
  title: string;
  siteName: string;
  eventUrlTemplate?: string;
  host?: string;
  includeEventTable: boolean;
  maxThumbsPerCamera: number;
}

export function renderReport(
  data: ReportData,
  meta: PdfMeta,
  watchMatches: WatchMatch[] = [],
  trails: CrossCameraTrail[] = [],
  recognisedLabels: Map<string, string> = new Map(),
  indexLabels: Map<string, string> = new Map(),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: `${meta.title} — ${data.window.reportDate}`,
      Author: 'protect-sentinel',
      Subject: `Person detections ${data.window.startLabel} to ${data.window.endLabel}`,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  drawCover(doc, data, meta);
  drawUrgentZoneBanner(doc, data, watchMatches.filter((m) => m.rule.kind === 'sensitive-zone'), recognisedLabels);
  drawWatchlistBanner(doc, data, watchMatches.filter((m) => m.rule.kind !== 'sensitive-zone'));
  drawTrailsBanner(doc, data, trails);
  drawHistogram(doc, data);
  drawCameraTable(doc, data);
  if (meta.maxThumbsPerCamera > 0) {
    drawThumbnailSections(doc, data, meta, watchMatches, recognisedLabels);
    drawTrailStrips(doc, data, trails, watchMatches, recognisedLabels);
  }
  if (meta.includeEventTable) drawEventTable(doc, data, meta, watchMatches, indexLabels);
  drawFooters(doc, data);

  doc.end();
  return done;
}

type Doc = PDFKit.PDFDocument;
const contentWidth = (doc: Doc) => doc.page.width - PAGE.margin * 2;

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > doc.page.height - PAGE.margin - 26) doc.addPage();
}

function sectionHeading(doc: Doc, text: string): void {
  ensureSpace(doc, 48);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(PALETTE.ink)
    .text(text.toUpperCase(), PAGE.margin, doc.y, { characterSpacing: 0.8 });
  doc.moveDown(0.3);
  const y = doc.y;
  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.margin + contentWidth(doc), y)
    .lineWidth(0.75)
    .strokeColor(PALETTE.hairline)
    .stroke();
  doc.moveDown(0.8);
}

// ── cover ─────────────────────────────────────────────────────────────────

function drawCover(doc: Doc, data: ReportData, meta: PdfMeta): void {
  const w = doc.page.width;
  doc.rect(0, 0, w, 132).fill(PALETTE.band);

  const iconSize = 16;
  doc.image(ICON_PATH, PAGE.margin, 32, { width: iconSize, height: iconSize });

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#8ea3c2')
    .text('PROTECT SENTINEL', PAGE.margin + iconSize + 8, 34, { characterSpacing: 1.6 });

  doc.font('Helvetica-Bold').fontSize(23).fillColor('#ffffff').text(meta.title, PAGE.margin, 52);

  const subtitle = [meta.siteName, `${data.window.startLabel} – ${data.window.endLabel}`]
    .filter(Boolean)
    .join('  ·  ');
  doc.font('Helvetica').fontSize(10.5).fillColor('#c3d0e3').text(subtitle, PAGE.margin, 88);

  doc
    .fontSize(8.5)
    .fillColor('#7f93b1')
    .text(
      `Generated ${DateTime.now().setZone(data.window.zone).toFormat('ccc d LLL yyyy HH:mm ZZZZ')}`,
      PAGE.margin,
      106,
    );

  doc.y = 164;
  drawStatRow(doc, data);
}

function drawStatRow(doc: Doc, data: ReportData): void {
  const busiest = [...data.histogram].sort((a, b) => b.count - a.count)[0];
  const firstSeen = data.detections[0];
  const lastSeen = data.detections[data.detections.length - 1];

  const tiles = [
    { label: 'Incidents', value: String(data.totals.incidents) },
    { label: 'Detections', value: String(data.totals.detections) },
    { label: 'Cameras active', value: String(data.totals.cameras) },
    {
      label: 'Busiest half hour',
      value: busiest && busiest.count > 0 ? busiest.label : '—',
    },
  ];

  const gap = 10;
  const tileW = (contentWidth(doc) - gap * (tiles.length - 1)) / tiles.length;
  const top = doc.y;
  const tileH = 62;

  tiles.forEach((tile, i) => {
    const x = PAGE.margin + i * (tileW + gap);
    doc.roundedRect(x, top, tileW, tileH, 5).fill(PALETTE.panel);
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor(data.totals.detections === 0 ? PALETTE.ok : PALETTE.accent)
      .text(tile.value, x + 12, top + 12, { width: tileW - 24 });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(PALETTE.muted)
      .text(tile.label.toUpperCase(), x + 12, top + 42, {
        width: tileW - 24,
        characterSpacing: 0.5,
      });
  });

  doc.y = top + tileH + 18;

  const verdict =
    data.totals.detections === 0
      ? 'No person detections were recorded during the overnight window. All reporting cameras were quiet.'
      : `First detection ${fmtTime(firstSeen!.start, data.window.zone)} on ${firstSeen!.cameraName}; ` +
        `last detection ${fmtTime(lastSeen!.start, data.window.zone)} on ${lastSeen!.cameraName}.`;

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(PALETTE.body)
    .text(verdict, PAGE.margin, doc.y, { width: contentWidth(doc), lineGap: 2 });
  doc.moveDown(1.2);
}

// ── sensitive-zone banner ────────────────────────────────────────────────

/**
 * Deliberately drawn first — before even the watchlist banner — and in a
 * different colour, because the meaning is different: a watchlist match is
 * "something I'm tracking showed up", a sensitive-zone hit is "somewhere
 * that should be empty overnight was not". The camera name in
 * describeWatchMatch() already carries the specifics; this banner just
 * needs to be the first thing anyone sees.
 */
function drawUrgentZoneBanner(
  doc: Doc,
  data: ReportData,
  zoneMatches: WatchMatch[],
  recognisedLabels: Map<string, string> = new Map(),
): void {
  if (zoneMatches.length === 0) return;

  // Sensitive zones are meant to be near-silent, so a handful of hits is
  // the expected case — but cap the preview rows so a noisier-than-expected
  // night can't blow the banner past a sane page height. Every hit is still
  // counted in the heading and still drives significance/push/MQTT; only
  // the preview list itself is capped.
  const MAX_ROWS = 8;
  const shown = zoneMatches.slice(0, MAX_ROWS);
  const overflow = zoneMatches.length - shown.length;

  const w = contentWidth(doc);
  const pad = 12;
  const headingH = 18;
  const thumbW = 88;
  const thumbH = 50;
  const rowGap = 10;
  const rowH = thumbH + rowGap;
  const textX = PAGE.margin + pad + thumbW + 10;
  const textW = w - pad * 2 - thumbW - 10;
  const overflowH = overflow > 0 ? 14 : 0;
  const h = pad * 2 + headingH + shown.length * rowH + overflowH;
  ensureSpace(doc, h + 18);

  const top = doc.y;
  doc.roundedRect(PAGE.margin, top, w, h, 5).fill(PALETTE.dangerSoft);
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(PALETTE.danger)
    .text(`URGENT — SENSITIVE ZONE ACTIVITY (${zoneMatches.length})`, PAGE.margin + pad, top + pad, {
      characterSpacing: 0.6,
    });

  let y = top + pad + headingH;
  for (const m of shown) {
    const thumbX = PAGE.margin + pad;
    if (m.detection.thumbnail) {
      doc.image(m.detection.thumbnail, thumbX, y, { fit: [thumbW, thumbH], align: 'center', valign: 'center' });
    } else {
      // A preview should have been fetched for every sensitive-zone hit
      // regardless of the general thumbnail cap — this placeholder only
      // shows up if the controller genuinely had none to give (e.g. the
      // clip expired before the report ran), so the row layout stays
      // consistent either way rather than collapsing to text-only.
      doc.roundedRect(thumbX, y, thumbW, thumbH, 3).fill('#f3d4d4');
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(PALETTE.danger)
        .text('no preview', thumbX, y + thumbH / 2 - 4, { width: thumbW, align: 'center' });
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(PALETTE.danger)
      .text(`${fmtTime(m.detection.start, data.window.zone)} — ${m.detection.cameraName} (${m.detection.types.join('/')})`, textX, y + 2, {
        width: textW,
      });
    // Vary the detail line with the detection's own duration, confidence,
    // and — if Protect already put a name on it — that name, so a busier
    // night's rows are actually scannable rather than all reading
    // identically apart from the timestamp.
    const recognised = recognisedLabels.get(m.detection.id);
    const detailParts = [fmtDuration(m.detection.durationMs)];
    if (m.detection.score) detailParts.push(`${m.detection.score}% confidence`);
    if (recognised) detailParts.push(`recognised as ${recognised}`);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PALETTE.ink)
      .text(`${detailParts.join(' · ')} — this camera should be clear overnight.`, textX, y + 15, {
        width: textW,
      });

    y += rowH;
  }

  if (overflow > 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(7.5)
      .fillColor(PALETTE.danger)
      .text(`+ ${overflow} more sensitive-zone detection${overflow === 1 ? '' : 's'} tonight (not all shown here).`, PAGE.margin + pad, y, {
        width: w - pad * 2,
      });
  }

  doc.y = top + h + 20;
}

// ── watchlist banner ─────────────────────────────────────────────────────

function drawWatchlistBanner(doc: Doc, data: ReportData, watchMatches: WatchMatch[]): void {
  if (watchMatches.length === 0) return;

  const w = contentWidth(doc);
  const pad = 12;
  const lineH = 13;
  const headingH = 18;
  const h = pad * 2 + headingH + watchMatches.length * lineH;
  ensureSpace(doc, h + 18);

  const top = doc.y;
  doc.roundedRect(PAGE.margin, top, w, h, 5).fill(PALETTE.accentSoft);
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(PALETTE.accent)
    .text(`WATCHLIST MATCHES (${watchMatches.length})`, PAGE.margin + pad, top + pad, { characterSpacing: 0.6 });

  let y = top + pad + headingH;
  for (const m of watchMatches) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(PALETTE.ink)
      .text(`${fmtTime(m.detection.start, data.window.zone)} — ${describeWatchMatch(m)}`, PAGE.margin + pad, y, {
        width: w - pad * 2,
      });
    y += lineH;
  }

  doc.y = top + h + 20;
}

// ── cross-camera trails banner ───────────────────────────────────────────

function drawTrailsBanner(doc: Doc, data: ReportData, trails: CrossCameraTrail[]): void {
  if (trails.length === 0) return;

  const w = contentWidth(doc);
  const pad = 12;
  const lineH = 13;
  const headingH = 18;
  const footnoteH = 12;
  const h = pad * 2 + headingH + trails.length * lineH + footnoteH;
  ensureSpace(doc, h + 18);

  const top = doc.y;
  doc.roundedRect(PAGE.margin, top, w, h, 5).fill(PALETTE.infoSoft);
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(PALETTE.info)
    .text(`PROBABLE CROSS-CAMERA PATHS (${trails.length})`, PAGE.margin + pad, top + pad, { characterSpacing: 0.6 });

  let y = top + pad + headingH;
  for (const t of trails) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(PALETTE.ink)
      .text(`${fmtTime(t.start, data.window.zone)} — ${t.cameras.join(' -> ')}`, PAGE.margin + pad, y, {
        width: w - pad * 2,
      });
    y += lineH;
  }

  doc
    .font('Helvetica-Oblique')
    .fontSize(7)
    .fillColor(PALETTE.muted)
    .text('Heuristic (time + camera adjacency), not confirmed identity tracking.', PAGE.margin + pad, y, {
      width: w - pad * 2,
    });

  doc.y = top + h + 20;
}

// ── histogram ─────────────────────────────────────────────────────────────

function drawHistogram(doc: Doc, data: ReportData): void {
  sectionHeading(doc, 'Detections by half hour');

  const w = contentWidth(doc);
  const h = 112;
  const top = doc.y;
  const buckets = data.histogram;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barW = w / buckets.length;

  // baseline + two gridlines
  for (const frac of [0, 0.5, 1]) {
    const y = top + h - h * frac;
    doc
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.margin + w, y)
      .lineWidth(0.5)
      .strokeColor(frac === 0 ? PALETTE.hairline : '#eef1f5')
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(PALETTE.muted)
      .text(String(Math.round(max * frac)), PAGE.margin + w + 4, y - 3, { width: 20 });
  }

  buckets.forEach((b, i) => {
    const x = PAGE.margin + i * barW;
    if (b.count === 0) return;
    const barH = Math.max(2, (b.count / max) * h);
    doc
      .rect(x + barW * 0.16, top + h - barH, barW * 0.68, barH)
      .fill(b.count === max ? PALETTE.accent : '#e08a5a');
  });

  // hour labels only, to stop the axis turning to mush
  buckets.forEach((b, i) => {
    if (!b.label.endsWith(':00')) return;
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(PALETTE.muted)
      .text(b.label, PAGE.margin + i * barW - 8, top + h + 5, { width: barW + 16, align: 'center' });
  });

  doc.y = top + h + 24;
}

// ── camera table ──────────────────────────────────────────────────────────

function drawCameraTable(doc: Doc, data: ReportData): void {
  sectionHeading(doc, 'By camera');

  if (data.byCamera.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor(PALETTE.muted)
      .text('No camera recorded a person detection in this window.', PAGE.margin, doc.y);
    doc.moveDown(1);
    return;
  }

  const w = contentWidth(doc);
  const cols = [
    { key: 'camera', label: 'Camera', width: w * 0.36, align: 'left' as const },
    { key: 'incidents', label: 'Incidents', width: w * 0.12, align: 'right' as const },
    { key: 'detections', label: 'Detections', width: w * 0.13, align: 'right' as const },
    { key: 'first', label: 'First', width: w * 0.13, align: 'right' as const },
    { key: 'last', label: 'Last', width: w * 0.13, align: 'right' as const },
    { key: 'peak', label: 'Peak score', width: w * 0.13, align: 'right' as const },
  ];

  drawTableHeader(doc, cols);
  for (const row of data.byCamera) {
    ensureSpace(doc, 20);
    if (doc.y < PAGE.margin + 30) drawTableHeader(doc, cols);
    drawTableRow(doc, cols, [
      row.cameraName,
      String(row.incidents),
      String(row.detections),
      fmtTime(row.firstMs, data.window.zone),
      fmtTime(row.lastMs, data.window.zone),
      row.peakScore ? `${row.peakScore}%` : '—',
    ]);
  }

  doc.moveDown(0.8);
  if (data.quietCameras.length > 0) {
    ensureSpace(doc, 40);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PALETTE.muted)
      .text(
        `Quiet overnight (${data.quietCameras.length}): ${data.quietCameras.join(', ')}`,
        PAGE.margin,
        doc.y,
        { width: w, lineGap: 1.5 },
      );
    doc.moveDown(1);
  }
}

interface Col {
  label: string;
  width: number;
  align: 'left' | 'right';
}

function drawTableHeader(doc: Doc, cols: Col[]): void {
  ensureSpace(doc, 30);
  const y = doc.y;
  let x = PAGE.margin;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PALETTE.muted);
  for (const c of cols) {
    const fitted = fitCell(doc, c.label.toUpperCase(), c.width - 4);
    doc.text(fitted, x, y, { width: c.width, align: c.align, characterSpacing: 0.4, lineBreak: false });
    x += c.width;
  }
  const lineY = y + 12;
  doc
    .moveTo(PAGE.margin, lineY)
    .lineTo(PAGE.margin + contentWidth(doc), lineY)
    .lineWidth(0.75)
    .strokeColor(PALETTE.hairline)
    .stroke();
  doc.y = lineY + 5;
}

/**
 * Truncates text to fit maxWidth, measuring with the doc's current font —
 * PDFKit's own `ellipsis: true` combined with `lineBreak: false` does NOT
 * reliably truncate (confirmed: it silently wraps to a second line instead,
 * which then visually overlaps the next column/row). Pre-truncating like
 * this and drawing with plain single-line text avoids that entirely.
 */
function fitCell(doc: Doc, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function drawTableRow(doc: Doc, cols: Col[], values: string[]): void {
  const y = doc.y;
  let x = PAGE.margin;
  doc.font('Helvetica').fontSize(9).fillColor(PALETTE.body);
  const pad = 4; // small safety margin so text never touches the next column
  cols.forEach((c, i) => {
    const fitted = fitCell(doc, values[i] ?? '', c.width - pad);
    doc.text(fitted, x, y, { width: c.width, align: c.align, lineBreak: false });
    x += c.width;
  });
  doc.y = y + 14;
  doc
    .moveTo(PAGE.margin, doc.y - 3.5)
    .lineTo(PAGE.margin + contentWidth(doc), doc.y - 3.5)
    .lineWidth(0.4)
    .strokeColor('#f0f2f6')
    .stroke();
}

// ── thumbnail sections ────────────────────────────────────────────────────

function drawThumbnailSections(
  doc: Doc,
  data: ReportData,
  meta: PdfMeta,
  watchMatches: WatchMatch[] = [],
  recognisedLabels: Map<string, string> = new Map(),
): void {
  const withThumbs = data.byCamera.filter((c) =>
    data.detections.some((d) => d.cameraId === c.cameraId && d.thumbnail),
  );
  if (withThumbs.length === 0) return;

  const matchLabelsByDetection = new Map<string, string[]>();
  for (const m of watchMatches) {
    const list = matchLabelsByDetection.get(m.detection.id) ?? [];
    list.push(shortMatchTag(m));
    matchLabelsByDetection.set(m.detection.id, list);
  }

  doc.addPage();
  sectionHeading(doc, 'Detection stills');

  const w = contentWidth(doc);
  const perRow = 3;
  const gap = 10;
  const cellW = (w - gap * (perRow - 1)) / perRow;
  const imgH = (cellW * 9) / 16;
  const cellH = imgH + 22;

  for (const cam of withThumbs) {
    const shots = data.detections
      .filter((d) => d.cameraId === cam.cameraId && d.thumbnail)
      .slice(0, meta.maxThumbsPerCamera);

    // Keep a camera's stills together when the whole block would fit on a
    // page of its own; otherwise a four-shot camera can orphan one still.
    const rows = Math.ceil(shots.length / perRow);
    const blockH = 32 + rows * cellH;
    const pageH = doc.page.height - PAGE.margin * 2 - 26;
    const remaining = doc.page.height - PAGE.margin - 26 - doc.y;
    if (blockH > remaining && blockH <= pageH) doc.addPage();

    ensureSpace(doc, cellH + 40);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(PALETTE.ink)
      .text(cam.cameraName, PAGE.margin, doc.y);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PALETTE.muted)
      .text(
        `${cam.incidents} incident${cam.incidents === 1 ? '' : 's'} · ${cam.detections} detections · showing ${shots.length}`,
        PAGE.margin,
        doc.y + 1,
      );
    doc.moveDown(0.6);

    shots.forEach((d, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) {
        const pageBefore = doc.bufferedPageRange().count;
        ensureSpace(doc, cellH + 6);
        if (doc.bufferedPageRange().count > pageBefore) {
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(PALETTE.ink)
            .text(`${cam.cameraName} (continued)`, PAGE.margin, doc.y);
          doc.moveDown(0.6);
        }
      }
      const rowTop = doc.y;
      const x = PAGE.margin + col * (cellW + gap);

      doc.rect(x, rowTop, cellW, imgH).fill('#0c0f14');
      try {
        doc.image(d.thumbnail!, x, rowTop, { fit: [cellW, imgH], align: 'center', valign: 'center' });
      } catch {
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#6b7484')
          .text('image unavailable', x, rowTop + imgH / 2 - 4, { width: cellW, align: 'center' });
      }

      const matchLabels = matchLabelsByDetection.get(d.id);
      if (matchLabels?.length) {
        doc.rect(x, rowTop, cellW, imgH).lineWidth(2.5).strokeColor(PALETTE.accent).stroke();
      }
      // A name Protect has already put on this face/vehicle even when it
      // isn't on watch_list — shown plainly, not with the watch-match
      // orange highlight, so the two stay visually distinct.
      const recognised = !matchLabels?.length ? recognisedLabels.get(d.id) : undefined;

      const baseCaption = `${fmtTime(d.start, data.window.zone)} · ${fmtDuration(d.durationMs)}${d.score ? ` · ${d.score}%` : ''}`;
      const caption = matchLabels?.length
        ? `${baseCaption} · * ${matchLabels.join(', ')}`
        : recognised
          ? `${baseCaption} · (${recognised})`
          : baseCaption;
      doc.font(matchLabels?.length ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(matchLabels?.length ? PALETTE.accent : PALETTE.body);
      if (meta.eventUrlTemplate && meta.host) {
        const link = meta.eventUrlTemplate
          .replaceAll('{host}', meta.host)
          .replaceAll('{eventId}', d.id);
        doc.text(caption, x, rowTop + imgH + 4, { width: cellW, link, underline: false });
      } else {
        doc.text(caption, x, rowTop + imgH + 4, { width: cellW });
      }

      doc.y = col === perRow - 1 || i === shots.length - 1 ? rowTop + cellH : rowTop;
    });

    doc.moveDown(0.8);
  }
}

// ── cross-camera trail strips ────────────────────────────────────────────

/** Small filled triangle pointing right, used as a connector between trail stills. */
function drawArrow(doc: Doc, cx: number, cy: number): void {
  const s = 5;
  doc
    .moveTo(cx - s, cy - s)
    .lineTo(cx + s, cy)
    .lineTo(cx - s, cy + s)
    .closePath()
    .fill(PALETTE.info);
}

function drawTrailStrips(
  doc: Doc,
  data: ReportData,
  trails: CrossCameraTrail[],
  watchMatches: WatchMatch[],
  recognisedLabels: Map<string, string> = new Map(),
): void {
  const withThumbs = trails.filter((t) => t.detections.some((d) => d.thumbnail));
  if (withThumbs.length === 0) return;

  const matchLabelsByDetection = new Map<string, string[]>();
  for (const m of watchMatches) {
    const list = matchLabelsByDetection.get(m.detection.id) ?? [];
    list.push(shortMatchTag(m));
    matchLabelsByDetection.set(m.detection.id, list);
  }

  doc.addPage();
  sectionHeading(doc, 'Cross-camera trails, in path order');
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor(PALETTE.muted)
    .text('Heuristic (time + camera adjacency), not confirmed identity tracking — see the trail list on page 1.', PAGE.margin, doc.y);
  doc.moveDown(0.8);

  const w = contentWidth(doc);
  const perRow = 4;
  const gap = 22; // extra room for the arrow connector between cells
  const cellW = (w - gap * (perRow - 1)) / perRow;
  const imgH = (cellW * 9) / 16;
  const cellH = imgH + 26;

  withThumbs.forEach((trail, ti) => {
    const shots = trail.detections.filter((d) => d.thumbnail);
    const rows = Math.ceil(shots.length / perRow);
    const blockH = 30 + rows * cellH;
    const pageH = doc.page.height - PAGE.margin * 2 - 26;
    const remaining = doc.page.height - PAGE.margin - 26 - doc.y;
    if (blockH > remaining && blockH <= pageH) doc.addPage();

    ensureSpace(doc, cellH + 40);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(PALETTE.ink)
      .text(`Trail ${ti + 1} — ${trail.cameras.join(' -> ')}`, PAGE.margin, doc.y);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PALETTE.muted)
      .text(
        `${fmtTime(trail.start, data.window.zone)} to ${fmtTime(trail.end, data.window.zone)} · ${shots.length} stop${shots.length === 1 ? '' : 's'}`,
        PAGE.margin,
        doc.y + 1,
      );
    doc.moveDown(0.6);

    shots.forEach((d, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) ensureSpace(doc, cellH + 6);
      const rowTop = doc.y;
      const x = PAGE.margin + col * (cellW + gap);

      doc.rect(x, rowTop, cellW, imgH).fill('#0c0f14');
      try {
        doc.image(d.thumbnail!, x, rowTop, { fit: [cellW, imgH], align: 'center', valign: 'center' });
      } catch {
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor('#6b7484')
          .text('image unavailable', x, rowTop + imgH / 2 - 4, { width: cellW, align: 'center' });
      }

      const matchLabels = matchLabelsByDetection.get(d.id);
      if (matchLabels?.length) {
        doc.rect(x, rowTop, cellW, imgH).lineWidth(2.5).strokeColor(PALETTE.accent).stroke();
      }
      const recognised = !matchLabels?.length ? recognisedLabels.get(d.id) : undefined;

      const caption = `${i + 1}. ${d.cameraName} · ${fmtTime(d.start, data.window.zone)}${
        matchLabels?.length ? ` · * ${matchLabels.join(', ')}` : recognised ? ` · (${recognised})` : ''
      }`;
      doc
        .font(matchLabels?.length ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(7)
        .fillColor(matchLabels?.length ? PALETTE.accent : PALETTE.body)
        .text(caption, x, rowTop + imgH + 4, { width: cellW });

      // Arrow connector to the next stop, only within the same row.
      if (col !== perRow - 1 && i !== shots.length - 1) {
        drawArrow(doc, x + cellW + gap / 2, rowTop + imgH / 2);
      }

      doc.y = col === perRow - 1 || i === shots.length - 1 ? rowTop + cellH : rowTop;
    });

    doc.moveDown(0.8);
  });
}

// ── appendix ──────────────────────────────────────────────────────────────

function drawEventTable(
  doc: Doc,
  data: ReportData,
  meta: PdfMeta,
  watchMatches: WatchMatch[] = [],
  indexLabels: Map<string, string> = new Map(),
): void {
  if (data.incidents.length === 0) return;
  doc.addPage();
  sectionHeading(doc, 'Incident log');

  const matchLabelsByDetection = new Map<string, string>();
  for (const m of watchMatches) {
    if (!matchLabelsByDetection.has(m.detection.id)) matchLabelsByDetection.set(m.detection.id, shortMatchTag(m));
  }

  /** Union of smart-detect types across an incident's detections, e.g. "Person" or "Person/Vehicle". */
  /**
   * Union of smart-detect types across an incident's detections, e.g. "Person"
   * or "Person/Vehicle". "licenseplate" is deliberately folded into "vehicle"
   * — it's an attribute of a vehicle detection (whether a plate was read),
   * not a distinct kind of subject, and keeping it separate produced an
   * overly long "Licenseplate/Vehicle" string in this narrow column.
   */
  const typeLabel = (inc: (typeof data.incidents)[number]): string => {
    const types = new Set<string>();
    for (const d of inc.detections) for (const t of d.types) types.add(t === 'licenseplate' ? 'vehicle' : t);
    return [...types].map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('/') || '—';
  };

  /**
   * A watch-list hit takes priority (marked "* ..."). Otherwise falls back
   * to indexLabelOf's richer output: a name Protect has already put on this
   * detection, or — when there's no name at all — the raw plate string for
   * an unnamed vehicle, or "no match" for a person whose face was detected
   * but not recognised. All non-watch-list cases are marked "(...)" so a
   * genuine watch-list hit still stands out as the one thing you asked to
   * be told about.
   */
  const indexLabel = (inc: (typeof data.incidents)[number]): string => {
    for (const d of inc.detections) {
      const watched = matchLabelsByDetection.get(d.id);
      if (watched) return `* ${watched}`;
    }
    for (const d of inc.detections) {
      const idx = indexLabels.get(d.id);
      if (idx) return `(${idx})`;
    }
    return '—';
  };

  const w = contentWidth(doc);
  const cols: Col[] = [
    // "End" dropped — Start + Duration already tells the same story without
    // making the reader do the arithmetic. Type/Index get more room than
    // before — a clustered incident spanning face+person+vehicle detections
    // needs it (e.g. "Face/Person/Vehicle"). Events stays at its original
    // width — narrower and its own header wraps ("EVENT"/"S").
    { label: 'Start', width: w * 0.12, align: 'left' },
    { label: 'Duration', width: w * 0.1, align: 'left' },
    { label: 'Camera', width: w * 0.16, align: 'left' },
    { label: 'Type', width: w * 0.21, align: 'left' },
    { label: 'Index', width: w * 0.21, align: 'left' },
    { label: 'Events', width: w * 0.07, align: 'right' },
    { label: 'Peak', width: w * 0.13, align: 'right' },
  ];

  drawTableHeader(doc, cols);
  for (const inc of data.incidents) {
    ensureSpace(doc, 20);
    drawTableRow(doc, cols, [
      fmtTime(inc.start, data.window.zone),
      fmtDuration(inc.end - inc.start),
      inc.cameraName,
      typeLabel(inc),
      indexLabel(inc),
      String(inc.count),
      inc.peakScore ? `${inc.peakScore}%` : '—',
    ]);
  }

  doc.moveDown(1);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(PALETTE.muted)
    .text(
      `Incidents group detections on the same camera that occur within the configured clustering gap. ` +
        `"Index" shows a watch-list hit ("* ...") or, in brackets: a name Protect has already put on the face/vehicle, ` +
          `the raw plate for an unnamed vehicle, or "no match" for a face that was detected but not recognised. ` +
        `Scores are the controller's own smart-detect confidence. ` +
        (meta.host ? `Source controller: ${meta.host}.` : ''),
      PAGE.margin,
      doc.y,
      { width: w, lineGap: 1.5 },
    );
}

function drawFooters(doc: Doc, data: ReportData): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    // Text below the bottom margin would make PDFKit append a fresh page,
    // which in a footer loop appends one per page, forever.
    const restore = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - PAGE.margin + 6;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(PALETTE.muted)
      .text(
        `${data.window.reportDate} overnight report · generated by protect-sentinel`,
        PAGE.margin,
        y,
        { width: contentWidth(doc) * 0.7, lineBreak: false },
      )
      .text(`Page ${i - range.start + 1} of ${total}`, PAGE.margin, y, {
        width: contentWidth(doc),
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = restore;
  }
}
