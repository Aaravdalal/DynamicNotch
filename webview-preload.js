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

ipcRenderer.on('hidden-send-reply', (event, payload) => {
  const data = typeof payload === 'string' ? { text: payload } : (payload || {});
  const text = data.text || '';
  const sender = (data.sender || '').trim().toLowerCase();
  if (!text) return; // Attachment-only replies aren't wired up yet.

  // Find a clickable "send" control across buttons and role=button elements.
  const findSendBtn = () => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    return candidates.find(el => {
      const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
      return label.includes('send') &&
             !label.includes('schedule') &&
             !label.includes('attach') &&
             !label.includes('attachment') &&
             !el.disabled;
    });
  };

  const triggerSend = (inputEl) => {
    // Give the framework time to register the inserted text and enable send.
    setTimeout(() => {
      const sendBtn = findSendBtn();
      if (sendBtn) {
        sendBtn.click();
      } else if (inputEl) {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }
    }, 350);
  };

  const insertAndSend = (input) => {
    if (!input) {
      console.warn('[DynamicNotch] No reply input field found on', window.location.hostname);
      return;
    }
    input.focus();
    document.execCommand('insertText', false, text);
    // Let Angular/Polymer/React know the value changed so the send button enables.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    triggerSend(input);
  };

  if (window.location.hostname.includes('messages.google.com')) {
    // Conversation list markup has changed across Google Messages
    // releases, so try several selectors rather than one hard-coded tag.
    const convSelectors = [
      'mws-conversation-list-item',
      'mws-conversation-list-item-content',
      '[data-testid="conversation-list-item"]',
      'a[href^="/web/conversations/"]'
    ];
    let convs = [];
    for (const sel of convSelectors) {
      convs = Array.from(document.querySelectorAll(sel));
      if (convs.length) break;
    }

    let target = convs[0]; // Fall back to the most recent conversation.
    if (sender && convs.length > 1) {
      const match = convs.find(el => (el.textContent || '').toLowerCase().includes(sender));
      if (match) target = match;
    }

    if (target) {
      const clickable = target.querySelector('a, button, [role="button"]') || target;
      clickable.click();
    }

    setTimeout(() => {
      const input = document.querySelector('textarea, mws-autosize-textarea textarea, mws-autosize-textarea, [contenteditable="true"][aria-label*="message" i]');
      insertAndSend(input);
    }, 400);
  } else if (window.location.hostname.includes('chat.google.com')) {
    // If we know who this is from, try to open their DM/space first.
    if (sender) {
      const rows = Array.from(document.querySelectorAll('[role="listitem"], [role="treeitem"]'));
      const match = rows.find(el => (el.textContent || '').toLowerCase().includes(sender));
      if (match) match.click();
    }

    setTimeout(() => {
      const input = document.querySelector('div[contenteditable="true"][aria-label*="message" i], div[contenteditable="true"]');
      insertAndSend(input);
    }, sender ? 400 : 0);
  }
});
