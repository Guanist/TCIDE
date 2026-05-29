import sharp from 'sharp';
import { copyFileSync, existsSync } from 'fs';

const BLUE = '#2563EB';
const SRC = 'resources/icon.png';

async function gen() {
  for (const s of [256, 128, 64, 48, 32, 24, 16]) {
    const cx = s >> 1;
    const radius = Math.floor(s * 0.43);
    const tigerSize = Math.floor(s * 0.75);
    const offset = Math.floor((s - tigerSize) / 2);

    const tiger = await sharp(SRC).resize(tigerSize, tigerSize, { fit: 'inside' }).toBuffer();
    const circle = Buffer.from(
      `<svg width="${s}" height="${s}"><circle cx="${cx}" cy="${cx}" r="${radius}" fill="${BLUE}"/></svg>`
    );
    await sharp(circle).composite([{ input: tiger, top: offset, left: offset }]).png().toFile(`resources/icon-${s}.png`);
    console.log(`icon-${s}.png`);
  }

  // tray icons
  for (const [s, suffix] of [[32, ''], [64, '@2x']]) {
    const cx = s >> 1;
    const radius = Math.floor(s * 0.45);
    const tigerSize = Math.floor(s * 0.7);
    const offset = Math.floor((s - tigerSize) / 2);
    const tiger = await sharp(SRC).resize(tigerSize, tigerSize, { fit: 'inside' }).toBuffer();
    const circle = Buffer.from(
      `<svg width="${s}" height="${s}"><circle cx="${cx}" cy="${cx}" r="${radius}" fill="${BLUE}"/></svg>`
    );
    await sharp(circle).composite([{ input: tiger, top: offset, left: offset }]).png().toFile(`resources/tray-icon${suffix}.png`);
    console.log(`tray-icon${suffix}.png`);
  }

  copyFileSync('resources/icon-256.png', 'resources/icon.png');
  copyFileSync('resources/icon-128.png', 'resources/about-icon.png');
  copyFileSync('resources/icon-64.png', 'resources/icon-small.png');

  // Generate ICO
  const pngToIco = await import('png-to-ico');
  const pngs = [256, 128, 64, 48, 32, 16].map(s => `resources/icon-${s}.png`).filter(f => existsSync(f));
  if (pngToIco.default) {
    const icoBuf = await pngToIco.default(pngs);
    await import('fs').then(fs => fs.writeFileSync('resources/icon.ico', icoBuf));
    console.log('icon.ico generated');
  }
  console.log('DONE');
}
gen().catch(e => { console.error(e); process.exit(1); });
