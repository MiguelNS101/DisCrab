import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Gera CRC32 padrão PNG
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
    raw[y * stride] = 0; // filter None
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

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Distância assinada para um retângulo arredondado (squircle)
function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

// Distância para segmento de reta
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

// Renderiza o ícone do StreamCompanion com supersampling 2x2
function renderIconRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 2; // 2x2 antialiasing

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // Coordenadas normalizadas em [-1, 1]
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;

          // 1. Squircle principal (fundo Obsidian + Borda Neon Ciano/Indigo)
          const dBox = sdRoundedBox(u, v, 0.88, 0.88, 0.42);
          const alphaBox = 1 - smoothstep(-0.015, 0.015, dBox);

          if (alphaBox <= 0) {
            continue;
          }

          // Gradiente de fundo escuro profundo (#070b14 -> #0f172a)
          const bgMix = clamp((u + v + 2) * 0.25, 0, 1);
          let r = 8 + bgMix * 10;
          let g = 12 + bgMix * 16;
          let b = 24 + bgMix * 28;

          // Brilho radial central Ciano + Violeta
          const distCenter = Math.hypot(u, v);
          const radialGlow = Math.exp(-distCenter * distCenter * 2.6);
          r += radialGlow * 14;
          g += radialGlow * 85;
          b += radialGlow * 125;

          // Borda iluminada metálica no contorno do squircle
          const borderBand = Math.exp(-Math.pow((dBox + 0.045) / 0.035, 2));
          const borderGrad = clamp((u - v + 2) * 0.25, 0, 1);
          const brR = 6 * (1 - borderGrad) + 99 * borderGrad;
          const brG = 182 * (1 - borderGrad) + 102 * borderGrad;
          const brB = 212 * (1 - borderGrad) + 241 * borderGrad;
          r = r * (1 - borderBand * 0.85) + brR * (borderBand * 0.85);
          g = g * (1 - borderBand * 0.85) + brG * (borderBand * 0.85);
          b = b * (1 - borderBand * 0.85) + brB * (borderBand * 0.85);

          // 2. Moldura de Monitor / Tela Estilizada interna
          const dScreenOuter = sdRoundedBox(u, v - 0.02, 0.56, 0.42, 0.14);
          const dScreenInner = sdRoundedBox(u, v - 0.02, 0.49, 0.35, 0.09);
          const screenRing =
            (1 - smoothstep(-0.015, 0.015, dScreenOuter)) *
            smoothstep(-0.015, 0.015, dScreenInner);

          if (screenRing > 0) {
            r = r * (1 - screenRing * 0.9) + 34 * screenRing * 0.9;
            g = g * (1 - screenRing * 0.9) + 211 * screenRing * 0.9;
            b = b * (1 - screenRing * 0.9) + 238 * screenRing * 0.9;
          }

          // 3. Prisma / Triângulo de Play & Transmissão no centro
          // Vértices do triângulo de play: (-0.13, -0.18), (-0.13, 0.14), (0.19, -0.02)
          const ax = -0.13,
            ay = -0.17;
          const bx = -0.13,
            by = 0.13;
          const cx = 0.18,
            cy = -0.02;

          // Teste baricêntrico + distância às arestas para cantos arredondados
          const v0x = cx - ax,
            v0y = cy - ay;
          const v1x = bx - ax,
            v1y = by - ay;
          const v2x = u - ax,
            v2y = v - ay;
          const dot00 = v0x * v0x + v0y * v0y;
          const dot01 = v0x * v1x + v0y * v1y;
          const dot02 = v0x * v2x + v0y * v2y;
          const dot11 = v1x * v1x + v1y * v1y;
          const dot12 = v1x * v2x + v1y * v2y;
          const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
          const bu = (dot11 * dot02 - dot01 * dot12) * invDenom;
          const bv = (dot00 * dot12 - dot01 * dot02) * invDenom;
          const insideTri = bu >= 0 && bv >= 0 && bu + bv <= 1;

          const dEdge = Math.min(
            sdSegment(u, v, ax, ay, bx, by),
            sdSegment(u, v, bx, by, cx, cy),
            sdSegment(u, v, cx, cy, ax, ay)
          );
          const signedTri = insideTri ? -dEdge : dEdge;
          const playMask = 1 - smoothstep(-0.028, 0.012, signedTri - 0.015);

          if (playMask > 0) {
            // Gradiente Ciano Brilhante -> Branco no ícone de Play
            const pGrad = clamp((u + 0.15) * 2.2, 0, 1);
            const pr = 56 + pGrad * 190;
            const pg = 225 + pGrad * 30;
            const pb = 250 + pGrad * 5;
            r = r * (1 - playMask) + pr * playMask;
            g = g * (1 - playMask) + pg * playMask;
            b = b * (1 - playMask) + pb * playMask;
          }

          // 4. Ondas de Áudio / Sinal P2P Superiores/Laterais (Arcos Neon)
          const waveCenterDist = Math.hypot(u, v + 0.02);
          const angle = Math.atan2(v + 0.02, u);
          const inWaveCone =
            Math.abs(angle) < 0.72 || Math.abs(Math.abs(angle) - Math.PI) < 0.72;

          if (inWaveCone) {
            const wave1 = Math.exp(-Math.pow((waveCenterDist - 0.31) / 0.022, 2));
            const wave2 = Math.exp(-Math.pow((waveCenterDist - 0.41) / 0.022, 2));
            const waveIntensity = clamp((wave1 * 0.85 + wave2 * 0.65) * 0.9, 0, 1);
            r = r * (1 - waveIntensity) + 16 * waveIntensity;
            g = g * (1 - waveIntensity) + 245 * waveIntensity;
            b = b * (1 - waveIntensity) + 195 * waveIntensity;
          }

          // 5. Base / Indicador LED Verde Esmeralda "LIVE" na parte inferior
          const dBar = sdSegment(u, v, -0.22, 0.56, 0.22, 0.56);
          const barMask = 1 - smoothstep(0.028, 0.055, dBar);
          if (barMask > 0) {
            r = r * (1 - barMask) + 16 * barMask;
            g = g * (1 - barMask) + 185 * barMask;
            b = b * (1 - barMask) + 129 * barMask;
          }

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

