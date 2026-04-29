/**
 * Blanc → transparent, léger feather sur anti-crénelage, rognage.
 * Entrée : public/signature-raw-new.png
 * Sortie : public/signature-yamepi-tonag.png (écrase)
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const inputPath = path.join(root, 'public', 'signature-raw-new.png');
const outputPath = path.join(root, 'public', 'signature-yamepi-tonag.png');

if (!fs.existsSync(inputPath)) {
  console.error(`Fichier manquant : ${inputPath}`);
  process.exit(1);
}

/** Luminance 0–255 au-dessus → transparent */
const WHITE_CUT = 248;
/** Dessous → trait pleinement opaque */
const DARK_CAP = 130;

function lum(r, g, b) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const out = Buffer.alloc(width * height * 4);

for (let row = 0; row < height; row++) {
  for (let col = 0; col < width; col++) {
    const i = (row * width + col) * channels;
    const o = (row * width + col) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const L = lum(r, g, b);

    if (L >= WHITE_CUT) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    if (L <= DARK_CAP) {
      out[o + 3] = 255;
    } else {
      const t = (L - DARK_CAP) / (WHITE_CUT - DARK_CAP);
      out[o + 3] = Math.round(255 * (1 - Math.min(1, Math.max(0, t))));
    }
  }
}

await sharp(Buffer.from(out), {
  raw: { width, height, channels: 4 },
})
  .png()
  .trim({ threshold: 0 })
  .toFile(outputPath);

fs.unlinkSync(inputPath);
console.log(`OK → ${path.relative(root, outputPath)}`);
