// Tách nền trắng của logo gốc (color-to-alpha) và cắt riêng phần biểu tượng.
import sharp from 'sharp';

const src = 'public/brand/logo-original.png';
const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const out = Buffer.alloc(width * height * 4);

for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  let a = 1 - Math.min(r, g, b) / 255;
  a = Math.min(1, Math.max(0, (a - 0.04) / 0.96));
  if (a < 0.02) { out[j + 3] = 0; continue; }
  out[j] = Math.round(Math.min(255, Math.max(0, (r - 255 * (1 - a)) / a)));
  out[j + 1] = Math.round(Math.min(255, Math.max(0, (g - 255 * (1 - a)) / a)));
  out[j + 2] = Math.round(Math.min(255, Math.max(0, (b - 255 * (1 - a)) / a)));
  out[j + 3] = Math.round(a * 255);
}

// Bỏ viền 6px của ảnh chụp để trim chính xác
const inset = 6;
const png = await sharp(out, { raw: { width, height, channels: 4 } })
  .extract({ left: inset, top: inset, width: width - inset * 2, height: height - inset * 2 })
  .png().toBuffer();
await sharp(png).trim().png().toFile('public/brand/logo-full.png');
// Vùng biểu tượng nằm phía trên chữ "HOÀNG HÀ"
const markArea = await sharp(png).extract({ left: 0, top: 0, width: width - inset * 2, height: 216 }).png().toBuffer();
await sharp(markArea).trim().png().toFile('public/brand/logo-mark.png');
const m = await sharp('public/brand/logo-mark.png').metadata();
const f = await sharp('public/brand/logo-full.png').metadata();
console.log('mark', m.width, m.height, 'full', f.width, f.height);
