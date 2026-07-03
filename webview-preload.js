const { ipcRenderer, webFrame } = require('electron');

// 1. Inject script into main world to intercept Notifications and spoof permissions
webFrame.executeJavaScript(`
  const OriginalNotification = window.Notification;
  if (OriginalNotification) {
    class CustomNotification {
      constructor(title, options) {
        try {
          window.postMessage({
            type: 'HIDDEN_NOTIFICATION',
            app: window.location.hostname.includes('messages.google.com') ? 'google-messages' : 'gchat',
            sender: title,
            text: options ? options.body : '',
            icon: options ? options.icon : ''
          }, '*');
        } catch(e) {}
      }
      static get permission() { return 'granted'; }
      static requestPermission() { return Promise.resolve('granted'); }
      close() {}
    }
    window.Notification = CustomNotification;
  }

  // Spoof navigator.permissions.query for notifications
  if (navigator.permissions && navigator.permissions.query) {
    const originalQuery = navigator.permissions.query;
    navigator.permissions.query = function(descriptor) {
      if (descriptor && descriptor.name === 'notifications') {
        const fakeStatus = document.createElement('div');
        fakeStatus.state = 'granted';
        fakeStatus.status = 'granted';
        fakeStatus.onchange = null;
        return Promise.resolve(fakeStatus);
      }
      return originalQuery.call(navigator.permissions, descriptor);
    };
  }

  // Spoof visibility so the web app thinks it is always open and focused!
  // This forces it to use WebSockets and new Notification() instead of background Push ServiceWorkers
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { get: () => false });
  
  window.addEventListener('blur', (e) => {
    e.stopImmediatePropagation();
  }, true);


  if (window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype.showNotification) {
    window.ServiceWorkerRegistration.prototype.showNotification = function(title, options) {
      try {
        window.postMessage({
          type: 'HIDDEN_NOTIFICATION',
          app: window.location.hostname.includes('messages.google.com') ? 'google-messages' : 'gchat',
          sender: title,
          text: options ? options.body : '',
          icon: options ? options.icon : ''
        }, '*');
      } catch(e) {}
      return Promise.resolve();
    };
  }

  // Mock the Service Worker completely so Google Messages doesn't register a real one.
  // This forces the Window context to call our mock showNotification when a WebSocket message arrives!
  if (navigator.serviceWorker) {
    // navigator.serviceWorker mock removed. We will rely on window.Notification mock.
  }
`);

// 2. Listen for the intercepted notification from the page
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'HIDDEN_NOTIFICATION') {
    console.log('[DEBUG] Preload caught notification, forwarding to main...');
    ipcRenderer.send('hidden-live-message', {
      app: event.data.app,
      sender: event.data.sender,
      text: event.data.text,
      icon: event.data.icon
    });
  }
});

// 3. Handle replies from the Notch
ipcRenderer.on('hidden-send-reply', (event, text) => {
  if (window.location.hostname.includes('messages.google.com')) {
    const input = document.querySelector('textarea');
    if (input) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }, 100);
    }
  } else if (window.location.hostname.includes('chat.google.com')) {
    const input = document.querySelector('div[contenteditable="true"]');
    if (input) {
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }, 100);
    }
  }
});
