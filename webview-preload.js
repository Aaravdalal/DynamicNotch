const { ipcRenderer } = require('electron');

// NOTE: We do NOT inject any script tags here because Google Messages
// enforces Trusted Types CSP which blocks script.textContent assignment.
//
// Instead, the Notification interceptor is injected via
// webContents.executeJavaScript() in main.js, which bypasses CSP entirely.
//
// This preload only listens for postMessage events from the injected code
// and forwards them to the main process via IPC.

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.type === '__DYNAMIC_NOTCH_MSG__') {
    const appName = window.location.hostname.includes('messages.google.com')
      ? 'google-messages'
      : 'gchat';

    ipcRenderer.send('hidden-live-message', {
      app: appName,
      sender: event.data.title,
      text: event.data.body,
      time: 'now',
      avatar: event.data.icon
    });
  }
});

// ─── Outgoing replies ───
// This window is the one signed into Google Messages, so replies are typed
// here. Every attempt reports back a real result; main must never have to
// infer success from the page URL.
//
// EVERYTHING below stays inside this IIFE. contextIsolation is off for this
// window, so preload top-level declarations share a global scope with the page
// — leaking names like `sleep` or `waitFor` collides with Google's own scripts
// and blanks the pairing QR.
(function () {
const isMessages = () => window.location.hostname.includes('messages.google.com');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(finder, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = finder();
    if (el) return el;
    await sleep(120);
  }
  return null;
}

function findComposer() {
  const selectors = isMessages()
    ? ['mws-autosize-textarea textarea', 'textarea[aria-label*="message" i]', 'textarea',
       '[contenteditable="true"][aria-label*="message" i]']
    : ['div[contenteditable="true"][aria-label*="message" i]', 'div[contenteditable="true"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const usable = el => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';

function findSendButton() {
  // Ask for the real control by name first. A blind text scan for "send" also
  // matches the "Send feedback" link Google puts on these pages, and since
  // .find() returns whichever comes first in the DOM, that is what got clicked
  // — the text sat in the composer showing "typing…" and never went anywhere.
  const exact = [
    'mws-message-send-button button',
    'button[data-e2e-send-button]',
    'button[aria-label*="Send message" i]',
    'button[aria-label*="Send SMS" i]',
    'button[aria-label*="Send RCS" i]',
  ];
  for (const sel of exact) {
    const el = document.querySelector(sel);
    if (usable(el)) return el;
  }

  // Fallback: the label must BE "send"/"send message", never merely contain it.
  return Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
    if (!usable(el)) return false;
    if (/feedback|help|schedule|attach|emoji|sticker|gif/.test(label)) return false;
    return label === 'send' || label === 'send message' || /^send (sms|rcs|message)\b/.test(label);
  });
}

async function openConversation(sender) {
  if (!sender) return;
  const needle = sender.trim().toLowerCase();
  if (!needle) return;

  // Conversation list markup has changed across Google Messages releases,
  // so try several selectors rather than one hard-coded tag.
  const listSelectors = isMessages()
    ? ['mws-conversation-list-item', '[data-testid="conversation-list-item"]', 'a[href^="/web/conversations/"]']
    : ['[role="listitem"]', '[role="treeitem"]'];

  let rows = [];
  for (const sel of listSelectors) {
    rows = Array.from(document.querySelectorAll(sel));
    if (rows.length) break;
  }

  const match = rows.find(el => (el.textContent || '').toLowerCase().includes(needle));
  if (!match) return; // Fall through and reply in whatever thread is open.
  if (match.getAttribute('aria-selected') === 'true') return;

  (match.querySelector('a, button, [role="button"]') || match).click();
  await waitFor(findComposer, 4000);
  await sleep(250);
}

async function attachFile(composer, attachment) {
  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], attachment.name, { type: attachment.mime });

  const dt = new DataTransfer();
  dt.items.add(file);

  // Prefer the page's own file input — same path its UI uses. Otherwise
  // synthesise a paste, which Messages accepts for images.
  const fileInput = document.querySelector('input[type="file"]');
  if (fileInput) {
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    if (composer) composer.focus();
    (composer || document.body).dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true
    }));
  }

  await waitFor(findSendButton, 8000); // upload preview must render first
  await sleep(400);
}

