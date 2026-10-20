const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  throw new Error('Install Playwright to run this browser smoke test: npm install --save-dev playwright');
}

const root = path.join(__dirname, '..');
const extensionPath = path.join(root, 'browser-extension');
const baseUrl = process.env.SLB_BASE_URL || 'http://127.0.0.1:4321';
const browserPath = process.env.SLB_BROWSER || (
  fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    : 'C:/Program Files/Google/Chrome/Application/chrome.exe'
);

async function waitForServiceWorker(context) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const worker = context.serviceWorkers()[0];
    if (worker) return worker;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The extension service worker did not start. Check the unpacked extension manifest.');
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'slb-extension-browser-smoke-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: browserPath,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-sandbox',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const worker = await waitForServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    const source = await context.newPage();
    const errors = [];
    source.on('pageerror', (error) => errors.push(`source: ${error.message}`));
    await source.goto(`${baseUrl}/tests/fixtures/extension-source.html`, { waitUntil: 'networkidle' });

    const popup = await context.newPage();
    popup.on('pageerror', (error) => errors.push(`popup: ${error.message}`));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
    await popup.locator('#builder-url').fill(`${baseUrl}/`);
    await popup.locator('#builder-url').dispatchEvent('change');

    await source.bringToFront();
    await popup.locator('#capture-page').click();
    await popup.waitForFunction(
      () => document.querySelector('#last-capture-status')?.textContent.includes('Ready'),
      null,
      { timeout: 15000 }
    );

    await source.bringToFront();
    await popup.locator('#pick-element').click();
    const target = await source.locator('#save-button').boundingBox();
    if (!target) throw new Error('The picker target is not visible.');
    await source.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await source.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    const selectedCapture = await worker.evaluate(async () => (await chrome.storage.local.get('lastCapture')).lastCapture);
    if (!selectedCapture?.selected) throw new Error('The selected element was not stored.');

    await source.bringToFront();
    const builderPromise = context.waitForEvent('page');
    await popup.locator('#open-builder').click();
    const builder = await builderPromise;
    await builder.waitForLoadState('networkidle');
    await builder.waitForFunction(
      () => document.querySelector('#exts')?.textContent.includes('Extension capture received'),
      null,
      { timeout: 20000 }
    );
    await builder.waitForFunction(() => document.querySelectorAll('.it').length > 0, null, { timeout: 20000 });

    if (errors.length) throw new Error(errors.join('\n'));
    console.log(JSON.stringify({
      browser: path.basename(browserPath),
      capture: 'passed',
      picker: selectedCapture.selected.tagName,
      delivery: 'acknowledged',
      inventory: await builder.locator('.it').count(),
      errors: errors.length
    }));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
