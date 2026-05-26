/**
 * 生成带透明背景的 icon.png
 * - 读取原图，自动去除背景（白色/浅色区域透明化）
 * - 输出 256x256 PNG
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const src = process.argv[2] || 'C:/Users/noirh/xwechat_files/Vincent_wl_cce9/temp/RWTemp/2026-05/9e20f478899dc29eb19741386f9343c8/ab10112f944c2aed4d106383b08206f4.jpg';
const outDir = 'C:/Users/noirh/.qclaw/workspace-ua58rsb93veqtxl7/personal-ide/resources';

async function makeIcon() {
  const img = sharp(src);
  const meta = await img.metadata();
  console.log('Source:', meta.width, 'x', meta.height, meta.format);

  // 读取原始像素，判断背景色
  const { data, info } = await img
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 采样四个角（每个角取中心点）
  const w = info.width, h = info.height;
  const corners = [
    { x: Math.floor(w * 0.15), y: Math.floor(h * 0.15) },  // 左上
    { x: Math.floor(w * 0.85), y: Math.floor(h * 0.15) },  // 右上
    { x: Math.floor(w * 0.15), y: Math.floor(h * 0.85) },  // 左下
    { x: Math.floor(w * 0.85), y: Math.floor(h * 0.85) },  // 右下
  ];
  
  const getPixel = (x, y) => {
    const idx = (y * w + x) * 3;
    return { r: data[idx], g: data[idx+1], b: data[idx+2] };
  };

  // 统计角点颜色，取最可能的背景色
  const bgSample = corners.map(c => getPixel(c.x, c.y));
  // 找亮度最高的角作为背景基准
  bgSample.sort((a, b) => (b.r + b.g + b.b) - (a.r + a.g + b.b));
  const bgColor = bgSample[0];
  console.log('Detected background color:', bgColor);

  // 生成 alpha 通道：背景色附近变透明，非背景变不透明
  const alpha = Buffer.alloc(w * h);
  const THRESHOLD = 60; // 容差

  const colorDist = (c) => Math.abs(c.r - bgColor.r) + Math.abs(c.g - bgColor.g) + Math.abs(c.b - bgColor.b);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const dist = colorDist({ r: data[idx], g: data[idx+1], b: data[idx+2] });
      if (dist < THRESHOLD) {
        alpha[y * w + x] = 0; // 背景透明
      } else {
        alpha[y * w + x] = 255; // 内容保留
      }
    }
  }

  // 创建 RGBA 图像
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4]     = data[i * 3];     // R
    rgba[i * 4 + 1] = data[i * 3 + 1]; // G
    rgba[i * 4 + 2] = data[i * 3 + 2]; // B
    rgba[i * 4 + 3] = alpha[i];        // A
  }

  // 缩小到 256x256
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outDir, 'icon.png'));

  console.log('Created icon.png (256x256, transparent bg)');

  // 同时生成 icon.ico (多尺寸)
  const sizes = [256, 128, 64, 48, 32, 16];
  const icoEntries = [];
  let dataOffset = 6 + 16 * sizes.length;

  for (const sz of sizes) {
    const buf = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .resize(sz, sz, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    icoEntries.push({ size: sz, data: buf });
  }

  // 写入 ICO
  const icoBuf = Buffer.alloc(6 + 16 * sizes.length + icoEntries.reduce((s, e) => s + e.data.length, 0));
  icoBuf.writeUInt16LE(0, 0);      // Reserved
  icoBuf.writeUInt16LE(1, 2);      // Type: ICO
  icoBuf.writeUInt16LE(sizes.length, 4); // Image count

  let offset = 6 + 16 * sizes.length;
  for (let i = 0; i < sizes.length; i++) {
    const sz = sizes[i];
    const d = icoEntries[i].data;
    const pos = 6 + i * 16;
    icoBuf[pos]     = sz === 256 ? 0 : sz; // width (0=256)
    icoBuf[pos + 1] = sz === 256 ? 0 : sz; // height
    icoBuf[pos + 2] = 0;                   // palette
    icoBuf[pos + 3] = 0;                   // reserved
    icoBuf.writeUInt16LE(1, pos + 4);     // color planes
    icoBuf.writeUInt16LE(32, pos + 6);    // bpp
    icoBuf.writeUInt32LE(d.length, pos + 8);  // size
    icoBuf.writeUInt32LE(offset, pos + 12);   // offset
    d.copy(icoBuf, offset);
    offset += d.length;
  }

  fs.writeFileSync(path.join(outDir, 'icon.ico'), icoBuf);
  console.log('Created icon.ico with', sizes.join('/'), 'sizes');
}

makeIcon().catch(console.error);
