(() => {
  'use strict';

  const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
  const DELIVERY_ACK_TIMEOUT_MS = 5000;
  const PICKER_OVERLAY_ID = '__smart_locator_builder_picker_overlay__';

  let pickerState = null;
  const pendingDeliveryAcks = new Map();

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          resolve(response || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function utf8ByteLength(value) {
    if (typeof TextEncoder === 'function') {
      return new TextEncoder().encode(value).length;
    }
    return value.length;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function getElementPath(element) {
    const path = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        index += 1;
        sibling = sibling.previousElementSibling;
      }
      path.unshift(index);
      current = current.parentElement;
    }
    return path;
  }

  function getSelectedData(element) {
    return {
      tagName: element.tagName,
      outerHTML: element.outerHTML,
      path: getElementPath(element),
      attributes: Array.from(element.attributes, (attribute) => ({
        name: attribute.name,
        value: attribute.value
      }))
    };
  }

  function buildCapture(selectedElement) {
    return {
      type: 'smart-locator-capture',
      version: 1,
      capturedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      html: document.documentElement ? document.documentElement.outerHTML : '',
      selected: selectedElement ? getSelectedData(selectedElement) : null
    };
  }

  async function captureAndSend(selectedElement) {
    let capture;
    let serialized;
    try {
      capture = buildCapture(selectedElement);
      serialized = JSON.stringify(capture);
    } catch (_error) {
      const message = 'Could not serialize this page capture.';
      await sendRuntimeMessage({ type: 'SLB_CAPTURE_ERROR', message }).catch(() => {});
      return { ok: false, error: message };
    }

    const sizeBytes = utf8ByteLength(serialized);
    if (sizeBytes > MAX_CAPTURE_BYTES) {
      const message = `Capture is too large (${formatBytes(sizeBytes)}; limit is about 2 MB). Try Pick element or a smaller page.`;
      await sendRuntimeMessage({ type: 'SLB_CAPTURE_ERROR', message, sizeBytes }).catch(() => {});
      return { ok: false, error: message };
    }

    try {
      const response = await sendRuntimeMessage({ type: 'SLB_CAPTURE_READY', capture });
      if (!response || response.ok !== true) {
        return { ok: false, error: response && response.error ? response.error : 'The capture could not be stored.' };
      }
      return { ok: true, sizeBytes, message: 'Capture stored. The latest result will appear here.' };
    } catch (error) {
      return { ok: false, error: `The capture could not be stored: ${error.message}` };
    }
  }

  function elementAtPoint(event, overlay) {
    overlay.style.setProperty('display', 'none', 'important');
    const element = document.elementFromPoint(event.clientX, event.clientY);
    overlay.style.setProperty('display', 'block', 'important');
    if (!element || overlay.contains(element)) {
      return null;
    }
    return element;
  }

  function consumeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function removePicker() {
    if (!pickerState) {
      return;
    }

    const state = pickerState;
    pickerState = null;
    state.overlay.removeEventListener('mousemove', state.onMouseMove, true);
    state.overlay.removeEventListener('mousedown', state.onMouseDown, true);
    state.overlay.removeEventListener('mouseup', state.onMouseUp, true);
    state.overlay.removeEventListener('click', state.onClick, true);
    state.overlay.removeEventListener('contextmenu', state.onContextMenu, true);
     state.overlay.removeEventListener('wheel', state.onWheel, true);
    document.removeEventListener('keydown', state.onKeyDown, true);
    if (state.overlay && state.overlay.isConnected) {
      state.overlay.remove();
    }
  }

  function startPicker() {
    removePicker();

    const overlay = document.createElement('div');
    overlay.id = PICKER_OVERLAY_ID;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.setProperty('all', 'initial', 'important');
    overlay.style.setProperty('position', 'fixed', 'important');
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty('pointer-events', 'auto', 'important');
    overlay.style.setProperty('z-index', '2147483647', 'important');
    overlay.style.setProperty('box-sizing', 'border-box', 'important');
    overlay.style.setProperty('top', '0', 'important');
    overlay.style.setProperty('right', '0', 'important');
    overlay.style.setProperty('bottom', '0', 'important');
    overlay.style.setProperty('left', '0', 'important');
    overlay.style.setProperty('cursor', 'crosshair', 'important');
    overlay.style.setProperty('background', 'transparent', 'important');

    const outline = document.createElement('div');
    outline.setAttribute('aria-hidden', 'true');
    outline.style.setProperty('all', 'initial', 'important');
    outline.style.setProperty('position', 'fixed', 'important');
    outline.style.setProperty('display', 'none', 'important');
    outline.style.setProperty('pointer-events', 'none', 'important');
    outline.style.setProperty('z-index', '2147483647', 'important');
    outline.style.setProperty('box-sizing', 'border-box', 'important');
    outline.style.setProperty('border', '2px solid #4a6cf7', 'important');
    outline.style.setProperty('background', 'rgba(74, 108, 247, 0.12)', 'important');
    outline.style.setProperty('border-radius', '2px', 'important');
    overlay.appendChild(outline);
    document.documentElement.appendChild(overlay);

    const state = {
      overlay,
      outline,
      onMouseMove: null,
      onMouseDown: null,
      onMouseUp: null,
      onClick: null,
      onContextMenu: null,
      onWheel: null,
      onKeyDown: null
    };

    state.onMouseMove = (event) => {
      consumeEvent(event);
      const element = elementAtPoint(event, overlay);
      if (!element) {
        outline.style.setProperty('display', 'none', 'important');
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        outline.style.setProperty('display', 'none', 'important');
        return;
      }

      outline.style.setProperty('display', 'block', 'important');
      outline.style.setProperty('left', `${rect.left}px`, 'important');
      outline.style.setProperty('top', `${rect.top}px`, 'important');
      outline.style.setProperty('width', `${rect.width}px`, 'important');
      outline.style.setProperty('height', `${rect.height}px`, 'important');
    };

    state.onMouseDown = consumeEvent;
    state.onMouseUp = consumeEvent;
    state.onContextMenu = consumeEvent;
     state.onWheel = () => {};
    state.onClick = (event) => {
      const element = elementAtPoint(event, overlay);
      consumeEvent(event);
      if (!element) {
        return;
      }
      removePicker();
       void captureAndSend(element);
    };
     state.onKeyDown = (event) => {
       if (event.key !== 'Escape') {
         return;
       }
       consumeEvent(event);
       removePicker();
       void sendRuntimeMessage({ type: 'SLB_PICKER_CANCELLED' }).catch(() => {});
     };

    pickerState = state;
    overlay.addEventListener('mousemove', state.onMouseMove, true);
    overlay.addEventListener('mousedown', state.onMouseDown, true);
    overlay.addEventListener('mouseup', state.onMouseUp, true);
    overlay.addEventListener('click', state.onClick, true);
    overlay.addEventListener('contextmenu', state.onContextMenu, true);
    overlay.addEventListener('wheel', state.onWheel, true);
    document.addEventListener('keydown', state.onKeyDown, true);
  }

  function isCaptureProtocol(value) {
    if (!value || value.type !== 'smart-locator-capture' || value.version !== 1 ||
      typeof value.capturedAt !== 'string' || typeof value.url !== 'string' ||
      typeof value.title !== 'string' || typeof value.html !== 'string' || !value.html.trim()) {
      return false;
    }
    try {
      if (!/^https?:$/.test(new URL(value.url).protocol)) {
        return false;
      }
    } catch (_error) {
      return false;
    }
    return value.selected === null || (
      typeof value.selected === 'object' &&
      typeof value.selected.tagName === 'string' &&
      typeof value.selected.outerHTML === 'string' &&
      Array.isArray(value.selected.path) &&
      value.selected.path.every((entry) => Number.isInteger(entry) && entry >= 0) &&
      Array.isArray(value.selected.attributes) &&
      value.selected.attributes.every((attribute) => attribute && typeof attribute.name === 'string' && typeof attribute.value === 'string')
    );
  }

  function waitForBuilderAck(deliveryId, targetOrigin) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingDeliveryAcks.delete(deliveryId);
        resolve({ ok: false, error: 'The Builder did not confirm the capture import.' });
      }, DELIVERY_ACK_TIMEOUT_MS);
      pendingDeliveryAcks.set(deliveryId, {
        targetOrigin,
        resolve: (response) => {
          clearTimeout(timer);
          pendingDeliveryAcks.delete(deliveryId);
          resolve(response);
        }
      });
    });
  }

  function deliverCapture(message) {
    const capture = message && message.capture;
    const targetOrigin = message && message.targetOrigin;
    const deliveryId = message && message.deliveryId;
    if (!isCaptureProtocol(capture)) {
      return Promise.resolve({ ok: false, error: 'The Builder received an invalid capture.' });
    }
    if (!deliveryId || typeof deliveryId !== 'string') {
      return Promise.resolve({ ok: false, error: 'The Builder delivery id is missing.' });
    }
    if (typeof targetOrigin !== 'string' || targetOrigin !== location.origin) {
      return Promise.resolve({ ok: false, error: 'The configured Builder origin does not match this tab.' });
    }
    const acknowledgement = waitForBuilderAck(deliveryId, targetOrigin);
    window.postMessage({
      source: 'smart-locator-extension',
      type: 'SMART_LOCATOR_CAPTURE',
      deliveryId,
      targetOrigin,
      capture
    }, targetOrigin);
    return acknowledgement;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'smart-locator-builder' || event.data.type !== 'SMART_LOCATOR_CAPTURE_ACK') {
      return;
    }
    const pending = pendingDeliveryAcks.get(event.data.deliveryId);
    if (!pending || event.origin !== pending.targetOrigin) {
      return;
    }
    pending.resolve({
      ok: event.data.ok === true,
      error: event.data.ok === true ? undefined : (event.data.message || 'The Builder rejected the capture.')
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
      return false;
    }

    if (message.type === 'SLB_CAPTURE_PAGE') {
      captureAndSend(null).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'SLB_START_PICKER') {
      startPicker();
      sendResponse({ ok: true, message: 'Picker started. Click an element or press Escape to cancel.' });
      return false;
    }

    if (message.type === 'SLB_DELIVER_CAPTURE') {
      if (!isCaptureProtocol(message.capture)) {
        sendResponse({ ok: false, error: 'The Builder received an invalid capture.' });
        return false;
      }
      deliverCapture(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    return false;
  });
})();
