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

function findSendButton() {
  return Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
    const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
    return label.includes('send') && !label.includes('schedule') &&
           !label.includes('attach') && !el.disabled &&
           el.getAttribute('aria-disabled') !== 'true';
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
    if (!document.execCommand('insertText', false, job.text)) {
      composer.textContent = job.text;
    }
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
  }

  const sendBtn = await waitFor(findSendButton, 4000);
  if (sendBtn) {
    sendBtn.click();
  } else {
    ['keydown', 'keypress', 'keyup'].forEach(type => {
      composer.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
    });
  }

  // Confirm it left: the composer clears once Messages accepts the message.
  await sleep(600);
  const after = findComposer();
  const leftover = ((after && (after.value || after.textContent)) || '').trim();
  if (job.text && leftover === job.text.trim()) {
    throw new Error('Message box did not clear — send was rejected');
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
