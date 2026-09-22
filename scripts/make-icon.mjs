// Gera icons/icon.ico (PNG 256x256 embutido em container ICO — suportado pelo Windows).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const size = 256;
// cor de fundo azul-escuro + "brilho" simples em gradiente
const rows = [];
for (let y = 0; y < size; y++) {
  const row = Buffer.alloc(1 + size * 4);
  row[0] = 0; // filter: none
  for (let x = 0; x < size; x++) {
    const o = 1 + x * 4;
    row[o] = 30 + Math.floor((x / size) * 40);     // R
    row[o + 1] = 60 + Math.floor((y / size) * 60); // G
    row[o + 2] = 160 + Math.floor((x / size) * 60);// B
    row[o + 3] = 255;                              // A
  }
  rows.push(row);
}
const raw = Buffer.concat(rows);
const idat = deflateSync(raw, { level: 9 });

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: icon
header.writeUInt16LE(1, 4);      // count
const entry = Buffer.alloc(16);
entry[0] = 0;                    // width (0 = 256)
entry[1] = 0;                    // height
entry[2] = 0;                    // palette
entry[3] = 0;
entry.writeUInt16LE(1, 4);       // planes
entry.writeUInt16LE(32, 6);      // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);     // offset

const out = join(dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons/icon.ico');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, entry, png]));
console.log('icon.ico written:', out, png.length + 22, 'bytes');
