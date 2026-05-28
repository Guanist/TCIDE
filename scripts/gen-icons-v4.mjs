import sharp from 'sharp';
import { writeFileSync, copyFileSync, existsSync } from 'fs';

const SRC = 'resources/tiger-mascot.jpg';

async function gen() {
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const pngs = [];

  for (const s of sizes) {
    await sharp(SRC)
      .resize(s, s, { kernel: 'lanczos3', fit: 'cover', position: 'center' })
      .png({ quality: 95, compressionLevel: 1 })
      .toFile(`resources/icon-${s}.png`);
    pngs.push(`resources/icon-${s}.png`);
    console.log(`icon-${s}.png`);
  }

  // Main icon & derivatives
  copyFileSync('resources/icon-256.png', 'resources/icon.png');
  copyFileSync('resources/icon-128.png', 'resources/about-icon.png');
  copyFileSync('resources/icon-64.png', 'resources/icon-small.png');

  // Tray icons (square from source)
  await sharp(SRC).resize(32, 32, { kernel: 'lanczos3', fit: 'cover', position: 'center' }).png({ quality: 95 }).toFile('resources/tray-icon.png');
  await sharp(SRC).resize(64, 64, { kernel: 'lanczos3', fit: 'cover', position: 'center' }).png({ quality: 95 }).toFile('resources/tray-icon@2x.png');
  console.log('tray-icon.png, tray-icon@2x.png');

  // Rounded icon (circle crop)
  const circleMask = Buffer.from(
    `<svg width="256" height="256"><circle cx="128" cy="128" r="128" fill="white"/></svg>`
  );
  await sharp(SRC)
    .resize(256, 256, { kernel: 'lanczos3', fit: 'cover', position: 'center' })
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toFile('resources/icon-rounded.png');
  console.log('icon-rounded.png');

  // Mascot (200x200)
  await sharp(SRC).resize(200, 200, { kernel: 'lanczos3', fit: 'cover', position: 'center' }).png({ quality: 95 }).toFile('resources/mascot.png');
  console.log('mascot.png');

  // Installer sidebar: NSIS expects 164x314
  await sharp(SRC)
    .resize(164, 314, { kernel: 'lanczos3', fit: 'cover', position: 'center' })
    .png()
    .toFile('resources/installer-sidebar.png');
  console.log('installer-sidebar.png 164x314');

  // ICO
  try {
    const pngToIco = await import('png-to-ico');
    if (pngToIco.default) {
      const icoBuf = await pngToIco.default(pngs.filter(f => existsSync(f)));
      writeFileSync('resources/icon.ico', icoBuf);
      console.log('icon.ico generated');
    }
  } catch (e) {
    console.error('ICO generation failed:', e.message);
  }

  console.log('DONE - all icons from tiger-mascot.jpg (1280x1280)');
}
gen().catch(e => { console.error(e); process.exit(1); });
