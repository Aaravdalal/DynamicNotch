const { ipcRenderer } = require('electron');

// No page injection here — pairing QR breaks if we patch Notification/DOM on the auth page.
// Notification bridging is injected from main.js after pairing completes.

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'HIDDEN_NOTIFICATION') {
    ipcRenderer.send('hidden-live-message', {
      app: event.data.app,
      sender: event.data.sender,
      text: event.data.text,
      icon: event.data.icon
    });
  }
});

ipcRenderer.on('hidden-send-reply', (event, text) => {
  const input = document.querySelector('textarea');
  if (input) {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }, 100);
  }
});
