// Generates the PNG icons (no dependencies): a 3x3 grid of "swatch" squares.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const bg = [31, 36, 48];
const swatches = [
  [226, 85, 70], [240, 178, 60], [96, 170, 110],
  [64, 130, 200], [120, 90, 170], [235, 225, 205],
  [190, 120, 80], [60, 60, 70], [230, 140, 170],
];
const pixel = (u, v) => {
  const m = 0.16, gap = 0.04, cell = (1 - 2 * m - 2 * gap) / 3;
  const gx = (u - m) / (cell + gap), gy = (v - m) / (cell + gap);
  if (u < m || v < m || gx >= 3 || gy >= 3) return bg;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  if (gx - ix > cell / (cell + gap) || gy - iy > cell / (cell + gap)) return bg;
  return swatches[iy * 3 + ix];
};
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]])
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, pixel));
console.log('icons written');
