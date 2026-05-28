/**
 * TCIDE 图标生成器 v8 — 保留蓝圆，仅去白框
 * 
 * 原图结构：虎猫 + 浅蓝圆底 + 白色外框
 * 目标：保留 虎猫 + 蓝圆，仅移除四角白色背景
 * 
 * 策略：
 * 1. Flood Fill 从四角出发，用亮度阈值检测白色外框
 * 2. 蓝圆(低饱和度)和虎猫(有色彩)都作为前景保留
 * 3. 边缘 smoothstep 羽化
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

// 亮度计算 (感知加权)
function luminance(r, g, b) {
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

/**
 * Flood Fill — 从四角出发，仅移除白色/近白色背景
 * 用亮度+颜色距离双重判断：真正的白色外框亮度>240且接近纯白
 */
function floodFillWhite(buf, w, h, lumThreshold, maxColorDist) {
  const visited = new Uint8Array(w * h);
  const queue = [];
  
  const corners = [[0,0], [w-1,0], [0,h-1], [w-1,h-1]];
  
  for (const [cx, cy] of corners) {
    const idx = cy * w + cx;
    if (visited[idx]) continue;
    
    const br = buf[idx*3], bg = buf[idx*3+1], bb = buf[idx*3+2];
    const blum = luminance(br, bg, bb);
    
    // 角落必须是近白色才启动 flood fill
    if (blum < 230) continue;
    
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
        const nlum = luminance(nr, ng, nb);
        const cd = dist3(nr, ng, nb, br, bg, bb);
        
        // 双重条件：亮度足够高 AND 颜色接近起点白色
        if (nlum >= lumThreshold && cd <= maxColorDist) {
          visited[nIdx] = 1;
          queue.push([nx, ny]);
        }
      }
    }
  }
  return visited; // 1=白色背景, 0=前景(虎猫+蓝圆)
}

/**
 * 边缘羽化：对背景/前景边界做 smoothstep 过渡
 */
function featherEdges(visited, buf, w, h, radius) {
  const alpha = new Uint8Array(w * h);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      
      if (visited[idx] === 1) {
        // 背景像素——检查附近是否有前景
        let minDist = radius + 1;
        for (let dy = -radius; dy <= radius && minDist > 1; dy++) {
          for (let dx = -radius; dx <= radius && minDist > 1; dx++) {
            const nx = x+dx, ny = y+dy;
            if (nx<0||nx>=w||ny<0||ny>=h) continue;
            if (visited[ny*w+nx] === 0) {
              const d = Math.sqrt(dx*dx + dy*dy);
              if (d < minDist) minDist = d;
            }
          }
        }
        
        if (minDist > radius) {
          alpha[idx] = 0; // 深层背景，完全透明
        } else {
          // 边缘过渡区
          const t = minDist / radius;
          const smooth = t * t * (3 - 2 * t); // smoothstep
          alpha[idx] = Math.round(smooth * 255); // 0~255 渐变
        }
      } else {
        alpha[idx] = 255; // 前景完全保留
      }
    }
  }
  
  return alpha;
}

async function main() {
  console.log('🐯 TCIDE 图标生成器 v8 (保留蓝圆·去白框)');
  
  const img = await sharp(SRC).raw().toBuffer();
  const meta = await sharp(SRC).metadata();
  const W = meta.width, H = meta.height;
  console.log(`  原图: ${W}×${H}`);
  
  // === 参数 ===
  const LUM_THRESH = 235;       // 亮度阈值：>=235 才可能是白框
  const MAX_COLOR_DIST = 35;    // 颜色距离：与角落白色的最大容差
  const FEATHER_RADIUS = 2.5;   // 羽化半径(px)
  
  console.log(`  亮度阈值=${LUM_THRESH} | 颜色容差=${MAX_COLOR_DIST} | 羽化半径=${FEATHER_RADIUS}`);
  
  // Step 1: Flood Fill 仅去白框
  const visited = floodFillWhite(img, W, H, LUM_THRESH, MAX_COLOR_DIST);
  let bgCount = 0;
  for (let i = 0; i < W*H; i++) if(visited[i]===1) bgCount++;
  console.log(`  白框像素: ${bgCount} (${(bgCount/(W*H)*100).toFixed(1)}%)`);
  
  // Step 2: 边缘羽化
  const alpha = featherEdges(visited, img, W, H, FEATHER_RADIUS);
  
  // 统计
  let trans=0, opaque=0, semi=0;
  for(let i=0;i<W*H;i++){
    if(alpha[i]<5) trans++;
    else if(alpha[i]>250) opaque++;
    else semi++;
  }
  console.log(`  结果: 透明 ${trans} (${(trans/(W*H)*100).toFixed(1)}%) | 不透明 ${opaque} (${(opaque/(W*H)*100).toFixed(1)}%) | 半透明 ${semi}`);
  
  // 构建 RGBA
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i*4]   = img[i*3];
    rgba[i*4+1] = img[i*3+1];
    rgba[i*4+2] = img[i*3+2];
    rgba[i*4+3] = alpha[i];
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
  
  // rounded (圆角遮罩)
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
  
  // Installer sidebar PNG + BMP
  const sbW=164,sbH=314;
  const sbBg=Buffer.alloc(sbW*sbH*4);
  for(let i=0;i<sbW*sbH;i++){sbBg[i*4]=13;sbBg[i*4+1]=13;sbBg[i*4+2]=13;sbBg[i*4+3]=255}
  const msSmall=await sharp(rgba,{raw:{width:W,height:H,channels:4}})
    .resize(140,140,{fit:'contain',kernel:'lanczos3'}).png().toBuffer();
  
  const sbPng=await sharp(sbBg,{raw:{width:sbW,height:sbH,channels:4}})
    .composite([{input:msSmall,left:(sbW-140)/2,top:40}]).png().toBuffer();
  writeFileSync(resolve(RESOURCES,'installer-sidebar.png'),sbPng);
  console.log('  ✓ installer-sidebar.png');
  
  // BMP (NSIS 要求)
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
  bmpBuf.writeInt32LE(-sbH,18); // top-down
  bmpBuf.writeUInt16LE(1,22);
  bmpBuf.writeUInt16LE(24,24);
  bmpBuf.writeUInt32LE(pixSz,28);
  for(let y=0;y<sbH;y++)for(let x=0;x<sbW;x++){
    const si=(y*sbW+x)*3,dst=54+y*rowSz+x*3;
    bmpBuf[dst]=sbFlat[si+2];bmpBuf[dst+1]=sbFlat[si+1];bmpBuf[dst+2]=sbFlat[si];
  }
  writeFileSync(resolve(RESOURCES,'installer-sidebar.bmp'),bmpBuf);
  console.log(`  ✓ installer-sidebar.bmp (${(bmpBuf.length/1024).toFixed(1)} KB)`);

  console.log('\n✅ 全部完成！蓝圆保留 ✓ 白框已移除 ✓');
}

main().catch(e => { console.error(e); process.exit(1); });
