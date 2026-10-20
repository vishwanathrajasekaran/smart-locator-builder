(() => {
  'use strict';

  const DEFAULT_BUILDER_URL = 'https://tools.vishwanathrajasekaran.in/smart-locator/';

  const currentPageTitle = document.getElementById('current-page-title');
  const currentPageUrl = document.getElementById('current-page-url');
  const builderUrlInput = document.getElementById('builder-url');
  const builderUrlStatus = document.getElementById('builder-url-status');
  const lastCaptureStatus = document.getElementById('last-capture-status');
  const actionStatus = document.getElementById('action-status');
  const capturePageButton = document.getElementById('capture-page');
  const pickElementButton = document.getElementById('pick-element');
  const copyJsonButton = document.getElementById('copy-json');
  const copyElementJsonButton = document.getElementById('copy-element-json');
  const openBuilderButton = document.getElementById('open-builder');

  let saveTimer = null;
  let currentState = {
    currentPage: null,
    builderUrl: DEFAULT_BUILDER_URL,
    lastCapture: null,
    lastCaptureStatus: null
  };

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function saveLocal(values) {
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

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatTime(value) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function captureSizeBytes(capture) {
    try {
      const serialized = JSON.stringify(capture);
      if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(serialized).length;
      }
      return serialized.length;
    } catch (_error) {
      return 0;
    }
  }

  function setBuilderUrlStatus(message, kind) {
    builderUrlStatus.textContent = message || '';
    builderUrlStatus.className = `field-status${kind ? ` ${kind}` : ''}`;
    builderUrlInput.setAttribute('aria-invalid', kind === 'error' ? 'true' : 'false');
  }

  function setActionStatus(message, kind) {
    actionStatus.textContent = message || '';
    actionStatus.className = `action-status${kind ? ` ${kind}` : ''}`;
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
      return false;
    }
  }

  async function persistBuilderUrl(showSavedMessage) {
    const value = builderUrlInput.value.trim();
    if (!isHttpUrl(value)) {
      setBuilderUrlStatus('Use a valid http:// or https:// URL.', 'error');
      return false;
    }

    try {
      await saveLocal({ builderUrl: value });
      currentState.builderUrl = value;
      setBuilderUrlStatus(showSavedMessage ? 'Saved locally.' : '', showSavedMessage ? 'success' : '');
      return true;
    } catch (error) {
      setBuilderUrlStatus(`Could not save URL: ${error.message}`, 'error');
      return false;
    }
  }

  function renderPage(page) {
    if (!page) {
      currentPageTitle.textContent = 'Unavailable';
      currentPageUrl.textContent = 'Open an http(s) page to capture it.';
      return;
    }
    currentPageTitle.textContent = page.title || '(untitled)';
    currentPageUrl.textContent = page.url || 'Unavailable';
    currentPageUrl.title = page.url || '';
  }

  function renderLastCapture(capture, status) {
    if (status && status.ok === false) {
      lastCaptureStatus.textContent = status.message || 'The last capture failed.';
      lastCaptureStatus.className = 'status-text error';
      copyElementJsonButton.disabled = true;
      return;
    }

    if (!capture) {
      lastCaptureStatus.textContent = 'No capture yet.';
      lastCaptureStatus.className = 'status-text';
      copyElementJsonButton.disabled = true;
      return;
    }

    const size = status && status.sizeBytes ? status.sizeBytes : captureSizeBytes(capture);
    const time = formatTime(capture.capturedAt);
    const selected = capture.selected && capture.selected.tagName
      ? ` · selected ${capture.selected.tagName.toLowerCase()}`
      : '';
    lastCaptureStatus.textContent = `Ready${time ? ` at ${time}` : ''} · ${formatBytes(size)}${selected}`;
    lastCaptureStatus.className = 'status-text';
    copyElementJsonButton.disabled = !(capture.selected && capture.selected.outerHTML);
  }

  function applyState(state) {
    if (!state) {
      return;
    }
    currentState = {
      ...currentState,
      ...state
    };
    renderPage(currentState.currentPage);
    if (document.activeElement !== builderUrlInput && currentState.builderUrl) {
      builderUrlInput.value = currentState.builderUrl;
    }
    renderLastCapture(currentState.lastCapture, currentState.lastCaptureStatus);
  }

  async function refreshState() {
    try {
      const state = await sendMessage({ type: 'SLB_GET_STATE' });
      applyState(state);
    } catch (error) {
      renderPage(null);
      setActionStatus(`Could not read extension state: ${error.message}`, 'error');
    }
  }

  async function requestCapture(messageType, label) {
    setActionStatus(`${label}…`);
    capturePageButton.disabled = true;
    pickElementButton.disabled = true;
    try {
      const response = await sendMessage({ type: messageType });
      if (!response || response.ok === false) {
        throw new Error((response && (response.error || response.message)) || 'The page could not be reached.');
      }
      setActionStatus(response.message || `${label} requested.`, 'success');
    } catch (error) {
      setActionStatus(error.message, 'error');
    } finally {
      capturePageButton.disabled = false;
      pickElementButton.disabled = false;
      await refreshState();
    }
  }

  async function copyJson() {
    setActionStatus('Preparing JSON…');
    copyJsonButton.disabled = true;
    try {
      const state = await sendMessage({ type: 'SLB_GET_STATE' });
      const capture = state && state.lastCapture;
      if (!capture) {
        throw new Error('There is no capture to copy yet.');
      }
      const json = JSON.stringify(capture, null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch (_clipboardError) {
        const fallback = document.createElement('textarea');
        fallback.value = json;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.left = '-9999px';
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand('copy');
        fallback.remove();
        if (!copied) {
          throw new Error('Clipboard access was denied.');
        }
      }
      setActionStatus('JSON copied to the clipboard.', 'success');
    } catch (error) {
      setActionStatus(error.message, 'error');
    } finally {
      copyJsonButton.disabled = false;
    }
  }

  function buildElementCapture(capture) {
    if (!capture || !capture.selected || !capture.selected.outerHTML) {
      throw new Error('Pick a target element before copying element JSON.');
    }
    return {
      type: 'smart-locator-element-capture',
      version: 1,
      capturedAt: capture.capturedAt,
      url: capture.url,
      title: capture.title,
      element: capture.selected
    };
  }

  async function copyElementJson() {
    setActionStatus('Preparing element JSON…');
    copyElementJsonButton.disabled = true;
    try {
      const state = await sendMessage({ type: 'SLB_GET_STATE' });
      const elementCapture = buildElementCapture(state && state.lastCapture);
      const json = JSON.stringify(elementCapture, null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch (_clipboardError) {
        const fallback = document.createElement('textarea');
        fallback.value = json;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.left = '-9999px';
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand('copy');
        fallback.remove();
        if (!copied) {
          throw new Error('Clipboard access was denied.');
        }
      }
      setActionStatus('Element-only JSON copied to the clipboard.', 'success');
    } catch (error) {
      setActionStatus(error.message, 'error');
      copyElementJsonButton.disabled = false;
      return;
    }
    copyElementJsonButton.disabled = false;
  }

  async function openBuilder() {
    setActionStatus('Opening Builder…');
    openBuilderButton.disabled = true;
    try {
      const saved = await persistBuilderUrl(false);
      if (!saved) {
        throw new Error('Save a valid Builder URL before opening it.');
      }
      const response = await sendMessage({ type: 'OPEN_BUILDER' });
      if (!response || response.ok === false) {
        throw new Error((response && (response.error || response.message)) || 'The Builder tab could not be opened.');
      }
      setActionStatus(response.message || 'Builder opened in a new tab.', 'success');
    } catch (error) {
      setActionStatus(error.message, 'error');
    } finally {
      openBuilderButton.disabled = false;
    }
  }

  builderUrlInput.addEventListener('input', () => {
    setBuilderUrlStatus('', '');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persistBuilderUrl(false);
    }, 450);
  });

  builderUrlInput.addEventListener('change', () => {
    clearTimeout(saveTimer);
    void persistBuilderUrl(true);
  });

  capturePageButton.addEventListener('click', () => {
    void requestCapture('SLB_CAPTURE_PAGE', 'Capturing page');
  });

  pickElementButton.addEventListener('click', () => {
    void requestCapture('SLB_START_PICKER', 'Starting picker');
  });

  copyJsonButton.addEventListener('click', () => {
    void copyJson();
  });

  copyElementJsonButton.addEventListener('click', () => {
    void copyElementJson();
  });

  openBuilderButton.addEventListener('click', () => {
    void openBuilder();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes.builderUrl && document.activeElement !== builderUrlInput) {
      builderUrlInput.value = changes.builderUrl.newValue || DEFAULT_BUILDER_URL;
      currentState.builderUrl = builderUrlInput.value;
    }
    if (changes.lastCapture) {
      currentState.lastCapture = changes.lastCapture.newValue || null;
    }
    if (changes.lastCaptureStatus) {
      currentState.lastCaptureStatus = changes.lastCaptureStatus.newValue || null;
    }
    if (changes.lastCapture || changes.lastCaptureStatus) {
      renderLastCapture(currentState.lastCapture, currentState.lastCaptureStatus);
    }
  });

  void refreshState();
})();
