// Draws the placeholder PWA icons (a white "A" on the theme colour) into public/.
// The PNGs are committed assets: run `npm run icons` only to replace them with new placeholders.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const background = [0x0f, 0x76, 0x6e];
const foreground = [0xff, 0xff, 0xff];

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coordinates are fractions of the icon size and stay inside the maskable safe zone (80%).
const strokes = [
  [
    [0.5, 0.27],
    [0.3, 0.73],
  ],
  [
    [0.5, 0.27],
    [0.7, 0.73],
  ],
  [
    [0.37, 0.58],
    [0.63, 0.58],
  ],
];
const halfWidth = 0.045;

function pixel(size, x, y) {
  const px = (x + 0.5) / size;
  const py = (y + 0.5) / size;
  const inside = strokes.some(([a, b]) => distanceToSegment(px, py, a, b) <= halfWidth);
  return inside ? foreground : background;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(size, x, y);
      raw.set([r, g, b], y * row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size));
}
