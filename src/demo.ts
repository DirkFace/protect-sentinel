import zlib from 'node:zlib';
import type { ProtectCamera, ProtectEvent } from './protect/types.js';
import type { NightWindow } from './report/window.js';

/**
 * Synthetic controller data, so the report layout and the mail template can be
 * exercised without touching a live NVR. `sentinel run --demo`.
 */

const DEMO_CAMERAS: ProtectCamera[] = [
  { id: 'cam-yard', name: 'Yard — North Gate', isConnected: true },
  { id: 'cam-front', name: 'Front Entrance', isConnected: true },
  { id: 'cam-comp', name: 'Compound East', isConnected: true },
  { id: 'cam-dock', name: 'Loading Dock', isConnected: true },
  { id: 'cam-store', name: 'Store Room (indoor)', isConnected: true },
];

export function demoCameras(): ProtectCamera[] {
  return DEMO_CAMERAS;
}

export function demoEvents(window: NightWindow): ProtectEvent[] {
  const rnd = mulberry32(0x4e57_4348);
  const events: ProtectEvent[] = [];
  let n = 0;

  const clusters: { cam: string; atFraction: number; burst: number }[] = [
    { cam: 'cam-front', atFraction: 0.04, burst: 3 },
    { cam: 'cam-yard', atFraction: 0.22, burst: 6 },
    { cam: 'cam-comp', atFraction: 0.24, burst: 2 },
    { cam: 'cam-yard', atFraction: 0.55, burst: 11 },
    { cam: 'cam-dock', atFraction: 0.57, burst: 4 },
    { cam: 'cam-comp', atFraction: 0.72, burst: 2 },
    { cam: 'cam-front', atFraction: 0.93, burst: 5 },
  ];

  const span = window.endMs - window.startMs;
  for (const c of clusters) {
    let t = window.startMs + span * c.atFraction;
    for (let i = 0; i < c.burst; i++) {
      const dur = 4000 + Math.floor(rnd() * 26000);
      events.push({
        id: `demo-${String(++n).padStart(4, '0')}`,
        type: 'smartDetectZone',
        start: Math.round(t),
        end: Math.round(t + dur),
        camera: c.cam,
        score: 62 + Math.floor(rnd() * 38),
        smartDetectTypes: ['person'],
        thumbnail: `demo-thumb-${n}`,
      });
      t += dur + 5000 + rnd() * 25000;
    }
  }
  return events.sort((a, b) => a.start - b.start);
}

/** A labelled placeholder still, so the stills grid can be checked offline. */
export function demoThumbnail(label: string, seed: number): Buffer {
  const w = 160;
  const h = 90;
  const rnd = mulberry32(seed * 2654435761);
  const raw = Buffer.alloc((w * 3 + 1) * h);

  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // PNG filter: none
    for (let x = 0; x < w; x++) {
      // night-ish gradient with a soft blob standing in for a figure
      const base = 18 + Math.round((y / h) * 26);
      const dx = (x - w * 0.5 + (rnd() - 0.5) * 2) / (w * 0.09);
      const dy = (y - h * 0.62) / (h * 0.3);
      const blob = Math.exp(-(dx * dx + dy * dy));
      raw[p++] = clamp(base + blob * 150 + label.length);
      raw[p++] = clamp(base + 6 + blob * 140);
      raw[p++] = clamp(base + 14 + blob * 120);
    }
  }
  return encodePng(w, h, raw);
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function encodePng(width: number, height: number, raw: Buffer): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return c ^ -1;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
