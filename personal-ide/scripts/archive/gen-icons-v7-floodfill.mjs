/**
 * TCIDE 图标生成器 v7.1 — Flood Fill + 颜色距离 双重抠图
 * 
 * 策略：
 * 1. Flood Fill 从四角出发 → 移除外框白色背景（连通区域）
 * 2. 对残留像素，用颜色距离抠掉浅蓝色圆（非连通的背景岛）
 * 3. 边缘羽化保证平滑过渡
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const RESOURCES = resolve(import.meta.dirname, '..', 'resources');
const SRC = resolve(RESOURCES, 'tiger-mascot.jpg');

function dist3(r1,g1,b1,r2,g2,b2) {
  const dr=r1-r2, dg=g1-g2, db=b1-b2;
  return Math.sqrt(dr*dr+dg*dg+db*db);
}

// ── Step 1: Flood Fill — 从四角吃掉连通的白框 ──
function floodFill(buf, w, h, threshold) {
  const visited = new Uint8Array(w * h);
  const queue = [];
  
  const corners = [[0,0], [w-1,0], [0,h-1], [w-1,h-1]];
  for (const [cx, cy] of corners) {
    const idx = cy * w + cx;
    if (visited[idx]) continue;
    
    const br = buf[idx*3], bg = buf[idx*3+1], bb = buf[idx*3+2];
    queue.push([cx, cy]);
    visited[idx] = 1;
    
    while (queue.length > 0) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const nx = x+dx, ny = y+dy;
        if (nx<0||nx>=w||ny<0||ny>=h) continue;
        const nIdx = ny*w+nx;
        if (visited[nIdx]) continue;
        const nr=buf[nIdx*3], ng=buf[nIdx*3+1], nb=buf[nIdx*3+2];
        if (dist3(nr,ng,nb,br,bg,bb) <= threshold) {
          visited[nIdx] = 1;
          queue.push([nx, ny]);
        }
      }
    }
  }
  return visited; // 1=背景(外框), 0=未访问(前景+蓝圆)
}

// ── Step 2: 颜色距离抠图 — 对残留像素检测蓝圆 ──
function colorKeyRemove(buf, w, h, visited, targetR, targetG, targetB, lowThresh, highThresh) {
  const alpha = new Uint8Array(w * h);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      
      // 已被 flood fill 标记为背景 → 完全透明
      if (visited[idx] === 1) {
        alpha[idx] = 0;
        continue;
      }
      
      const r = buf[idx*3], g = buf[idx*3+1], b = buf[idx*3+2];
      const d = dist3(r, g, b, targetR, targetG, targetB);
      
      if (d <= lowThresh) {
        alpha[idx] = 0; // 肯定是背景
      } else if (d >= highThresh) {
        alpha[idx] = 255; // 肯定是前景
      } else {
        // 过渡区：smoothstep
        const t = (d - lowThresh) / (highThresh - lowThresh);
        const smooth = t * t * (3 - 2 * t); // smoothstep
        alpha[idx] = Math.round(smooth * 255);
      }
    }
  }
  
  return alpha;
}

// ── Step 3: 边缘净化 — 半透明区去除背景色倾向 ──
function purifyEdges(buf, alpha, w, h, factor) {
  // 检测背景色均值
  let bgR=0, bgG=0, bgB=0, bgN=0;
  for (let i=0;i<w*h;i++) if(alpha[i]<10){bgR+=buf[i*3];bgG+=buf[i*3+1];bgB+=buf[i*3+2];bgN++}
  if(bgN===0) return alpha;
  bgR=Math.round(bgR/bgN); bgG=Math.round(bgG/bgN); bgB=Math.round(bgB/bgN);
  
  const out = new Uint8Array(alpha);
  for (let i = 0; i < w * h; i++) {
    if (out[i] > 10 && out[i] < 245) {
      const d = dist3(buf[i*3], buf[i*3+1], buf[i*3+2], bgR, bgG, bgB);
      const maxD = 80; // 最大有效距离
      if (d < maxD) {
        // 越接近背景色，越透明
        const penalty = (1 - d/maxD) * factor;
        out[i] = Math.max(0, Math.round(out[i] * (1 - penalty)));
      }
    }
  }
  return out;
}

async function main() {
  console.log('🐯 TCIDE 图标生成器 v7.1 (Flood Fill + Color Key)');
  
  const img = await sharp(SRC).raw().toBuffer();
  const meta = await sharp(SRC).metadata();
  const W = meta.width, H = meta.height;
  console.log(`  原图: ${W}×${H}`);
  
  // === 参数 ===
  const FLOOD_THRESH = 50;       // flood fill：四角白框的颜色容差
  const BLUE_R = 200, BLUE_G = 230, BLUE_B = 249; // 蓝圆目标色
  const LOW_THRESH = 35;         // 蓝圆：肯定背景的距离阈值
  const HIGH_THRESH = 70;        // 蓝圆：肯定前景的距离阈值
  const PURIFY_FACTOR = 0.25;    // 边缘净化强度
  
  console.log(`  FloodFill阈值=${FLOOD_THRESH} | 蓝圆目标=rgb(${BLUE_R},${BLUE_G},${BLUE_B})`);
  console.log(`  蓝圆过渡=[${LOW_THRESH}, ${HIGH_THRESH}] | 净化因子=${PURIFY_FACTOR}`);
  
  // Step 1: Flood Fill
  const ffVisited = floodFill(img, W, H, FLOOD_THRESH);
  let ffBg = 0;
  for (let i = 0; i < W*H; i++) if(ffVisited[i]===1) ffBg++;
  console.log(`  FloodFill: 背景 ${ffBg} (${(ffBg/(W*H)*100).toFixed(1)}%)`);
  
  // Step 2: Color Key 抠蓝圆
  const alpha = colorKeyRemove(img, W, H, ffVisited, BLUE_R, BLUE_G, BLUE_B, LOW_THRESH, HIGH_THRESH);
  
  // 统计
  let trans=0, opaque=0, semi=0;
  for(let i=0;i<W*H;i++){
    if(alpha[i]===0) trans++;
    else if(alpha[i]>=250) opaque++;
    else semi++;
  }
  console.log(`  Color Key后: 透明 ${trans} (${(trans/(W*H)*100).toFixed(1)}%) | 不透明 ${opaque} (${(opaque/(W*H)*100).toFixed(1)}%) | 半透明 ${semi}`);
  
  // Step 3: 边缘净化
  const finalAlpha = purifyEdges(img, alpha, W, H, PURIFY_FACTOR);
  
  // 构建 RGBA
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i*4]   = img[i*3];
    rgba[i*4+1] = img[i*3+1];
    rgba[i*4+2] = img[i*3+2];
    rgba[i*4+3] = finalAlpha[i];
  }
  
  // === 缩放输出各尺寸 ===
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const outputs = {};
  
  for (const size of sizes) {
    const out = await sharp(rgba, { raw: { width: W, height: H, channels: 4 }})
      .resize(size, size, { fit: 'contain', kernel: 'lanczos3' })
      .png().toBuffer();
    outputs[`icon-${size}.png`] = out;
    writeFileSync(resolve(RESOURCES, `icon-${size}.png`), out);
    console.log(`  ✓ icon-${size}.png`);
  }
  
  writeFileSync(resolve(RESOURCES, 'icon.png'), outputs['icon-256.png']);
  console.log('  ✓ icon.png');
  
  // 特殊尺寸
  const special = {256:'about-icon.png', 32:'tray-icon.png', 64:'tray-icon@2x.png', 16:'icon-small.png'};
  for(const[sz,name] of Object.entries(special)){
    writeFileSync(resolve(RESOURCES, name), outputs[`icon-${sz}.png`]);
    console.log(`  ✓ ${name}`);
  }
  
  // mascot 200x200
  const mascot = await sharp(rgba, { raw:{width:W,height:H,channels:4}})
    .resize(200,200,{fit:'contain',kernel:'lanczos3'}).png().toBuffer();
  writeFileSync(resolve(RESOURCES,'mascot.png'),mascot);
  console.log('  ✓ mascot.png');
  
  // rounded
  const rounded = await sharp(outputs['icon-256.png'])
    .composite([{input:Buffer.from('<svg><circle cx="128" cy="128" r="126" fill="white"/></svg>'),blend:'dest-in'}])
    .png().toBuffer();
  writeFileSync(resolve(RESOURCES,'icon-rounded.png'),rounded);
  console.log('  ✓ icon-rounded.png');
  
  // ICO
  const icoSizes=[256,128,64,48,32,16];
  const icoPngs=await Promise.all(icoSizes.map(sz=>sharp(rgba,{raw:{width:W,height:H,channels:4}})
    .resize(sz,sz,{fit:'contain',kernel:'lanczos3'}).png().toBuffer()));
  const ico=await pngToIco(icoPngs);
  writeFileSync(resolve(RESOURCES,'icon.ico'),ico);
  console.log(`  ✓ icon.ico (${(ico.length/1024).toFixed(1)} KB)`);
  
  // Installer sidebar
  const sbW=164,sbH=314;
  const sbBg=Buffer.alloc(sbW*sbH*4);
  for(let i=0;i<sbW*sbH;i++){sbBg[i*4]=13;sbBg[i*4+1]=13;sbBg[i*4+2]=13;sbBg[i*4+3]=255}
  const msSmall=await sharp(rgba,{raw:{width:W,height:H,channels:4}})
    .resize(140,140,{fit:'contain',kernel:'lanczos3'}).png().toBuffer();
  
  const sbPng=await sharp(sbBg,{raw:{width:sbW,height:sbH,channels:4}})
    .composite([{input:msSmall,left:(sbW-140)/2,top:40}]).png().toBuffer();
  writeFileSync(resolve(RESOURCES,'installer-sidebar.png'),sbPng);
  console.log('  ✓ installer-sidebar.png');
  
  // BMP
  const sbFlat=await sharp(sbBg,{raw:{width:sbW,height:sbH,channels:4}})
    .composite([{input:msSmall,left:(sbW-140)/2,top:40}])
    .flatten({background:'#0D0D0D'}).raw().toBuffer();
  const rowSz=Math.ceil(sbW*3/4)*4;
  const pixSz=rowSz*sbH;
  const bmpBuf=Buffer.alloc(54+pixSz);
  bmpBuf.write('BM',0);
  bmpBuf.writeUInt32LE(54+pixSz,2);
  bmpBuf.writeUInt32LE(54,6);
  bmpBuf.writeUInt32LE(40,10);
  bmpBuf.writeInt32LE(sbW,14);
  bmpBuf.writeInt32LE(-sbH,18);
  bmpBuf.writeUInt16LE(1,22);
  bmpBuf.writeUInt16LE(24,24);
  bmpBuf.writeUInt32LE(pixSz,28);
  for(let y=0;y<sbH;y++)for(let x=0;x<sbW;x++){
    const si=(y*sbW+x)*3,dst=54+y*rowSz+x*3;
    bmpBuf[dst]=sbFlat[si+2];bmpBuf[dst+1]=sbFlat[si+1];bmpBuf[dst+2]=sbFlat[si];
  }
  writeFileSync(resolve(RESOURCES,'installer-sidebar.bmp'),bmpBuf);
  console.log(`  ✓ installer-sidebar.bmp (${(bmpBuf.length/1024).toFixed(1)} KB)`);

  console.log('\n✅ 全部完成！');
}

main().catch(e => { console.error(e); process.exit(1); });
