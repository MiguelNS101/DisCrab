import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Tabela CRC32 padrão PNG
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Converte buffer RGBA top-down em um DIB BITMAPINFOHEADER 32-bit BGRA bottom-up + máscara AND
function encodeDibFromRGBA(size, rgba) {
  const headerSize = 40;
  const xorSize = size * size * 4;
  const andRowBytes = Math.ceil(size / 32) * 4;
  const andSize = andRowBytes * size;

  const dib = Buffer.alloc(headerSize + xorSize + andSize);
  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(xorSize + andSize, 20);
  dib.writeInt32LE(0, 24);
  dib.writeInt32LE(0, 28);
  dib.writeUInt32LE(0, 32);
  dib.writeUInt32LE(0, 36);

  let dstOffset = headerSize;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const srcIdx = (y * size + x) * 4;
      const r = rgba[srcIdx];
      const g = rgba[srcIdx + 1];
      const b = rgba[srcIdx + 2];
      const a = rgba[srcIdx + 3];

      dib[dstOffset] = b;
      dib[dstOffset + 1] = g;
      dib[dstOffset + 2] = r;
      dib[dstOffset + 3] = a;
      dstOffset += 4;
    }
  }

  const andStart = headerSize + xorSize;
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    const rowOffset = andStart + y * andRowBytes;
    for (let x = 0; x < size; x++) {
      const a = rgba[(srcY * size + x) * 4 + 3];
      if (a < 16) {
        const byteIdx = rowOffset + (x >> 3);
        const bitIdx = 7 - (x & 7);
        dib[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  return dib;
}

function encodeICOFromDibs(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const item of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = item.size >= 256 ? 0 : item.size;
    entry[1] = item.size >= 256 ? 0 : item.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(item.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += item.data.length;
  }

  return Buffer.concat([
    header,
    ...dirEntries,
    ...entries.map((e) => e.data),
  ]);
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdEllipse(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
}

function blendColor(baseR, baseG, baseB, overR, overG, overB, mask) {
  const m = clamp(mask, 0, 1);
  return [
    baseR * (1 - m) + overR * m,
    baseG * (1 - m) + overG * m,
    baseB * (1 - m) + overB * m,
  ];
}

// Renderiza o ícone do DisCrab (Caranguejo Pirata com Tapa-Olho e Chapéu de Pirata) com supersampling 2x2
function renderIconRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;

          // 1. Squircle de fundo estilo Discord + Oceano Noturno
          const dBox = sdRoundedBox(u, v, 0.9, 0.9, 0.42);
          const alphaBox = 1 - smoothstep(-0.02, 0.02, dBox);

          if (alphaBox <= 0) {
            continue;
          }

          const bgMix = clamp((u + v + 2) * 0.25, 0, 1);
          let r = 13 + bgMix * 24;
          let g = 19 + bgMix * 16;
          let b = 38 + bgMix * 48;

          // Brilho central coral/vermelho suave
          const distCenter = Math.hypot(u, v - 0.1);
          const radialGlow = Math.exp(-distCenter * distCenter * 2.2);
          r += radialGlow * 65;
          g += radialGlow * 22;
          b += radialGlow * 28;

          // Borda iluminada Coral -> Dourado -> Violeta
          const borderBand = Math.exp(-Math.pow((dBox + 0.05) / 0.04, 2));
          const borderGrad = clamp((u + 1) * 0.5, 0, 1);
          const brR = 251 * (1 - borderGrad) + 129 * borderGrad;
          const brG = 113 * (1 - borderGrad) + 140 * borderGrad;
          const brB = 133 * (1 - borderGrad) + 248 * borderGrad;
          [r, g, b] = blendColor(r, g, b, brR, brG, brB, borderBand * 0.9);

          // 2. Perninhas laterais do caranguejo
          const dLegL1 = sdSegment(u, v, -0.45, 0.34, -0.74, 0.50);
          const dLegL2 = sdSegment(u, v, -0.42, 0.48, -0.68, 0.66);
          const dLegR1 = sdSegment(u, v, 0.45, 0.34, 0.74, 0.50);
          const dLegR2 = sdSegment(u, v, 0.42, 0.48, 0.68, 0.66);
          const dLegs = Math.min(dLegL1, dLegL2, dLegR1, dLegR2);
          const legMask = 1 - smoothstep(0.035, 0.06, dLegs);
          [r, g, b] = blendColor(r, g, b, 225, 29, 72, legMask);

          // 3. Garras (Pinças) levantadas
          const dArmL = sdSegment(u, v, -0.42, 0.14, -0.62, -0.14);
          const dArmR = sdSegment(u, v, 0.42, 0.14, 0.62, -0.14);
          const armMask = 1 - smoothstep(0.045, 0.07, Math.min(dArmL, dArmR));
          [r, g, b] = blendColor(r, g, b, 225, 29, 72, armMask);

          const dClawL = sdEllipse(u, v, -0.63, -0.24, 0.18, 0.15);
          const dClawR = sdEllipse(u, v, 0.63, -0.24, 0.18, 0.15);
          const clawMask = 1 - smoothstep(-0.015, 0.02, Math.min(dClawL, dClawR));
          [r, g, b] = blendColor(r, g, b, 251, 113, 133, clawMask);

          // 4. Corpo arredondado do Caranguejo (DisCrab)
          const dBody = sdEllipse(u, v, 0, 0.27, 0.53, 0.38);
          const bodyMask = 1 - smoothstep(-0.02, 0.02, dBody);
          if (bodyMask > 0) {
            const bodyShade = clamp((v - 0.0) * 1.3, 0, 1);
            const crR = 255 * (1 - bodyShade) + 215 * bodyShade;
            const crG = 105 * (1 - bodyShade) + 25 * bodyShade;
            const crB = 120 * (1 - bodyShade) + 60 * bodyShade;
            [r, g, b] = blendColor(r, g, b, crR, crG, crB, bodyMask);
          }

          // 5. Faixa do Tapa-Olho Pirata atravessando a testa
          const dStrap = sdSegment(u, v, -0.48, 0.05, 0.49, 0.25);
          const strapMask = (1 - smoothstep(0.025, 0.045, dStrap)) * bodyMask;
          [r, g, b] = blendColor(r, g, b, 15, 23, 42, strapMask);

          // 6. Olho Esquerdo fofinho (Kawaii)
          const dEyeL = Math.hypot(u + 0.21, v - 0.18) - 0.11;
          const eyeLMask = 1 - smoothstep(-0.015, 0.015, dEyeL);
          [r, g, b] = blendColor(r, g, b, 15, 23, 42, eyeLMask);

          // Brilho branco no olho esquerdo
          const dSparkle = Math.hypot(u + 0.24, v - 0.14) - 0.042;
          const sparkleMask = 1 - smoothstep(-0.01, 0.01, dSparkle);
          [r, g, b] = blendColor(r, g, b, 255, 255, 255, sparkleMask);

          // 7. Tapa-Olho Pirata no Olho Direito (com aro dourado)
          const dPatch = Math.hypot(u - 0.21, v - 0.18) - 0.135;
          const patchBorder = 1 - smoothstep(-0.015, 0.015, dPatch);
          const patchInner = 1 - smoothstep(-0.015, 0.015, dPatch + 0.025);
          [r, g, b] = blendColor(r, g, b, 245, 158, 11, patchBorder);
          [r, g, b] = blendColor(r, g, b, 15, 23, 42, patchInner);

          // 8. Sorriso fofo
          const smileDist = Math.abs(Math.hypot(u, v - 0.25) - 0.13);
          const inSmileArc = v > 0.30 && Math.abs(u) < 0.13;
          const smileMask = inSmileArc ? 1 - smoothstep(0.015, 0.035, smileDist) : 0;
          [r, g, b] = blendColor(r, g, b, 30, 10, 24, smileMask);

          // 9. Chapéu de Pirata Tricorne no topo
          const dHatCrown = sdEllipse(u, v, 0, -0.28, 0.44, 0.26);
          const hatCutBottom = v < -0.04 ? 1 : 0;
          const hatCrownMask = (1 - smoothstep(-0.02, 0.02, dHatCrown)) * hatCutBottom;
          [r, g, b] = blendColor(r, g, b, 17, 24, 39, hatCrownMask);

          // Aba curvada do chapéu de pirata com borda dourada
          const dHatBrim = sdRoundedBox(u, v + 0.09, 0.56, 0.08, 0.06);
          const brimBorderMask = 1 - smoothstep(-0.015, 0.015, dHatBrim);
          const brimInnerMask = 1 - smoothstep(-0.015, 0.015, dHatBrim + 0.025);
          [r, g, b] = blendColor(r, g, b, 251, 191, 36, brimBorderMask);
          [r, g, b] = blendColor(r, g, b, 30, 41, 59, brimInnerMask);

          // Caveirinha branca no centro do chapéu
          const dSkull = Math.hypot(u, v + 0.28) - 0.085;
          const skullMask = 1 - smoothstep(-0.015, 0.015, dSkull);
          [r, g, b] = blendColor(r, g, b, 248, 250, 252, skullMask);

          // Olhinhos da caveira no chapéu
          const dSkullEyes = Math.min(
            Math.hypot(u + 0.032, v + 0.28) - 0.02,
            Math.hypot(u - 0.032, v + 0.28) - 0.02
          );
          const skullEyeMask = 1 - smoothstep(-0.008, 0.008, dSkullEyes);
          [r, g, b] = blendColor(r, g, b, 15, 23, 42, skullEyeMask);

          rAcc += clamp(r, 0, 255);
          gAcc += clamp(g, 0, 255);
          bAcc += clamp(b, 0, 255);
          aAcc += alphaBox * 255;
        }
      }

      const idx = (y * size + x) * 4;
      const totalSamples = ss * ss;
      buf[idx] = Math.round(rAcc / totalSamples);
      buf[idx + 1] = Math.round(gAcc / totalSamples);
      buf[idx + 2] = Math.round(bAcc / totalSamples);
      buf[idx + 3] = Math.round(aAcc / totalSamples);
    }
  }

  return buf;
}