// Empacota múltiplos buffers PNG em um arquivo .ICO válido do Windows
function encodeICO(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const item of pngEntries) {
    const entry = Buffer.alloc(16);
    entry[0] = item.size >= 256 ? 0 : item.size;
    entry[1] = item.size >= 256 ? 0 : item.size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(item.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += item.png.length;
  }

  return Buffer.concat([
    header,
    ...dirEntries,
    ...pngEntries.map((e) => e.png),
  ]);
}

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#060B16" />
      <stop offset="55%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#1E1B4B" />
    </linearGradient>
    <linearGradient id="borderGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#22D3EE" />
      <stop offset="50%" stop-color="#06B6D4" />
      <stop offset="100%" stop-color="#6366F1" />
    </linearGradient>
    <linearGradient id="playGrad" x1="180" y1="160" x2="340" y2="320" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#67E8F9" />
      <stop offset="50%" stop-color="#22D3EE" />
      <stop offset="100%" stop-color="#818CF8" />
    </linearGradient>
    <radialGradient id="centerGlow" cx="50%" cy="48%" r="48%">
      <stop offset="0%" stop-color="#06B6D4" stop-opacity="0.36" />
      <stop offset="60%" stop-color="#6366F1" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Squircle Base -->
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="14" />
  <rect x="38" y="38" width="436" height="436" rx="98" fill="url(#centerGlow)" />

  <!-- Monitor / Broadcast Frame -->
  <rect x="96" y="122" width="320" height="236" rx="44" fill="#090F1E" fill-opacity="0.75" stroke="url(#borderGrad)" stroke-width="14" />

  <!-- P2P Audio / Signal Waves -->
  <path d="M156 196C140 218 140 262 156 284" stroke="#10B981" stroke-width="12" stroke-linecap="round" opacity="0.9" />
  <path d="M128 176C104 212 104 268 128 304" stroke="#22D3EE" stroke-width="10" stroke-linecap="round" opacity="0.65" />
  <path d="M356 196C372 218 372 262 356 284" stroke="#10B981" stroke-width="12" stroke-linecap="round" opacity="0.9" />
  <path d="M384 176C408 212 408 268 384 304" stroke="#22D3EE" stroke-width="10" stroke-linecap="round" opacity="0.65" />

  <!-- Central Play / Stream Prism -->
  <path d="M218 184.5C218 175.8 227.5 170.4 235 174.9L316.5 224.4C323.7 228.8 323.7 239.2 316.5 243.6L235 293.1C227.5 297.6 218 292.2 218 283.5V184.5Z" fill="url(#playGrad)" />

  <!-- Bottom WASAPI / Live Status Pill -->
  <rect x="176" y="394" width="160" height="22" rx="11" fill="#10B981" />
  <circle cx="404" cy="112" r="16" fill="#10B981" stroke="#060B16" stroke-width="6" />
</svg>`;

const tauriIconsDir = path.resolve('src-tauri/icons');
const publicDir = path.resolve('public');

fs.mkdirSync(tauriIconsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const sizes = [16, 32, 48, 64, 128, 256];
const pngBySize = new Map();

for (const s of sizes) {
  const rgba = renderIconRGBA(s);
  const png = encodePNG(s, s, rgba);
  pngBySize.set(s, png);
}

// Salva PNGs do Tauri
fs.writeFileSync(path.join(tauriIconsDir, '32x32.png'), pngBySize.get(32));
fs.writeFileSync(path.join(tauriIconsDir, '128x128.png'), pngBySize.get(128));
fs.writeFileSync(path.join(tauriIconsDir, '128x128@2x.png'), pngBySize.get(256));
fs.writeFileSync(path.join(tauriIconsDir, 'icon.png'), pngBySize.get(256));

// Salva .ICO multi-resolução (16, 32, 48, 64, 256) para o .exe do Windows
const icoBuf = encodeICO([
  { size: 16, png: pngBySize.get(16) },
  { size: 32, png: pngBySize.get(32) },
  { size: 48, png: pngBySize.get(48) },
  { size: 64, png: pngBySize.get(64) },
  { size: 256, png: pngBySize.get(256) },
]);
fs.writeFileSync(path.join(tauriIconsDir, 'icon.ico'), icoBuf);

// Salva também em /public para uso imediato no navegador, Home, Header e download direto
fs.writeFileSync(path.join(publicDir, 'app-icon.svg'), svgContent, 'utf8');
fs.writeFileSync(path.join(publicDir, 'app-icon.png'), pngBySize.get(256));
fs.writeFileSync(path.join(publicDir, 'icon.ico'), icoBuf);

console.log('Ícones gerados com sucesso em src-tauri/icons e public!');
