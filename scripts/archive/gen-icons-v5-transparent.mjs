/**
 * 虎猫 TCIDE — v5 透明背景图标生成
 * 
 * 改进：
 * - 从 1280×1280 原图直接处理，不缩放，保留最大细节
 * - 自适应渐变背景检测（四角采样 + 边缘采样）
 * - Smoothstep 羽化 + 边缘颜色净化
 * - 小尺寸从 256px Lanczos3 降采样
 * - 全套 PNG + ICO + 侧边栏
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'resources');
const SRC = path.join(ROOT, 'resources', 'tiger-mascot.jpg');

async function main() {
  console.log('🐯 TCIDE 图标生成器 v5 (透明背景)\n');

  const meta = await sharp(SRC).metadata();
  console.log(`源文件: ${meta.format} ${meta.width}x${meta.height}`);

  // ── Step 1: 读取原始像素 ──
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height;
  const ch = info.channels; // 4 (RGBA)

  // ── Step 2: 检测背景色（多点采样，取最亮的作为参考）──
  // 采样位置：四角 + 顶边中段 + 底边中段
  const samples = [
    { x: 2, y: 2 },
    { x: w - 3, y: 2 },
    { x: 2, y: h - 3 },
    { x: w - 3, y: h - 3 },
    { x: Math.floor(w * 0.25), y: 2 },
    { x: Math.floor(w * 0.5), y: 2 },
    { x: Math.floor(w * 0.75), y: 2 },
    { x: 2, y: Math.floor(h * 0.25) },
    { x: 2, y: Math.floor(h * 0.5) },
    { x: w - 3, y: Math.floor(h * 0.25) },
    { x: w - 3, y: Math.floor(h * 0.5) },
  ];

  // 背景区域通常亮度最高，取 top-3 最亮像素的平均
  const sampleColors = samples.map(p => {
    const idx = (p.y * w + p.x) * ch;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  });
  sampleColors.sort((a, b) => (0.299 * b.r + 0.587 * b.g + 0.114 * b.b) - (0.299 * a.r + 0.587 * a.g + 0.114 * a.b));

  // 取前5个最亮的采样点的均值作为背景色
  const topN = sampleColors.slice(0, 5);
  const bgR = Math.round(topN.reduce((s, c) => s + c.r, 0) / topN.length);
  const bgG = Math.round(topN.reduce((s, c) => s + c.g, 0) / topN.length);
  const bgB = Math.round(topN.reduce((s, c) => s + c.b, 0) / topN.length);
  console.log(`背景色参考: rgb(${bgR}, ${bgG}, ${bgB})`);

  // ── Step 3: 计算每个像素到背景色的加权距离 ──
  const rgba = Buffer.alloc(w * h * 4);
  const dists = new Float64Array(w * h);
  let maxDist = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * ch;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const pi = y * w + x;

      // 感知加权颜色距离
      const dr = r - bgR, dg = g - bgG, db = b - bgB;
      const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
      dists[pi] = dist;
      if (dist > maxDist) maxDist = dist;

      rgba[pi * 4] = r;
      rgba[pi * 4 + 1] = g;
      rgba[pi * 4 + 2] = b;
    }
  }

  console.log(`最大颜色距离: ${maxDist.toFixed(1)}`);

  // ── Step 4: Smoothstep 羽化 alpha + 边缘颜色净化 ──
  const low = maxDist * 0.04;   // 4% — 背景区
  const high = maxDist * 0.20;  // 20% — 前景区
  console.log(`羽化范围: ${low.toFixed(1)} - ${high.toFixed(1)}`);

  for (let i = 0; i < w * h; i++) {
    const d = dists[i];
    let alpha;
    if (d <= low) {
      alpha = 0;
    } else if (d >= high) {
      alpha = 255;
    } else {
      const t = (d - low) / (high - low);
      alpha = Math.round(255 * t * t * (3 - 2 * t)); // smoothstep
    }
    rgba[i * 4 + 3] = alpha;

    // 边缘颜色净化：去除半透明区域的背景色污染
    if (alpha > 0 && alpha < 255) {
      const factor = 1 - alpha / 255;
      rgba[i * 4] = Math.min(255, Math.max(0, Math.round(rgba[i * 4] - bgR * factor * 0.7)));
      rgba[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(rgba[i * 4 + 1] - bgG * factor * 0.7)));
      rgba[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(rgba[i * 4 + 2] - bgB * factor * 0.7)));
    }
  }

  // 创建 sharp pipeline（原始分辨率 RGBA）
  const fullRes = sharp(rgba, { raw: { width: w, height: h, channels: 4 } });

  // ── Step 5: 生成 256x256 主图标（Lanczos3 缩小）──
  const mainIconBuf = await fullRes
    .clone()
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png({ compressionLevel: 6, effort: 10 })
    .toBuffer();

  fs.writeFileSync(path.join(OUT, 'icon.png'), mainIconBuf);
  fs.writeFileSync(path.join(OUT, 'icon-256.png'), mainIconBuf);
  console.log('✓ icon.png / icon-256.png (256x256, 透明)');

  // ── Step 6: 生成各尺寸图标（小尺寸从 256px 降采样更平滑）──
  const sizes = [128, 64, 48, 32, 24, 16];
  for (const sz of sizes) {
    const buf = await sharp(mainIconBuf)
      .resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
      .png({ compressionLevel: 6, effort: 10 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, `icon-${sz}.png`), buf);
    console.log(`✓ icon-${sz}.png`);
  }

  // 专用图标
  fs.copyFileSync(path.join(OUT, 'icon-128.png'), path.join(OUT, 'about-icon.png'));
  fs.copyFileSync(path.join(OUT, 'icon-32.png'), path.join(OUT, 'tray-icon.png'));
  fs.copyFileSync(path.join(OUT, 'icon-64.png'), path.join(OUT, 'tray-icon@2x.png'));
  fs.copyFileSync(path.join(OUT, 'icon-64.png'), path.join(OUT, 'icon-small.png'));
  console.log('✓ about-icon.png / tray-icon.png / tray-icon@2x.png / icon-small.png');

  // 圆形裁切
  const circleMask = Buffer.from(
    `<svg width="256" height="256"><circle cx="128" cy="128" r="120" fill="white"/></svg>`
  );
  await sharp(mainIconBuf)
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png().toFile(path.join(OUT, 'icon-rounded.png'));
  console.log('✓ icon-rounded.png (圆形)');

  // 吉祥物 200x200
  await sharp(mainIconBuf)
    .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(OUT, 'mascot.png'));
  console.log('✓ mascot.png (200x200)');

  // ── Step 7: 生成 ICO（多分辨率 PNG 嵌入）──
  console.log('\n── 生成 ICO ──');
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const entries = [];
  for (const sz of icoSizes) {
    const buf = await sharp(path.join(OUT, `icon-${sz}.png`)).png().toBuffer();
    entries.push({ size: sz, data: buf });
  }

  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset = headerSize + dirEntrySize * icoSizes.length;
  const totalDataSize = entries.reduce((s, e) => s + e.data.length, 0);
  const icoBuf = Buffer.alloc(dataOffset + totalDataSize);

  icoBuf.writeUInt16LE(0, 0);
  icoBuf.writeUInt16LE(1, 2);
  icoBuf.writeUInt16LE(icoSizes.length, 4);

  let offset = dataOffset;
  for (let i = 0; i < icoSizes.length; i++) {
    const sz = icoSizes[i];
    const d = entries[i].data;
    const pos = headerSize + i * dirEntrySize;
    icoBuf[pos] = sz === 256 ? 0 : sz;
    icoBuf[pos + 1] = sz === 256 ? 0 : sz;
    icoBuf[pos + 2] = 0;
    icoBuf[pos + 3] = 0;
    icoBuf.writeUInt16LE(1, pos + 4);
    icoBuf.writeUInt16LE(32, pos + 6);
    icoBuf.writeUInt32LE(d.length, pos + 8);
    icoBuf.writeUInt32LE(offset, pos + 12);
    d.copy(icoBuf, offset);
    offset += d.length;
  }

  fs.writeFileSync(path.join(OUT, 'icon.ico'), icoBuf);
  console.log(`✓ icon.ico (${(icoBuf.length / 1024).toFixed(1)} KB, ${icoSizes.join('/')})`);

  // ── Step 8: 安装器侧边栏 ──
  const sidebarSvg = Buffer.from(
    `<svg width="328" height="628"><rect width="328" height="628" fill="#0D0D0D"/></svg>`
  );
  const mascotBuf = await sharp(path.join(OUT, 'mascot.png')).toBuffer();
  await sharp(sidebarSvg)
    .composite([{ input: mascotBuf, top: 164, left: 64 }])
    .png().toFile(path.join(OUT, 'installer-sidebar.png'));
  console.log('✓ installer-sidebar.png (328x628)');

  // 侧边栏 BMP for NSIS
  await sharp(path.join(OUT, 'installer-sidebar.png'))
    .resize(164, 314, { fit: 'cover', kernel: 'lanczos3' })
    .raw().toBuffer()
    .then(buf => {
      // BMP 24-bit
      const bw = 164, bh = 314;
      const rowSize = Math.ceil((bw * 3) / 4) * 4; // 4-byte aligned
      const imgSize = rowSize * bh;
      const fileSize = 54 + imgSize;
      const bmp = Buffer.alloc(fileSize);
      // BMP header
      bmp.write('BM', 0);
      bmp.writeUInt32LE(fileSize, 2);
      bmp.writeUInt32LE(54, 10); // pixel data offset
      // DIB header
      bmp.writeUInt32LE(40, 14);
      bmp.writeInt32LE(bw, 18);
      bmp.writeInt32LE(bh, 22);
      bmp.writeUInt16LE(1, 26);
      bmp.writeUInt16LE(24, 28);
      bmp.writeUInt32LE(imgSize, 34);
      // Pixel data (BMP is bottom-up, BGR)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const srcIdx = ((bh - 1 - y) * bw + x) * 3;
          const dstIdx = 54 + y * rowSize + x * 3;
          bmp[dstIdx] = buf[srcIdx + 2]; // B
          bmp[dstIdx + 1] = buf[srcIdx + 1]; // G
          bmp[dstIdx + 2] = buf[srcIdx]; // R
        }
      }
      fs.writeFileSync(path.join(OUT, 'installer-sidebar.bmp'), bmp);
      console.log(`✓ installer-sidebar.bmp (${(fileSize / 1024).toFixed(1)} KB)`);
    });

  console.log('\n✅ 全部完成！透明背景图标已生成');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
