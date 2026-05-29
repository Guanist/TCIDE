/**
 * 虎猫 TCIDE 图标生成脚本
 * 使用 SVG 吉祥物作为源 → 生成透明背景的多尺寸图标
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 使用 SVG 源（透明背景），而非 JPG（白色背景）
const svgPath = path.join(__dirname, '..', 'resources', 'brand', 'mascot.svg');
const outputDir = path.join(__dirname, '..', 'resources');

// 虎猫品牌色
const BRAND_ORANGE = '#FF8C00';
const BRAND_DARK = '#0D0D0D';

async function generateIcons() {
  console.log('🐯 从 SVG 吉祥物生成透明背景图标...\n');

  // 先读取 SVG 内容，确保可用
  const svgBuffer = fs.readFileSync(svgPath);

  // ── 1. 主应用图标 PNG (256x256) ──
  await sharp(svgBuffer)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon.png'));
  console.log('✓ icon.png (256x256, 透明)');

  // ── 2. 关于对话框图标 (128x128) ──
  await sharp(svgBuffer)
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'about-icon.png'));
  console.log('✓ about-icon.png (128x128, 透明)');

  // ── 3. 任务栏图标 (32x32) ──
  await sharp(svgBuffer)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'tray-icon.png'));
  console.log('✓ tray-icon.png (32x32, 透明)');

  // ── 4. 任务栏图标 @2x (64x64 for HiDPI) ──
  await sharp(svgBuffer)
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'tray-icon@2x.png'));
  console.log('✓ tray-icon@2x.png (64x64, 透明)');

  // ── 5. 小图标 (64x64) ──
  await sharp(svgBuffer)
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon-small.png'));
  console.log('✓ icon-small.png (64x64, 透明)');

  // ── 6. 圆形图标 (用于某些系统) ──
  const circleSvg = Buffer.from(
    `<svg width="256" height="256"><circle cx="128" cy="128" r="120"/></svg>`
  );
  await sharp(svgBuffer)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .composite([{ input: circleSvg, blend: 'dest-in' }])
    .png()
    .toFile(path.join(outputDir, 'icon-rounded.png'));
  console.log('✓ icon-rounded.png (256x256, 圆形裁切)');

  // ── 7. 多尺寸 PNG (供 ICO 和系统使用) ──
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(outputDir, `icon-${size}.png`));
  }
  console.log(`✓ icon-{${sizes.join(',')}}.png (透明)`);

  // ── 8. 安装器侧边栏 (164x314, @2x: 328x628) ──
  // 使用深色背景 + 虎猫 SVG ── 更适合安装向导
  const sidebarBg = Buffer.from(
    `<svg width="328" height="628">
      <rect width="328" height="628" fill="${BRAND_DARK}"/>
    </svg>`
  );
  await sharp(sidebarBg)
    .composite([
      {
        input: await sharp(svgBuffer)
          .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer(),
        top: 164,
        left: 64,
      },
    ])
    .png()
    .toFile(path.join(outputDir, 'installer-sidebar.png'));
  console.log('✓ installer-sidebar.png (328x628, 深色背景+虎猫)');

  // ── 9. 吉祥物 PNG (200x200) ──
  await sharp(svgBuffer)
    .resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'mascot.png'));
  console.log('✓ mascot.png (200x200, 透明)');

  // ── 10. 生成 ICO 文件 ──
  console.log('\n🔧 生成 ICO 文件...');
  try {
    // 使用 256x256 PNG 作为 ICO 源
    const icoInput = path.join(outputDir, 'icon-256.png');
    const icoOutput = path.join(outputDir, 'icon.ico');
    execSync(`npx png-to-ico "${icoInput}" > "${icoOutput}"`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      shell: true,
    });
    console.log('✓ icon.ico (来自 256x256 透明 PNG)');
  } catch (e) {
    // png-to-ico 可能输出到 stderr，但也可能成功
    // 检查文件是否生成
    if (fs.existsSync(path.join(outputDir, 'icon.ico'))) {
      const icoStat = fs.statSync(path.join(outputDir, 'icon.ico'));
      console.log(`✓ icon.ico (${(icoStat.size / 1024).toFixed(1)} KB)`);
    } else {
      console.error('✗ icon.ico 生成失败:', e.message);
      // 回退：复制 256 PNG 重命名为 ico (不够标准但能用)
      fs.copyFileSync(
        path.join(outputDir, 'icon-256.png'),
        path.join(outputDir, 'icon.ico')
      );
      console.log('⚠ 回退方案：用 PNG 作为 ICO');
    }
  }

  console.log('\n✅ 所有图标生成完成！');
  console.log('📂 输出目录:', outputDir);
  console.log('🖼  源文件: resources/brand/mascot.svg (透明矢量)');
}

generateIcons().catch(err => {
  console.error('❌ 图标生成失败:', err);
  process.exit(1);
});