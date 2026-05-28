/**
 * 虎猫 TCIDE — v6 透明背景图标（精确抠图）
 * 
 * 修复 v5 问题：
 * - 浅色毛（距离 70）被 v5 的 30~150 过渡区吃掉
 * - 改用绝对距离阈值：low=20, high=55
 * - 处理分辨率回到 512px（v2 已验证）
 * - 颜色净化更温和（factor 0.3）
 * - 安装侧边栏用原始不透明图
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
  console.log('🐯 TCIDE 图标生成器 v6 (透明背景·精确抠图)\n');

  // ── Step 1: 512px 处理（v2 验证过的最佳分辨率）──
  const { data, info } = await sharp(SRC)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 }, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height;

  // ── Step 2: 背景色检测 ──
  const bgR = 254, bgG = 254, bgB = 251; // 已验证

  // ── Step 3: 计算距离 ──
  const rgba = Buffer.alloc(w * h * 4);
  const dists = new Float64Array(w * h);
  let maxDist = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const pi = y * w + x;

      const dr = r - bgR, dg = g - bgG, db = b - bgB;
      const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
      dists[pi] = dist;
      if (dist > maxDist) maxDist = dist;

      rgba[pi * 4] = r;
      rgba[pi * 4 + 1] = g;
      rgba[pi * 4 + 2] = b;
    }
  }

  console.log(`maxDist: ${maxDist.toFixed(1)}`);

  // ── Step 4: 精确阈值 Smoothstep ──
  // 绝对距离阈值：背景 < 20, 过渡 20~55, 前景 > 55
  // 虎猫浅毛最小距离 ~70，安全余量 15
  const LOW = 20, HIGH = 55;
  console.log(`羽化: ${LOW} - ${HIGH} (绝对距离)`);

  for (let i = 0; i < w * h; i++) {
    const d = dists[i];
    let alpha;
    if (d <= LOW) {
      alpha = 0;
    } else if (d >= HIGH) {
      alpha = 255;
    } else {
      const t = (d - LOW) / (HIGH - LOW);
      alpha = Math.round(255 * t * t * (3 - 2 * t));
    }
    rgba[i * 4 + 3] = alpha;

    // 温和颜色净化
    if (alpha > 0 && alpha < 255) {
      const factor = (1 - alpha / 255) * 0.3;
      rgba[i * 4] = Math.min(255, Math.max(0, Math.round(rgba[i * 4] - bgR * factor)));
      rgba[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(rgba[i * 4 + 1] - bgG * factor)));
      rgba[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(rgba[i * 4 + 2] - bgB * factor)));
    }
  }

  const cleanSrc = sharp(rgba, { raw: { width: w, height: h, channels: 4 } });

  // ── Step 5: 生成 256x256 主图标 ──
  const mainBuf = await cleanSrc
    .clone()
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toBuffer();

  fs.writeFileSync(path.join(OUT, 'icon.png'), mainBuf);
  fs.writeFileSync(path.join(OUT, 'icon-256.png'), mainBuf);
  console.log('✓ icon.png (256x256 透明)');

  // ── Step 6: 各尺寸 PNG ──
  const sizes = [128, 64, 48, 32, 24, 16];
  for (const sz of sizes) {
    const buf = await sharp(mainBuf)
      .resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
      .png({ compressionLevel: 9, effort: 10, palette: false })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, `icon-${sz}.png`), buf);
    console.log(`✓ icon-${sz}.png`);
  }

  // 专用图标
  fs.copyFileSync(path.join(OUT, 'icon-128.png'), path.join(OUT, 'about-icon.png'));
  fs.copyFileSync(path.join(OUT, 'icon-32.png'), path.join(OUT, 'tray-icon.png'));
  fs.copyFileSync(path.join(OUT, 'icon-64.png'), path.join(OUT, 'tray-icon@2x.png'));
  fs.copyFileSync(path.join(OUT, 'icon-64.png'), path.join(OUT, 'icon-small.png'));
  console.log('✓ about/tray/icon-small');

  // 圆形裁切
  const circleMask = Buffer.from(
    `<svg width="256" height="256"><circle cx="128" cy="128" r="124" fill="white"/></svg>`
  );
  await sharp(mainBuf)
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png().toFile(path.join(OUT, 'icon-rounded.png'));
  console.log('✓ icon-rounded.png');

  // 吉祥物
  await sharp(mainBuf)
    .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(OUT, 'mascot.png'));
  console.log('✓ mascot.png');

  // ── Step 7: ICO ──
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const entries = [];
  for (const sz of icoSizes) {
    const buf = await sharp(path.join(OUT, `icon-${sz}.png`)).png().toBuffer();
    entries.push({ size: sz, data: buf });
  }

  const hdrSize = 6, dirSize = 16;
  const dataOff = hdrSize + dirSize * icoSizes.length;
  const totalData = entries.reduce((s, e) => s + e.data.length, 0);
  const icoBuf = Buffer.alloc(dataOff + totalData);
  icoBuf.writeUInt16LE(0, 0);
  icoBuf.writeUInt16LE(1, 2);
  icoBuf.writeUInt16LE(icoSizes.length, 4);

  let offset = dataOff;
  for (let i = 0; i < icoSizes.length; i++) {
    const sz = icoSizes[i];
    const d = entries[i].data;
    const pos = hdrSize + i * dirSize;
    icoBuf[pos] = sz === 256 ? 0 : sz;
    icoBuf[pos + 1] = sz === 256 ? 0 : sz;
    icoBuf[pos + 2] = 0; icoBuf[pos + 3] = 0;
    icoBuf.writeUInt16LE(1, pos + 4);
    icoBuf.writeUInt16LE(32, pos + 6);
    icoBuf.writeUInt32LE(d.length, pos + 8);
    icoBuf.writeUInt32LE(offset, pos + 12);
    d.copy(icoBuf, offset);
    offset += d.length;
  }

  fs.writeFileSync(path.join(OUT, 'icon.ico'), icoBuf);
  console.log(`✓ icon.ico (${(icoBuf.length / 1024).toFixed(1)} KB)`);

  // ── Step 8: 安装侧边栏（用原图，不透明）──
  // 从原始 JPG 直接缩放，保留白色背景
  const sidebarPng = await sharp(SRC)
    .resize(328, 628, { fit: 'contain', background: { r: 13, g: 13, b: 13, alpha: 1 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();

  // 吉祥物贴到深色背景上
  const sidebarBg = Buffer.from(
    `<svg width="328" height="628"><rect width="328" height="628" fill="#0D0D0D"/></svg>`
  );
  const mascotForSidebar = await sharp(SRC)
    .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .ensureAlpha()
    .png()
    .toBuffer();

  // 先抠图生成透明 mascot，再贴到深色背景
  const mascotData = await sharp(SRC)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 }, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mw = mascotData.info.width, mh = mascotData.info.height;
  const mrgba = Buffer.alloc(mw * mh * 4);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const idx = (y * mw + x) * 4;
      const r = mascotData.data[idx], g = mascotData.data[idx+1], b = mascotData.data[idx+2];
      const pi = y * mw + x;
      const dr = r - bgR, dg = g - bgG, db = b - bgB;
      const dist = Math.sqrt(2*dr*dr + 4*dg*dg + 3*db*db);
      let alpha;
      if (dist <= LOW) alpha = 0;
      else if (dist >= HIGH) alpha = 255;
      else { const t=(dist-LOW)/(HIGH-LOW); alpha=Math.round(255*t*t*(3-2*t)); }
      mrgba[pi*4] = r; mrgba[pi*4+1] = g; mrgba[pi*4+2] = b; mrgba[pi*4+3] = alpha;
      if (alpha > 0 && alpha < 255) {
        const factor = (1 - alpha/255) * 0.3;
        mrgba[pi*4] = Math.min(255, Math.max(0, Math.round(r - bgR * factor)));
        mrgba[pi*4+1] = Math.min(255, Math.max(0, Math.round(g - bgG * factor)));
        mrgba[pi*4+2] = Math.min(255, Math.max(0, Math.round(b - bgB * factor)));
      }
    }
  }

  const sidebarMascot = await sharp(mrgba, { raw: { width: mw, height: mh, channels: 4 } })
    .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();

  await sharp(sidebarBg)
    .composite([{ input: sidebarMascot, top: 180, left: 64 }])
    .png()
    .toFile(path.join(OUT, 'installer-sidebar.png'));
  console.log('✓ installer-sidebar.png');

  // BMP 版本
  const sidebarBuf = await sharp(path.join(OUT, 'installer-sidebar.png'))
    .resize(164, 314, { fit: 'cover', kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  const bw = 164, bh = 314;
  const rowSize = Math.ceil((bw * 3) / 4) * 4;
  const imgSize = rowSize * bh;
  const fileSize = 54 + imgSize;
  const bmp = Buffer.alloc(fileSize);
  bmp.write('BM', 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(bw, 18);
  bmp.writeInt32LE(bh, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(imgSize, 34);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const srcIdx = ((bh - 1 - y) * bw + x) * 3;
      const dstIdx = 54 + y * rowSize + x * 3;
      bmp[dstIdx] = sidebarBuf[srcIdx + 2];
      bmp[dstIdx + 1] = sidebarBuf[srcIdx + 1];
      bmp[dstIdx + 2] = sidebarBuf[srcIdx];
    }
  }
  fs.writeFileSync(path.join(OUT, 'installer-sidebar.bmp'), bmp);
  console.log(`✓ installer-sidebar.bmp (${(fileSize/1024).toFixed(1)} KB)`);

  console.log('\n✅ 全部完成！');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
