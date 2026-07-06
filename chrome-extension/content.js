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


