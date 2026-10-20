const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'browser-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

if (manifest.manifest_version !== 3) throw new Error('Extension must use Manifest V3');
if (!manifest.background || manifest.background.service_worker !== 'service-worker.js') {
  throw new Error('Manifest service worker is missing');
}
for (const permission of ['activeTab', 'storage', 'tabs', 'clipboardWrite']) {
  if (!manifest.permissions.includes(permission)) throw new Error(`Missing permission: ${permission}`);
}
for (const file of ['popup.html', 'popup.css', 'popup.js', 'content.js', 'service-worker.js', 'README.md']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing extension file: ${file}`);
}

const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
if (/<script\s*>/i.test(popup)) throw new Error('Popup contains inline script');
for (const id of ['capture-page', 'pick-element', 'copy-json', 'open-builder', 'builder-url']) {
  if (!new RegExp(`id="${id}"`).test(popup)) throw new Error(`Popup control missing: #${id}`);
}

for (const file of ['content.js', 'service-worker.js', 'popup.js']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  new vm.Script(source, { filename: file });
}

const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const marker of [
  "type: 'smart-locator-capture'",
  "type: 'SLB_CAPTURE_READY'",
  "type: 'SLB_DELIVER_CAPTURE'",
  "SMART_LOCATOR_CAPTURE_ACK",
  'targetOrigin'
]) {
  if (!content.includes(marker) && !worker.includes(marker) && !app.includes(marker)) {
    throw new Error(`Capture protocol marker missing: ${marker}`);
  }
}

if (!content.includes('DELIVERY_ACK_TIMEOUT_MS')) throw new Error('Builder delivery timeout is missing');
if (!worker.includes('lastCapture: null')) throw new Error('Failed captures must clear stale captures');
if (!app.includes('capjsonb')) throw new Error('Builder capture JSON import control is missing');

console.log('Extension static checks passed');
