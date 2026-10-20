# Smart Locator Builder browser extension

This is a no-build Chrome/Edge Manifest V3 extension for taking a user-triggered DOM snapshot and sending it to the Smart Locator Builder page.

## Install in Chrome

1. Keep this `browser-extension` directory together with its files.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this `browser-extension` directory.
5. Pin **Smart Locator Builder** from the extensions menu if desired.

## Install in Microsoft Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this `browser-extension` directory.

## Use

1. Navigate to an `http://` or `https://` page.
2. Open the extension popup. The current page title and URL are shown at the top.
3. Choose **Capture page** for the full document, or **Pick element** and click an element on the page. The picker highlights the element and allows normal page scrolling; press **Escape** to cancel it.
4. Use **Copy JSON** to copy the latest capture to the clipboard.
5. Set **Builder URL** if needed, then choose **Open in Builder**. The default is `https://tools.vishwanathrajasekaran.in/smart-locator/`; local URLs such as `http://127.0.0.1:3000/` are accepted.
6. If you already downloaded a capture, use the Builder's **Import capture JSON** button to load it without the extension.

The serialized capture is limited to about 2 MB. If it is larger, the extension records a clear error instead of silently dropping it. **Pick element** adds the selected element metadata, but the current protocol still includes the full document so the Builder can validate locator uniqueness in context; it does not bypass the full-document size limit.

## Permissions and privacy

- `activeTab`: supports access initiated by the user from the extension action.
- `storage`: stores the Builder URL, the last capture, and local status messages in `chrome.storage.local`.
- `tabs`: reads the active tab's title and URL, opens the configured Builder URL in a new tab, and retries delivery after that tab loads.
- `clipboardWrite`: lets **Copy JSON** write the capture to the system clipboard.
- `http://*/*` and `https://*/*` host permissions: allow the content script to receive user-triggered capture commands on ordinary HTTP(S) pages and to relay a capture into a configured Builder URL. Browser-internal pages such as `chrome://` and `edge://` are not targeted.

The extension has no external libraries and makes no network requests or uploads. Captures stay in local extension storage until the user copies or opens them. **Open in Builder** only navigates the browser to the configured URL and passes the existing capture to that page through an exact-origin `window.postMessage` handshake; it does not put the capture in the URL or send it to a server. The Builder confirms the import before the extension reports delivery success. This is a user-triggered DOM snapshot, not live browser automation.

## Message protocol

### Extension messages

The popup sends these commands to the service worker:

- `SLB_CAPTURE_PAGE`: capture `document.documentElement.outerHTML` with `selected: null`.
- `SLB_START_PICKER`: activate the fixed high-z-index picker outline.
- `OPEN_BUILDER`: open the configured Builder URL and deliver the stored capture after load.

The service worker sends `SLB_CAPTURE_PAGE`, `SLB_START_PICKER`, and `SLB_DELIVER_CAPTURE` to the content script.

The content script sends these messages to the service worker:

- `SLB_CAPTURE_READY` with `{ capture }` after a successful capture.
- `SLB_CAPTURE_ERROR` with `{ message, sizeBytes? }` when capture serialization or the size guard fails.
- `SLB_PICKER_CANCELLED` when the user presses Escape.

The capture command response is not reported as successful until the extension has stored the capture. A failed or cancelled operation clears the previously stored capture so **Copy JSON** and **Open in Builder** cannot accidentally reuse stale data.

### Capture object

Successful captures use this protocol:

```json
{
  "type": "smart-locator-capture",
  "version": 1,
  "capturedAt": "2026-01-01T00:00:00.000Z",
  "url": "https://example.com/page",
  "title": "Example page",
  "html": "<html>...</html>",
  "selected": null
}
```

When an element is picked, `selected` is an object with `tagName`, `outerHTML`, a numeric `path` from the document root, and an `attributes` array containing `{ "name": "...", "value": "..." }` entries.

When a stored capture is delivered, the content script posts this page message:

```js
window.postMessage({
  source: 'smart-locator-extension',
  type: 'SMART_LOCATOR_CAPTURE',
  deliveryId: 'one-time-id',
  targetOrigin: 'https://tools.vishwanathrajasekaran.in',
  capture
}, targetOrigin);
```

The actual extension uses the configured Builder origin instead of `*`. After importing, the Builder posts `SMART_LOCATOR_CAPTURE_ACK` with the same `deliveryId` and the extension waits for that acknowledgement.

## Test checklist

From the project root:

```bash
node tests/extension-static.js
node --check browser-extension/content.js
node --check browser-extension/service-worker.js
node --check browser-extension/popup.js
```

For a browser smoke test, load the unpacked extension in Edge or Chrome, open `tests/fixtures/extension-source.html` from a local HTTP server, and verify **Capture page**, **Pick element**, **Copy JSON**, and **Open in Builder**. The Builder should show `Extension capture received`, select the picked element, and populate the inventory. A capture larger than about 2 MB should clear the stored capture and show an error instead of reusing an older snapshot.
