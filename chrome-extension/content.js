// Inject a script into the main page to override the Notification API
const script = document.createElement('script');
script.textContent = `
  const OriginalNotification = window.Notification;
  
  if (OriginalNotification) {
    class CustomNotification extends OriginalNotification {
      constructor(title, options) {
        super(title, options);
        
        try {
          window.postMessage({
            type: 'FROM_PAGE_NOTIFICATION',
            title: title,
            body: options ? options.body : '',
            icon: options ? options.icon : ''
          }, '*');
        } catch(e) {}
      }
    }
    
    Object.assign(CustomNotification, OriginalNotification);
    window.Notification = CustomNotification;
  }
`;
document.documentElement.appendChild(script);
script.remove();

// Listen for intercepted notifications from the injected script
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  if (event.data.type === 'FROM_PAGE_NOTIFICATION') {
    chrome.runtime.sendMessage({
      type: 'incoming_message',
      app: window.location.hostname.includes('messages.google.com') ? 'google-messages' : 'gchat',
      sender: event.data.title,
      text: event.data.body,
      icon: event.data.icon
    });
  }
});

// ─────────────────────────────────────────────────────────────
// Outgoing replies
//
// Replies are typed into THIS tab because it is the one actually signed in.
// The notch long-polls its own local server for jobs; the server hands each
// job to exactly one poller, so multiple open tabs can't double-send.
// ─────────────────────────────────────────────────────────────
const NOTCH_API = 'http://127.0.0.1:8080';
const isMessages = window.location.hostname.includes('messages.google.com');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Wait for an element to exist, since opening a conversation re-renders async.
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
  const selectors = isMessages
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
  // Name the real control first — a text scan for "send" also matches the
  // "Send feedback" link, and that is what ends up being clicked.
  const usable = el => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
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
  return Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
    if (!usable(el)) return false;
    if (/feedback|help|schedule|attach|emoji|sticker|gif/.test(label)) return false;
    return label === 'send' || label === 'send message' || /^send (sms|rcs|message)\b/.test(label);
  });
}

// Open the thread for `sender` so the reply doesn't land in whichever
// conversation happens to be on screen.
async function openConversation(sender) {
  if (!sender) return;
  const needle = sender.trim().toLowerCase();
  if (!needle) return;

  const listSelectors = isMessages
    ? ['mws-conversation-list-item', '[data-testid="conversation-list-item"]', 'a[href^="/web/conversations/"]']
    : ['[role="listitem"]', '[role="treeitem"]'];

  let rows = [];
  for (const sel of listSelectors) {
    rows = Array.from(document.querySelectorAll(sel));
    if (rows.length) break;
  }

  const match = rows.find(el => (el.textContent || '').toLowerCase().includes(needle));
  if (!match) return; // Fall through and reply in the open thread.

  // Skip the click if this conversation is already open.
  if (match.getAttribute('aria-selected') === 'true') return;
  (match.querySelector('a, button, [role="button"]') || match).click();
  await waitFor(findComposer, 4000);
  await sleep(250);
}

function base64ToFile(attachment) {
  const binary = atob(attachment.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], attachment.name, { type: attachment.mime });
}

// Two routes in: the page's own file input (preferred — it's the same path the
// UI uses), otherwise a synthetic paste, which Messages accepts for images.
async function attachFile(composer, attachment) {
  const file = base64ToFile(attachment);
  const dt = new DataTransfer();
  dt.items.add(file);

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

  // Give the upload preview time to appear and enable the send button.
  await waitFor(findSendButton, 8000);
  await sleep(400);
}

async function deliverReply(job) {
  await openConversation(job.sender);

  const composer = await waitFor(findComposer, 5000);
  if (!composer) throw new Error('Could not find the message box');

  if (job.attachment) {
    await attachFile(composer, job.attachment);
  }

  if (job.text) {
    composer.focus();
    // execCommand goes through the browser's own editing path, so Angular sees
    // the change and enables Send — assigning .value directly does not.
    const inserted = document.execCommand('insertText', false, job.text);
    if (!inserted) {
      composer.textContent = job.text;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: job.text }));
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

  // Confirm it actually left: the composer empties once Messages accepts it.
  await sleep(600);
  const stillThere = (findComposer()?.value || findComposer()?.textContent || '').trim();
  if (job.text && stillThere === job.text.trim()) {
    throw new Error('Message box did not clear — send may have been rejected');
  }
}

async function pollOutbox() {
  for (;;) {
    try {
      const res = await fetch(NOTCH_API + '/outbox');
      const { items } = await res.json();
      for (const job of items || []) {
        let status = { id: job.id, ok: true };
        try {
          await deliverReply(job);
        } catch (e) {
          console.warn('[DynamicNotch] Reply failed:', e);
          status = { id: job.id, ok: false, error: e.message };
        }
        fetch(NOTCH_API + '/reply-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(status)
        }).catch(() => {});
      }
    } catch (e) {
      // Notch app isn't running — back off before trying again.
      await sleep(5000);
    }
  }
}

pollOutbox();


