// Генерирует PNG-иконки приложения без зависимостей: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
const BG = [0, 0, 0];
const FG = [0x10, 0xb9, 0x81];

// Три столбца диаграммы в единичном квадрате: [x, y, ширина, высота]
const BARS = [
  [0.22, 0.54, 0.15, 0.22],
  [0.425, 0.40, 0.15, 0.36],
  [0.63, 0.24, 0.15, 0.52],
];
const RADIUS = 0.045;

function inBars(u, v) {
  for (const [x, y, w, h] of BARS) {
    const dx = Math.max(x + RADIUS - u, 0, u - (x + w - RADIUS));
    const dy = Math.max(y + RADIUS - v, 0, v - (y + h - RADIUS));
    if (u >= x && u <= x + w && v >= y && v <= y + h && dx * dx + dy * dy <= RADIUS * RADIUS) return true;
  }
  return false;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** scale < 1 уменьшает рисунок вокруг центра (поля для maskable-иконки). */
function png(size, scale = 1) {
  const SS = 4; // сглаживание: 4×4 выборки на пиксель
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;
          const v = ((y + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
          if (inBars(u, v)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const o = y * stride + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 бит, RGB без прозрачности
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['apple-touch-icon.png', 180, 0.9],
  ['icon-192.png', 192, 0.9],
  ['icon-512.png', 512, 0.9],
  ['icon-maskable-512.png', 512, 0.62],
];
for (const [name, size, scale] of files) {
  writeFileSync(OUT + name, png(size, scale));
  console.log(name, size);
}
