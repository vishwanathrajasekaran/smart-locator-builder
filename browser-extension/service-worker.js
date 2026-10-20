(() => {
  'use strict';

  const DEFAULT_BUILDER_URL = 'https://tools.vishwanathrajasekaran.in/smart-locator/';
  const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
  const MAX_DELIVERY_ATTEMPTS = 8;
  const DELIVERY_RETRY_DELAY_MS = 300;

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(result);
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve();
      });
    });
  }

  function queryActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function createTab(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(tab);
      });
    });
  }

  function getTab(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(tab);
      });
    });
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
      return false;
    }
  }

  function utf8ByteLength(value) {
    if (typeof TextEncoder === 'function') {
      return new TextEncoder().encode(value).length;
    }
    return value.length;
  }

  function captureSizeBytes(capture) {
    try {
      return utf8ByteLength(JSON.stringify(capture));
    } catch (_error) {
      return 0;
    }
  }

  function isCaptureProtocol(capture) {
    if (!capture || capture.type !== 'smart-locator-capture' || capture.version !== 1 ||
      typeof capture.capturedAt !== 'string' || typeof capture.url !== 'string' ||
      typeof capture.title !== 'string' || typeof capture.html !== 'string' || !capture.html.trim()) {
      return false;
    }
    try {
      if (!/^https?:$/.test(new URL(capture.url).protocol)) {
        return false;
      }
    } catch (_error) {
      return false;
    }
    return capture.selected === null || (
      typeof capture.selected === 'object' &&
      typeof capture.selected.tagName === 'string' &&
      typeof capture.selected.outerHTML === 'string' &&
      Array.isArray(capture.selected.path) &&
      capture.selected.path.every((entry) => Number.isInteger(entry) && entry >= 0) &&
      Array.isArray(capture.selected.attributes) &&
      capture.selected.attributes.every((attribute) => attribute && typeof attribute.name === 'string' && typeof attribute.value === 'string')
    );
  }

  function captureStatus(ok, message, extra) {
    return {
      ok,
      message,
      capturedAt: new Date().toISOString(),
      ...(extra || {})
    };
  }

  async function getBuilderUrl() {
    const stored = await storageGet({ builderUrl: null });
    const value = typeof stored.builderUrl === 'string' ? stored.builderUrl.trim() : '';
    if (isHttpUrl(value)) {
      return value;
    }
    await storageSet({ builderUrl: DEFAULT_BUILDER_URL });
    return DEFAULT_BUILDER_URL;
  }

  async function recordCaptureError(message, extra) {
    await storageSet({
      lastCapture: null,
      lastCaptureStatus: captureStatus(false, message, extra)
    });
  }

  async function handleCaptureReady(capture, sender) {
    if (!isCaptureProtocol(capture)) {
      const message = 'The page returned an invalid capture.';
      await recordCaptureError(message);
      return { ok: false, error: message };
    }

    const sizeBytes = captureSizeBytes(capture);
    if (!sizeBytes || sizeBytes > MAX_CAPTURE_BYTES) {
      const message = 'The capture is too large to store. Try Pick element or a smaller page.';
      await recordCaptureError(message, { sizeBytes });
      return { ok: false, error: message };
    }

    await storageSet({
      lastCapture: capture,
      lastCaptureStatus: captureStatus(true, 'Capture ready.', {
        capturedAt: capture.capturedAt,
        sizeBytes,
        tabId: sender && sender.tab ? sender.tab.id : null
      })
    });
    return { ok: true, sizeBytes };
  }

  async function handleCaptureError(message, sender) {
    const errorMessage = typeof message.message === 'string' && message.message
      ? message.message
      : 'The page capture failed.';
    const extra = {
      tabId: sender && sender.tab ? sender.tab.id : null
    };
    if (Number.isFinite(message.sizeBytes)) {
      extra.sizeBytes = message.sizeBytes;
    }
    await recordCaptureError(errorMessage, extra);
    return { ok: true };
  }

  async function handleGetState() {
    const [tab, stored] = await Promise.all([
      queryActiveTab(),
      storageGet({
        builderUrl: null,
        lastCapture: null,
        lastCaptureStatus: null
      })
    ]);

    const builderUrl = isHttpUrl(stored.builderUrl)
      ? stored.builderUrl
      : await getBuilderUrl();

    return {
      ok: true,
      currentPage: tab
        ? {
          id: tab.id,
          url: tab.url || '',
          title: tab.title || ''
        }
        : null,
      builderUrl,
      lastCapture: stored.lastCapture || null,
      lastCaptureStatus: stored.lastCaptureStatus || null
    };
  }

  async function sendCaptureCommand(commandType) {
    const tab = await queryActiveTab();
    if (!tab || typeof tab.id !== 'number') {
      const message = 'There is no active browser tab to capture.';
      await recordCaptureError(message);
      return { ok: false, error: message };
    }

    try {
      const response = await sendTabMessage(tab.id, { type: commandType });
      if (response && response.ok === false) {
        await recordCaptureError(response.error || 'The page capture failed.', { tabId: tab.id });
        return response;
      }
      return response || { ok: true };
    } catch (error) {
      const message = `Cannot access this page. Open an http(s) page and try again. (${error.message})`;
      await recordCaptureError(message, { tabId: tab.id });
      return { ok: false, error: message };
    }
  }

  function scheduleCaptureDelivery(tabId, capture, targetOrigin) {
    return new Promise((resolve) => {
      let started = false;
      let attempts = 0;
      let settled = false;
      let fallbackTimer = null;
      const deliveryId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `slb-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const removeLoadListener = () => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };

      const finish = (ok, message) => {
        if (settled) {
          return;
        }
        settled = true;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
        }
        removeLoadListener();
        const status = {
          ok,
          message,
          tabId,
          deliveredAt: new Date().toISOString()
        };
        storageSet({ lastDeliveryStatus: status })
          .then(() => resolve({ ok, message }))
          .catch(() => resolve({ ok, message }));
      };

      const attemptDelivery = () => {
        if (settled) {
          return;
        }
        attempts += 1;
        sendTabMessage(tabId, {
          type: 'SLB_DELIVER_CAPTURE',
          capture,
          deliveryId,
          targetOrigin
        }).then((response) => {
          if (!response || response.ok !== true) {
            throw new Error((response && response.error) || 'The Builder content script is not ready.');
          }
          finish(true, 'Capture delivered to Builder.');
        }).catch((error) => {
          if (attempts < MAX_DELIVERY_ATTEMPTS) {
            setTimeout(attemptDelivery, DELIVERY_RETRY_DELAY_MS);
            return;
          }
          finish(false, `Builder tab opened, but capture delivery failed: ${error.message}`);
        });
      };

      const startDelivery = () => {
        if (started || settled) {
          return;
        }
        started = true;
        removeLoadListener();
        attemptDelivery();
      };

      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          startDelivery();
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);

      // Avoid leaving an onUpdated listener around forever if a tab never
      // reports complete. The bounded delivery attempts still provide a clear
      // failure status in storage.
      fallbackTimer = setTimeout(() => {
        startDelivery();
      }, MAX_DELIVERY_ATTEMPTS * DELIVERY_RETRY_DELAY_MS);

      getTab(tabId).then((tab) => {
        if (tab && tab.status === 'complete') {
          startDelivery();
        }
      }).catch(() => {});
    });
  }

  async function openBuilder() {
    const builderUrl = await getBuilderUrl();
    const stored = await storageGet({ lastCapture: null, lastCaptureStatus: null });
    const tab = await createTab({ url: builderUrl, active: true });
    const capture = stored.lastCaptureStatus && stored.lastCaptureStatus.ok === true && stored.lastCapture && isCaptureProtocol(stored.lastCapture)
      ? stored.lastCapture
      : null;
    const targetOrigin = new URL(builderUrl).origin;
    let delivery = null;
    if (tab && typeof tab.id === 'number' && capture) {
      delivery = await scheduleCaptureDelivery(tab.id, capture, targetOrigin);
    }
    if (delivery && !delivery.ok) {
      return {
        ok: false,
        tabId: tab && tab.id,
        error: delivery.message
      };
    }
    return {
      ok: true,
      tabId: tab && tab.id,
      message: capture
        ? 'Builder opened and the latest capture was delivered.'
        : 'Builder opened. Capture a page first to send JSON to it.'
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }

    if (message.type === 'SLB_GET_STATE') {
      handleGetState().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'SLB_CAPTURE_PAGE' || message.type === 'SLB_START_PICKER') {
      sendCaptureCommand(message.type)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'SLB_CAPTURE_READY') {
      handleCaptureReady(message.capture, sender)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'SLB_CAPTURE_ERROR') {
      handleCaptureError(message, sender)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'SLB_PICKER_CANCELLED') {
      recordCaptureError('Element picker cancelled.').then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'OPEN_BUILDER' || message.type === 'SLB_OPEN_BUILDER') {
      openBuilder()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    return false;
  });
})();
