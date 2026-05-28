/**
 * 虎猫 TCIDE — 专业图标生成（抗锯齿 + 羽化边缘）
 * 
 * 用法: node scripts/generate-icons-v2.mjs [source.jpg]
 * 
 * 相比 v1 的改进：
 * - 羽化 alpha 通道（非硬阈值）避免锯齿
 * - 边缘颜色净化（去除白色/灰色光晕导致的脏边）
 * - 二次缩放降采样（更锐利的缩小图标）
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const outputDir = path.join(projectRoot, 'resources');

const SOURCE = process.argv[2] || path.join(projectRoot, 'icon.png');

const BRAND_ORANGE = '#FF8C00';
const BRAND_DARK = '#0D0D0D';

async function main() {
  console.log('🐯 TCIDE 图标生成器 v2 (抗锯齿版)\n');

  const meta = await sharp(SOURCE).metadata();
  console.log(`  源文件: ${meta.format} ${meta.width}x${meta.height}`);

  // ── Step 1: 创建干净透明的主图标 ──
  console.log('\n── 处理透明通道 ──');

  // 放大到 512x512 便于处理
  const raw = await sharp(SOURCE)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = raw;
  const w = info.width, h = info.height;
  const channels = info.channels; // 4 (RGBA)

  // 检测背景色：采样四角 + 四边中点
  const samplePoints = [
    { x: Math.floor(w * 0.05), y: Math.floor(h * 0.05) },
    { x: Math.floor(w * 0.95), y: Math.floor(h * 0.05) },
    { x: Math.floor(w * 0.05), y: Math.floor(h * 0.95) },
    { x: Math.floor(w * 0.95), y: Math.floor(h * 0.95) },
    { x: Math.floor(w * 0.5), y: Math.floor(h * 0.05) },
  ];

  let bgR = 255, bgG = 255, bgB = 255;
  for (const p of samplePoints) {
    const idx = (p.y * w + p.x) * channels;
    if (data[idx + 3] > 0) { // 已有 alpha 的跳过
      bgR = Math.min(bgR, data[idx]);
      bgG = Math.min(bgG, data[idx + 1]);
      bgB = Math.min(bgB, data[idx + 2]);
    }
  }

  console.log(`  检测到背景色: rgb(${bgR}, ${bgG}, ${bgB})`);
  const bgLuminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // 对已有 alpha 的图像：增强现有 alpha
  // 对 JPG (无 alpha)：从颜色距离生成 alpha
  const rgba = Buffer.alloc(w * h * 4);
  let maxDist = 0;
  const dists = new Float64Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * channels;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const a = channels === 4 ? data[idx + 3] : 255;

      // 感知颜色距离 (CIELAB 的简化近似)
      const dr = r - bgR, dg = g - bgG, db = b - bgB;
      // 加权距离：红色差异比蓝色差异更显著
      const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);

      const pi = y * w + x;
      dists[pi] = dist;
      if (dist > maxDist) maxDist = dist;

      rgba[pi * 4] = r;
      rgba[pi * 4 + 1] = g;
      rgba[pi * 4 + 2] = b;
    }
  }

  // ── 羽化 alpha：使用 smoothstep 实现抗锯齿 ──
  // low: 背景区完全透明, high: 前景区完全不透明, 中间线性过渡
  const low = maxDist * 0.06;   // 6% — 低于此值 = 背景
  const high = maxDist * 0.25;  // 25% — 高于此值 = 完全前景

  console.log(`  羽化范围: ${low.toFixed(1)} - ${high.toFixed(1)} (maxDist=${maxDist.toFixed(1)})`);

  for (let i = 0; i < w * h; i++) {
    const d = dists[i];
    let alpha;
    if (d <= low) {
      alpha = 0;
    } else if (d >= high) {
      alpha = 255;
    } else {
      // Smoothstep 过渡
      const t = (d - low) / (high - low);
      alpha = Math.round(255 * t * t * (3 - 2 * t)); // smoothstep
    }
    rgba[i * 4 + 3] = alpha;

    // 边缘颜色净化：半透明区域的背景色污染清除
    if (alpha > 0 && alpha < 255) {
      const factor = 1 - alpha / 255;
      rgba[i * 4] = Math.round(rgba[i * 4] - bgR * factor * 0.6);
      rgba[i * 4 + 1] = Math.round(rgba[i * 4 + 1] - bgG * factor * 0.6);
      rgba[i * 4 + 2] = Math.round(rgba[i * 4 + 2] - bgB * factor * 0.6);
    }
  }

  const cleanSource = sharp(rgba, {
    raw: { width: w, height: h, channels: 4 }
  });

  // ── 生成输出 ──
  console.log('\n── 生成图标 ──');

  // 主图标 256x256
  await cleanSource
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toFile(path.join(outputDir, 'icon.png'));
  console.log('✓ icon.png (256x256, 抗锯齿透明)');

  // 多尺寸 PNG
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  for (const sz of sizes) {
    // 小尺寸从 256 降采样以获得最佳抗锯齿
    const pipe = sz < 128
      ? await sharp(path.join(outputDir, 'icon.png')).resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toBuffer()
      : await cleanSource.resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toBuffer();
    fs.writeFileSync(path.join(outputDir, `icon-${sz}.png`), pipe);
  }
  console.log(`✓ icon-{${sizes.join(',')}}.png`);

  // 专用图标
  await cleanSource
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(outputDir, 'about-icon.png'));
  console.log('✓ about-icon.png (128x128)');

  await cleanSource
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(outputDir, 'tray-icon.png'));
  console.log('✓ tray-icon.png (32x32)');

  await cleanSource
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(outputDir, 'tray-icon@2x.png'));
  console.log('✓ tray-icon@2x.png (64x64)');

  await cleanSource
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(outputDir, 'icon-small.png'));
  console.log('✓ icon-small.png (64x64)');

  // 圆形裁切
  const circleMask = Buffer.from(
    `<svg width="256" height="256"><circle cx="128" cy="128" r="120" fill="white"/></svg>`
  );
  await sharp(path.join(outputDir, 'icon.png'))
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png().toFile(path.join(outputDir, 'icon-rounded.png'));
  console.log('✓ icon-rounded.png (256x256, 圆形)');

  // 吉祥物 200x200
  await cleanSource
    .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png().toFile(path.join(outputDir, 'mascot.png'));
  console.log('✓ mascot.png (200x200)');

  // ── 生成多分辨率 ICO ──
  console.log('\n── 生成 ICO ──');
  const icoSizes = [256, 128, 64, 48, 32, 16];
  const entries = [];

  for (const sz of icoSizes) {
    const buf = await sharp(path.join(outputDir, `icon-${sz}.png`)).png().toBuffer();
    entries.push({ size: sz, data: buf });
  }

  // ICO 文件头 + 目录表 + 数据
  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset = headerSize + dirEntrySize * icoSizes.length;
  const totalDataSize = entries.reduce((s, e) => s + e.data.length, 0);
  const icoBuf = Buffer.alloc(dataOffset + totalDataSize);

  icoBuf.writeUInt16LE(0, 0);           // Reserved
  icoBuf.writeUInt16LE(1, 2);           // ICO type
  icoBuf.writeUInt16LE(icoSizes.length, 4); // Image count

  let offset = dataOffset;
  for (let i = 0; i < icoSizes.length; i++) {
    const sz = icoSizes[i];
    const d = entries[i].data;
    const pos = headerSize + i * dirEntrySize;
    icoBuf[pos] = sz === 256 ? 0 : sz;
    icoBuf[pos + 1] = sz === 256 ? 0 : sz;
    icoBuf[pos + 2] = 0;                // Palette
    icoBuf[pos + 3] = 0;                // Reserved
    icoBuf.writeUInt16LE(1, pos + 4);  // Color planes
    icoBuf.writeUInt16LE(32, pos + 6); // BPP
    icoBuf.writeUInt32LE(d.length, pos + 8);  // Size
    icoBuf.writeUInt32LE(offset, pos + 12);   // Offset
    d.copy(icoBuf, offset);
    offset += d.length;
  }

  fs.writeFileSync(path.join(outputDir, 'icon.ico'), icoBuf);
  console.log(`✓ icon.ico (${(icoBuf.length / 1024).toFixed(1)} KB, ${icoSizes.join('/')})`);

  // ── 安装器侧边栏 ──
  const sidebarSvg = Buffer.from(
    `<svg width="328" height="628"><rect width="328" height="628" fill="${BRAND_DARK}"/></svg>`
  );
  const mascotBuf = await sharp(path.join(outputDir, 'mascot.png')).toBuffer();
  await sharp(sidebarSvg)
    .composite([{ input: mascotBuf, top: 164, left: 64 }])
    .png().toFile(path.join(outputDir, 'installer-sidebar.png'));
  console.log('✓ installer-sidebar.png (328x628)');

  console.log('\n✅ 所有图标生成完成（抗锯齿 + 羽化边缘）');
  console.log('📂 输出:', outputDir);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
