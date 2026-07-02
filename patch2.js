const fs = require('fs');
let c = fs.readFileSync('renderer/app.js', 'utf8');

const injection = \
  const setupYtWebview = (webview) => {
    if (!webview) return;
    webview.addEventListener('dom-ready', () => {
      webview.insertCSS(\\\
        ytd-masthead, #masthead-container, #secondary, #comments, #below, ytd-engagement-panel-section-list-renderer, #related, .ytp-chrome-top, ytd-consent-bump-v2-lightbox, tp-yt-iron-overlay-backdrop { display: none !important; }
        ytd-app, #page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner, #player {
            padding: 0 !important; margin: 0 !important; max-width: none !important; min-width: 0 !important; width: 100vw !important; height: 100vh !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 99999 !important; background: black !important;
        }
        .html5-video-player { width: 100vw !important; height: 100vh !important; }
        ::-webkit-scrollbar { display: none !important; }
      \\\);
      webview.executeJavaScript(\\\
        setInterval(() => {
          const btn1 = document.querySelector('button[aria-label="Accept all"]');
          const btn2 = document.querySelector('button[aria-label="Accept the use of cookies and other data for the purposes described"]');
          const btn3 = document.querySelector('button[aria-label="Reject all"]');
          if (btn1) btn1.click();
          if (btn2) btn2.click();
          if (btn3) btn3.click();
          const v = document.querySelector("video");
          if(v && v.paused && !v.ended) { v.play(); }
        }, 1000);
      \\\);
    });
  };
  setupYtWebview(document.getElementById('dashYtIframe'));
  setupYtWebview(document.getElementById('mainYtIframe'));

  const dashArtContainer = document.getElementById('dashArtContainer');
  if (dashArtContainer) {
    dashArtContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaData && mediaData.videoId) {
        const iframe = document.getElementById('dashYtIframe');
        const overlay = document.getElementById('ytPlayOverlay');
        if (iframe && overlay) {
          overlay.style.display = 'none';
          iframe.style.display = 'block';
          if (!iframe.src || !iframe.src.includes(mediaData.videoId)) {
            iframe.src = \\\https://www.youtube.com/watch?v=\\\\\\;
          }
        }
      }
    });
  }
\;

c = c.replace('  window.notchAPI.onAudioPeak((peak) => {', injection + '\n  window.notchAPI.onAudioPeak((peak) => {');

fs.writeFileSync('renderer/app.js', c);
