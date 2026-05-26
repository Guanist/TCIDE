/**
 * 生成 NSIS 安装向导左侧图片 (164x314 像素)
 * 虎猫风格：橙色主题 + 猫爪/猫脸图案
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';

const WIDTH = 164;
const HEIGHT = 314;

// 创建 SVG
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#FF8C00;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#CC7000;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="#00000099"/>
    </filter>
  </defs>
  
  <!-- 背景 -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  
  <!-- 装饰条纹（虎纹） -->
  <ellipse cx="120" cy="60" rx="60" ry="80" fill="#00000015" />
  <ellipse cx="130" cy="200" rx="50" ry="120" fill="#00000010" />
  
  <!-- 猫脸 -->
  <g transform="translate(82, 120)" filter="url(#shadow)">
    <!-- 脸 -->
    <ellipse cx="0" cy="10" rx="50" ry="45" fill="#FFA500" />
    <!-- 左耳 -->
    <polygon points="-38,-30 -50,-70 -20,-40" fill="#FF8C00" />
    <polygon points="-38,-30 -50,-70 -20,-40" fill="#FFA50022" transform="scale(0.7)" />
    <!-- 右耳 -->
    <polygon points="38,-30 50,-70 20,-40" fill="#FF8C00" />
    <!-- 左眼 -->
    <ellipse cx="-18" cy="5" rx="8" ry="10" fill="#FFFFFF" />
    <ellipse cx="-18" cy="5" rx="5" ry="7" fill="#1A1A1A" />
    <!-- 右眼 -->
    <ellipse cx="18" cy="5" rx="8" ry="10" fill="#FFFFFF" />
    <ellipse cx="18" cy="5" rx="5" ry="7" fill="#1A1A1A" />
    <!-- 鼻子 -->
    <ellipse cx="0" cy="18" rx="5" ry="3" fill="#FF69B4" />
    <!-- 嘴巴 -->
    <path d="M -8,25 Q 0,35 8,25" stroke="#1A1A1A" stroke-width="2" fill="none" />
    <!-- 胡须左 -->
    <line x1="-45" y1="12" x2="-20" y2="16" stroke="#1A1A1A" stroke-width="1.5" />
    <line x1="-45" y1="20" x2="-20" y2="20" stroke="#1A1A1A" stroke-width="1.5" />
    <line x1="-45" y1="28" x2="-20" y2="24" stroke="#1A1A1A" stroke-width="1.5" />
    <!-- 胡须右 -->
    <line x1="45" y1="12" x2="20" y2="16" stroke="#1A1A1A" stroke-width="1.5" />
    <line x1="45" y1="20" x2="20" y2="20" stroke="#1A1A1A" stroke-width="1.5" />
    <line x1="45" y1="28" x2="20" y2="24" stroke="#1A1A1A" stroke-width="1.5" />
  </g>
  
  <!-- 文字 TCIDE -->
  <text x="${WIDTH/2}" y="250" font-family="Arial, sans-serif" font-size="28" 
        font-weight="bold" fill="#FFFFFF" text-anchor="middle" filter="url(#shadow)">
    TCIDE
  </text>
  
  <!-- 版本号 -->
  <text x="${WIDTH/2}" y="280" font-family="Arial, sans-serif" font-size="12" 
        fill="#FFFFFFCC" text-anchor="middle">
    v1.0.0
  </text>
  
  <!-- 底部装饰 -->
  <circle cx="40" cy="290" r="4" fill="#FFFFFF44" />
  <circle cx="${WIDTH/2}" cy="290" r="4" fill="#FFFFFF44" />
  <circle cx="${WIDTH-40}" cy="290" r="4" fill="#FFFFFF44" />
</svg>`;

// 保存 SVG
writeFileSync('resources/installer-sidebar.svg', svg);

// 转换为 PNG
await sharp(Buffer.from(svg))
  .png()
  .toFile('resources/installer-sidebar.png');

console.log('✅ 安装向导左侧图片已生成：resources/installer-sidebar.png');
console.log(`   尺寸：${WIDTH}x${HEIGHT} 像素`);
