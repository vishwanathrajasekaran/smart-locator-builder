const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attrs]) => !/type\s*=\s*["']application\/ld\+json/i.test(attrs));

if (scripts.length === 0) throw new Error('No executable script found');
scripts.forEach(([, code], index) => {
  new vm.Script(code, { filename: `index.html#script${index}` });
});

const requiredIds = [
  'fw', 'pjb', 'capb', 'th', 'pro', 'src', 'an', 'smp', 'rs', 'upb', 'shb',
  'up', 'shot', 'shs', 'inv', 'det', 'm', 'mb', 'toast', 'yr'
];
for (const id of requiredIds) {
  if (!new RegExp(`id="${id}"`).test(html)) throw new Error(`Missing #${id}`);
}

const features = [
  'getByRole', 'getByLabel', 'getByPlaceholder', 'getByTestId',
  'Snapshot stability', 'Local projects', 'CAPTURE_BOOKMARKLET', 'MAX_HTML', 'nodePreview'
];
for (const feature of features) {
  if (!html.includes(feature)) throw new Error(`Missing feature marker: ${feature}`);
}

const bookmarklet = html.match(/const CAPTURE_BOOKMARKLET=`([\s\S]*?)`;/);
if (!bookmarklet) throw new Error('Capture bookmarklet source is missing');
new vm.Script(bookmarklet[1].replace(/^javascript:/, ''), { filename: 'capture-bookmarklet' });

for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon']) {
  if (html.includes(api)) throw new Error(`Unexpected network API in local app: ${api}`);
}

for (const asset of [
  'ocr/worker.min.js',
  'ocr/tesseract.min.js',
  'ocr/tesseract-core-lstm.wasm.js',
  'ocr/tesseract-core-simd-lstm.wasm.js',
  'ocr/lang/eng.traineddata.gz'
]) {
  if (!fs.existsSync(asset)) throw new Error(`Missing OCR asset: ${asset}`);
}

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const headers = vercel.headers.flatMap(entry => entry.headers || []);
if (!headers.some(header => header.key === 'Content-Security-Policy')) {
  throw new Error('Enforced Content-Security-Policy header is missing');
}
if (headers.some(header => header.key === 'Content-Security-Policy-Report-Only')) {
  throw new Error('Report-only CSP should not be the deployed policy');
}

console.log(`Static smoke checks passed (${scripts.length} executable script block)`);
