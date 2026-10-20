# Smart Locator Builder (own repo)

Static app. No build step, no API keys, no running costs. Screenshot reading uses Tesseract.js (OCR) in the browser, self-hosted in `ocr/`.

## Deploy
1. New GitHub repo `smart-locator-builder`, push this folder to the repo root.
2. Vercel > Add New > Project > import. Framework Preset: Other. No build command.
3. Name the project `smart-locator-builder` so its URL is https://smart-locator-builder.vercel.app
   (if you reuse your existing project, replace its files and keep that name).
4. Make sure the production URL opens without a Vercel login.
5. Public address is served through the gateway: https://tools.vishwanathrajasekaran.in/smart-locator/
   (gateway repo's vercel.json points at this project's URL; if your project URL differs, update it there).

## Notes
- robots.txt and sitemap.xml are served by the gateway, not here.
- canonical and og: tags already point to the tools.vishwanathrajasekaran.in address.
- Content-Security-Policy is enforced in `vercel.json` and allows the inline static app, local OCR worker, blob workers and WASM runtime required by Tesseract.js.
- The Pro gate is client-side and demo only. It is not payment or access control; add real checkout and server verification before charging.

## Local-only enhancements

The tool does not require MCP. Analysis, scoring, Playwright semantic locator suggestions, stability comparison, local project save/load, JSON project import/export, OCR and locator exports all run in the browser.

- Phase 1 reliability: stale-state clearing, async cancellation guards, input limits, safe XPath previews, validated local preferences, safe variable names and CSV formula-injection protection.
- Phase 2 locator quality: `getByRole`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `getByText` and `getByAltText` suggestions, accessibility-aware ranking, duplicate detection, and cross-snapshot match checks.
- Saved projects use browser storage only. They are not synced between browsers or users.
- The Capture helper generates a bookmarklet that copies the current page DOM to the clipboard. This is a user-triggered bridge for live pages; it is not automatic browser control and does not require MCP.
- A no-build Chrome/Edge Manifest V3 extension is available in `browser-extension/`. It can capture the current page, pick a target element, copy either the full-page JSON or a separate element-only JSON object, or deliver a full-context capture into the Builder through an exact-origin handshake. See `browser-extension/README.md` for installation and permissions.

## Checks

Run the dependency-free static smoke test from this directory:

```bash
node tests/smoke.js
```

Run the extension static checks:

```bash
node tests/extension-static.js
```

The real browser smoke test uses Playwright and a locally installed Chrome or Edge browser. Start the local server first, then install Playwright in your environment and run:

```bash
python -m http.server 4321
npm install --save-dev playwright
node tests/extension-browser-smoke.js
```

The smoke test loads the unpacked extension, captures the fixture page, picks the fixture button, opens the Builder, waits for the import acknowledgement, and verifies that the inventory is populated.

For behavior checks, serve the directory with Python's standard server and use a browser:

```bash
python -m http.server 4173
```

Then open `http://127.0.0.1:4173/`, load the sample, test custom XPath/CSS, switch frameworks, save and reload a project, compare a second snapshot, and inspect the Console and Network panels. The main app still has no bundled browser test dependency; the extension flow has the optional Playwright smoke test above.
