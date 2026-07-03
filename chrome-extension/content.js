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

// Handle incoming replies from the Notch
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'send_reply') {
    const text = request.text;
    
    if (window.location.hostname.includes('messages.google.com')) {
      // Google Messages uses a textarea
      const input = document.querySelector('textarea');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        setTimeout(() => {
          // Press Enter to send
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }, 100);
      }
    } else if (window.location.hostname.includes('chat.google.com')) {
      // Google Chat uses a contenteditable div
      const input = document.querySelector('div[contenteditable="true"]');
      if (input) {
        input.textContent = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        setTimeout(() => {
          // Press Enter to send
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
          input.dispatchEvent(enterEvent);
          const enterEventPress = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
          input.dispatchEvent(enterEventPress);
        }, 100);
      }
    }
  }
});
