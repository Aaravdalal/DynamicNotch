let ws = null;
let reconnectTimer = null;

function connect() {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;
  
  ws = new WebSocket('ws://localhost:3232');
  
  ws.onopen = () => {
    console.log('Connected to Dynamic Notch');
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'send_reply') {
        // Send reply to matching tabs
        chrome.tabs.query({url: ["*://messages.google.com/*", "*://chat.google.com/*"]}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, data);
          });
        });
      }
    } catch(e) {}
  };
  
  ws.onclose = () => {
    console.log('Disconnected from Dynamic Notch. Reconnecting in 5s...');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5000);
  };
  
  ws.onerror = () => {
    ws.close();
  };
}

connect();

// Receive messages from content script and forward to WebSocket
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'incoming_message') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(request));
    }
  }
});
