// Receive messages from content script and forward to Local API via HTTP POST
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'incoming_message') {
    fetch('http://127.0.0.1:8080/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: request.sender,
        text: request.text,
        app: request.app,
        time: 'now'

      })
    }).catch(err => console.error('Failed to forward message:', err));
  }
});

