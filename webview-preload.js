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

ipcRenderer.on('hidden-send-reply', (event, text) => {
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

  if (window.location.hostname.includes('messages.google.com')) {
    // Select the most recent conversation in the sidebar first.
    const firstConv = document.querySelector('mws-conversation-list-item');
    if (firstConv) {
      const clickable = firstConv.querySelector('a, button, [role="button"]') || firstConv;
      clickable.click();
    }

    setTimeout(() => {
      const input = document.querySelector('textarea, mws-autosize-textarea');
      if (input) {
        input.focus();
        document.execCommand('insertText', false, text);
        // Let Angular/Polymer know the value changed so the send button enables.
        input.dispatchEvent(new Event('input', { bubbles: true }));
        triggerSend(input);
      }
    }, 400);
  } else if (window.location.hostname.includes('chat.google.com')) {
    const input = document.querySelector('div[contenteditable="true"]');
    if (input) {
      input.focus();
      document.execCommand('insertText', false, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      triggerSend(input);
    }
  }
});