async function deliverReply(job) {
  await openConversation(job.sender);

  const composer = await waitFor(findComposer, 5000);
  if (!composer) throw new Error('Could not find the message box');

  if (job.attachment) await attachFile(composer, job.attachment);

  if (job.text) {
    composer.focus();
    // execCommand routes through the browser's own editing path, so Angular
    // registers the change and enables Send; assigning .value does not.
    let ok = false;
    try { ok = document.execCommand('insertText', false, job.text); } catch (e) {}

    const current = () => (composer.value != null ? composer.value : composer.textContent) || '';
    if (!ok || current().trim() !== job.text.trim()) {
      // execCommand can silently no-op. Go through the element's native value
      // setter instead — Angular's own listener sits on the resulting `input`
      // event, so this still updates the model (plain `.value =` does not).
      const proto = composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : (composer instanceof HTMLInputElement ? HTMLInputElement.prototype : null);
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(composer, job.text);
      else composer.textContent = job.text;
    }

    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertText', data: job.text
    }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
  }

  // Read back the box we actually typed into. Re-querying found a different
  // (or missing) element once the page shifted, which read as empty and let a
  // failed send report success.
  const stillPending = () => {
    const el = document.contains(composer) ? composer : findComposer();
    const text = ((el && (el.value != null ? el.value : el.textContent)) || '').trim();
    return job.text ? text === job.text.trim() : false;
  };

  const pressEnter = () => {
    composer.focus();
    ['keydown', 'keypress', 'keyup'].forEach(type => {
      composer.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
    });
  };

  const sendBtn = await waitFor(findSendButton, 4000);
  if (sendBtn) sendBtn.click(); else pressEnter();

  // The composer clears once Messages accepts the message.
  await sleep(700);
  if (stillPending()) pressEnter();

  // Still there: the page is refusing our synthetic events, which carry
  // isTrusted:false. Ask main to inject REAL Chromium input — a click on the
  // Send button's own coordinates, then Enter.
  await sleep(600);
  if (stillPending() && sendBtn && document.contains(sendBtn)) {
    const r = sendBtn.getBoundingClientRect();
    if (r.width && r.height) {
      ipcRenderer.send('hidden-trusted-click', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      await sleep(900);
    }
  }
  if (stillPending()) {
    composer.focus();
    ipcRenderer.send('hidden-trusted-enter');
    await sleep(900);
  }
  if (stillPending()) {
    // Report what the page actually looked like. "Did not accept it" alone
    // can't distinguish a disabled Send button from no conversation being
    // open from the text never reaching Angular's model.
    const anySend = document.querySelector('mws-message-send-button button, button[data-e2e-send-button], button[aria-label*="Send" i]');
    const openThread = document.querySelector('mws-message-wrapper, [data-e2e-conversation-container], mws-messages-list');
    const details = [
      'path=' + location.pathname,
      'composer=' + composer.tagName.toLowerCase() + '/' + (composer.getAttribute('aria-label') || '?').slice(0, 24),
      'clickedEnabledSend=' + !!sendBtn,
      'triedTrustedInput=yes',
      'sendBtnInDom=' + !!anySend,
      'sendBtnDisabled=' + (anySend ? String(anySend.disabled || anySend.getAttribute('aria-disabled') || false) : 'n/a'),
      'threadOpen=' + !!openThread,
    ].join(' ');
    throw new Error('Message stayed in the box [' + details + ']');
  }
}

ipcRenderer.on('hidden-send-reply', async (event, payload) => {
  const job = typeof payload === 'string' ? { text: payload } : (payload || {});
  if (!job.text && !job.attachment) return;
  try {
    await deliverReply(job);
    ipcRenderer.send('hidden-reply-result', { id: job.id, ok: true });
  } catch (e) {
    console.warn('[DynamicNotch] Reply failed:', e);
    ipcRenderer.send('hidden-reply-result', { id: job.id, ok: false, error: e.message });
  }
});
})();
