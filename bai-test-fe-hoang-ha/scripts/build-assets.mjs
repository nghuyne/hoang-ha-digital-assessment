// Sinh toàn bộ ảnh tĩnh từ logo gốc: logo đáp ứng (AVIF/WebP đúng kích thước hiển thị), favicon,
// icon cài đặt (PWA, iOS) và ảnh chia sẻ mạng xã hội 1200x630 (Open Graph).
// Chạy lại khi đổi logo hoặc nội dung ảnh chia sẻ: npm run assets. Kết quả được commit vào public/.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MARK = 'public/brand/logo-mark.png';
const NAVY = '#0b1d42';

/* ---------- 1. Logo đáp ứng: 2 kích thước đủ cho mọi chỗ dùng (38–96 px CSS, màn hình 2x) ---------- */
for (const width of [76, 153]) {
  const base = sharp(MARK).resize({ width, withoutEnlargement: true });
  await base.clone().avif({ quality: 60, effort: 9 }).toFile(`public/brand/logo-mark-${width}.avif`);
  await base.clone().webp({ quality: 82, effort: 6 }).toFile(`public/brand/logo-mark-${width}.webp`);
}

/* ---------- 2. Favicon và icon cài đặt ---------- */
// Biểu tượng đặt giữa nền vuông, chừa lề để không bị cắt khi hệ điều hành bo góc / che (maskable)
async function icon(size, { background, padding }) {
  const inner = Math.round(size * (1 - padding * 2));
  const mark = await sharp(MARK).resize(inner, inner, { fit: 'contain', background: '#0000' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png({ compressionLevel: 9, palette: true });
}
await (await icon(32, { background: '#0000', padding: 0 })).toFile('public/favicon-32.png');
await (await icon(180, { background: '#ffffff', padding: 0.14 })).toFile('public/apple-touch-icon.png');
await (await icon(192, { background: '#ffffff', padding: 0.18 })).toFile('public/icon-192.png');
await (await icon(512, { background: '#ffffff', padding: 0.18 })).toFile('public/icon-512.png');

/* ---------- 3. Ảnh chia sẻ Open Graph 1200x630 ---------- */
// sharp vẽ chữ bằng Pango, cần file TTF (Fontsource chỉ có woff/woff2). Tải bản TTF chính thức
// của Be Vietnam Pro (OFL) từ google/fonts một lần, lưu cache trong node_modules.
const FONT_DIR = 'node_modules/.cache/og-fonts';
async function font(weight) {
  const file = path.join(FONT_DIR, `BeVietnamPro-${weight}.ttf`);
  try { await access(file); } catch {
    await mkdir(FONT_DIR, { recursive: true });
    const res = await fetch(`https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-${weight}.ttf`);
    if (!res.ok) throw new Error(`Không tải được font ${weight}: HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

async function text(markup, { weight, size, width }) {
  return sharp({
    text: {
      text: markup,
      fontfile: await font(weight),
      font: `Be Vietnam Pro ${weight} ${size}`,
      width,
      rgba: true,
      dpi: 72,
      spacing: Math.round(size * 0.12),
    },
  }).png().toBuffer();
}

const W = 1200, H = 630;
// Nền: navy, lưới mảnh, hai quầng sáng xanh/vàng giống hero, mạng lưới điểm nút gợi biểu tượng logo
// (đặt ở góc trên bên phải, vùng trống phía trên tiêu đề, để không đè lên chữ)
const nodes = [[720, 64], [860, 140], [990, 92], [1120, 170], [1060, 40], [930, 200], [1150, 70]];
const links = [[0, 1], [1, 2], [2, 4], [2, 3], [1, 5], [5, 3], [4, 6], [6, 3], [2, 5]];
const background = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="blue" cx="85%" cy="10%" r="60%"><stop offset="0" stop-color="#2f7de1" stop-opacity=".55"/><stop offset="1" stop-color="#2f7de1" stop-opacity="0"/></radialGradient>
    <radialGradient id="gold" cx="10%" cy="105%" r="55%"><stop offset="0" stop-color="#f2a52e" stop-opacity=".35"/><stop offset="1" stop-color="#f2a52e" stop-opacity="0"/></radialGradient>
    <linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="#2f7de1"/><stop offset="1" stop-color="#f2a52e"/></linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity=".05"/></pattern>
  </defs>
  <rect width="100%" height="100%" fill="${NAVY}"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect width="100%" height="100%" fill="url(#blue)"/>
  <rect width="100%" height="100%" fill="url(#gold)"/>
  ${links.map(([a, b]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="#7fb2f0" stroke-opacity=".28" stroke-width="1.5"/>`).join('')}
  ${nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 2 ? 7 : 4.5}" fill="${i === 2 ? '#f2a52e' : '#7fb2f0'}" fill-opacity="${i === 2 ? 1 : 0.8}"/>`).join('')}
  <rect x="0" y="${H - 8}" width="${W}" height="8" fill="url(#bar)"/>
</svg>`);

const tile = await sharp({ create: { width: 88, height: 88, channels: 4, background: '#ffffff' } })
  .composite([
    { input: await sharp(MARK).resize(60, 60, { fit: 'contain', background: '#0000' }).toBuffer(), gravity: 'centre' },
    { input: Buffer.from('<svg width="88" height="88"><rect width="88" height="88" rx="22" fill="#fff"/></svg>'), blend: 'dest-in' },
  ])
  .png().toBuffer();

const layers = [
  { input: tile, left: 80, top: 72 },
  { input: await text('<span foreground="#ffffff">HOÀNG HÀ</span>', { weight: 'ExtraBold', size: 30 }), left: 186, top: 86 },
  { input: await text('<span foreground="#9fb3d1" letter_spacing="6000">DIGITAL</span>', { weight: 'SemiBold', size: 17 }), left: 188, top: 126 },
  {
    input: await text(
      '<span foreground="#ffffff">Kiến tạo giải pháp số\ngiúp </span><span foreground="#5fa2f2">doanh nghiệp</span><span foreground="#ffffff"> </span><span foreground="#f5b54a">bứt phá.</span>',
      { weight: 'ExtraBold', size: 66 },
    ),
    left: 80, top: 222,
  },
  {
    input: await text('<span foreground="#c3d0e4">Website · Phần mềm quản trị · Ứng dụng di động · Cloud &amp; DevOps</span>', { weight: 'Medium', size: 25 }),
    left: 80, top: 430,
  },
  {
    input: await text('<span foreground="#f5b54a">0943 447 206</span><span foreground="#7f93b3">   ·   Công ty TNHH Giải pháp số Hoàng Hà</span>', { weight: 'SemiBold', size: 21 }),
    left: 80, top: 520,
  },
];
// JPEG: nền gradient nén bảng màu (PNG palette) sẽ bị loang vệt
await sharp(background).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toFile('public/og-image.jpg');

const og = await readFile('public/og-image.jpg');
console.log(`assets: logo 76/153 (avif, webp), favicon, icon 180/192/512, og-image ${(og.length / 1024).toFixed(0)} KB`);