const tauriIconsDir = path.resolve('src-tauri/icons');
const publicDir = path.resolve('public');

fs.mkdirSync(tauriIconsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256];
const rgbaBySize = new Map();
const pngBySize = new Map();
const dibBySize = new Map();

for (const s of sizes) {
  const rgba = renderIconRGBA(s);
  rgbaBySize.set(s, rgba);
  pngBySize.set(s, encodePNG(s, s, rgba));
  dibBySize.set(s, encodeDibFromRGBA(s, rgba));
}

// Salva PNGs e RGBA binário para o Tauri
fs.writeFileSync(path.join(tauriIconsDir, '32x32.png'), pngBySize.get(32));
fs.writeFileSync(path.join(tauriIconsDir, '128x128.png'), pngBySize.get(128));
fs.writeFileSync(path.join(tauriIconsDir, '128x128@2x.png'), pngBySize.get(256));
fs.writeFileSync(path.join(tauriIconsDir, 'icon.png'), pngBySize.get(256));
fs.writeFileSync(path.join(tauriIconsDir, 'icon_rgba_64.bin'), rgbaBySize.get(64));

// Salva .ICO multi-resolução com frames DIB BGRA descomprimidos
const icoBuf = encodeICOFromDibs([
  { size: 16, data: dibBySize.get(16) },
  { size: 32, data: dibBySize.get(32) },
  { size: 48, data: dibBySize.get(48) },
  { size: 64, data: dibBySize.get(64) },
  { size: 128, data: dibBySize.get(128) },
  { size: 256, data: dibBySize.get(256) },
]);
fs.writeFileSync(path.join(tauriIconsDir, 'icon.ico'), icoBuf);
fs.writeFileSync(path.join(tauriIconsDir, 'icon.icns'), icoBuf);

// Salva PNG e ICO em /public para o frontend (mantendo /public/app-icon.svg intacto)
fs.writeFileSync(path.join(publicDir, 'app-icon.png'), pngBySize.get(256));
fs.writeFileSync(path.join(publicDir, 'icon.ico'), icoBuf);

console.log('Ícones DisCrab (DIB/PNG/ICO/RGBA) gerados com sucesso!');
