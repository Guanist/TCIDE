const fs = require('fs');

const htmlPath = 'C:/Users/noirh/.qclaw/workspace-ua58rsb93veqtxl7/personal-ide/src/renderer/pet-window.html';
const manifestPath = 'C:/Users/noirh/.qclaw/workspace-ua58rsb93veqtxl7/pet_manifest.json';

const html = fs.readFileSync(htmlPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// build the JS string literal (single-quoted). Manifest values contain only
// safe chars (data URI: A-Za-z0-9,+/=,:;,"), so a single-quoted string works.
const manifestStr = JSON.stringify(manifest);

const re = /var MANIFEST='[\s\S]*?';/;
if (!re.test(html)) {
  console.error('MANIFEST declaration not found!');
  process.exit(1);
}
const replaced = html.replace(re, "var MANIFEST='" + manifestStr + "';");

// sanity: the new html should contain the idle key
if (!replaced.includes('"idle":"data:image/png')) {
  console.error('Replacement looks wrong (idle key missing). Aborting.');
  process.exit(1);
}
fs.writeFileSync(htmlPath, replaced, 'utf8');
console.log('Injected new MANIFEST into', htmlPath);
console.log('old size / new size:', html.length, '/', replaced.length);
