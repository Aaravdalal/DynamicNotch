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
  if (window.location.hostname.includes('messages.google.com')) {
    
    // Attempt to select the most recent conversation in the sidebar first
    const firstConv = document.querySelector('mws-conversation-list-item');
    if (firstConv) {
      // Find the clickable element inside it
      const clickable = firstConv.querySelector('a, button, [role="button"]') || firstConv;
      clickable.click();
    }
    
    setTimeout(() => {
      const input = document.querySelector('textarea, mws-autosize-textarea');
      if (input) {
        input.focus();
        document.execCommand('insertText', false, text);
        
        setTimeout(() => {
          const sendBtns = Array.from(document.querySelectorAll('button'));
          const sendBtn = sendBtns.find(b => {
             const label = (b.getAttribute('aria-label') || '').toLowerCase();
             return label.includes('send') && !label.includes('schedule');
          });
          if (sendBtn) {
            sendBtn.click();
          } else {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          }
        }, 150);
      }
    }, 400); // Wait 400ms for the conversation view to render after clicking
    
  } else if (window.location.hostname.includes('chat.google.com')) {
    const input = document.querySelector('div[contenteditable="true"]');
    if (input) {
      input.focus();
      document.execCommand('insertText', false, text);
      
      setTimeout(() => {
        const sendBtn = document.querySelector('[aria-label="Send message"]');
        if (sendBtn) {
          sendBtn.click();
        } else {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
      }, 150);
    }
  }
});
