const fs = require('fs');
let c = fs.readFileSync('renderer/app.js', 'utf8');

const newFn = \
  let isLocalPaused = false;
  function handleMediaAction(action, e) {
    if (e) e.stopPropagation();
    if (typeof mediaData !== 'undefined' && mediaData && mediaData.source === 'YouTube') {
      const mainYtIframe = document.getElementById('mainYtIframe');
      if (mainYtIframe && mainYtIframe.contentWindow) {
        if (action === 'playpause') {
          isLocalPaused = !isLocalPaused;
          const func = isLocalPaused ? 'pauseVideo' : 'playVideo';
          mainYtIframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: func}), '*');
        } else if (action === 'next') {
          mainYtIframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'nextVideo'}), '*');
        } else if (action === 'prev') {
          mainYtIframe.contentWindow.postMessage(JSON.stringify({event: 'command', func: 'previousVideo'}), '*');
        }
      }
    } else {
      window.notchAPI.controlMedia(action);
      if (action === 'playpause') isLocalPaused = !isLocalPaused;
    }
    
    if (action === 'playpause') {
      if (typeof mediaData !== 'undefined' && mediaData) mediaData.paused = isLocalPaused;
      const playSvg = document.querySelector('#playBtn svg');
      const dashPlayBtnSvg = document.querySelector('#dashPlayBtn svg');
      const btmuPlaySvg = document.querySelector('#btmuPlayBtn svg');
      if (isLocalPaused) {
        if(typeof stopVisualizer === 'function') stopVisualizer();
        if (playSvg) playSvg.innerHTML = '<path d=\"M8 5v14l11-7z\"/>';
        if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d=\"M8 5v14l11-7z\"/>';
        if (btmuPlaySvg) btmuPlaySvg.innerHTML = '<path d=\"M8 5v14l11-7z\"/>';
      } else {
        if(typeof startVisualizer === 'function') startVisualizer();
        if (playSvg) playSvg.innerHTML = '<path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/>';
        if (dashPlayBtnSvg) dashPlayBtnSvg.innerHTML = '<path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/>';
        if (btmuPlaySvg) btmuPlaySvg.innerHTML = '<path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/>';
      }
    }
  }
\;

c = c.replace(/const deb = \\\(fn, ms\\\) => \{[^\}]+\};/g, \"const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };\\n\" + newFn);

c = c.replace(/document\\.getElementById\\('prevBtn'\\)\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('prev'\\); \}\\);/g, \"document.getElementById('prevBtn').addEventListener('click', e => handleMediaAction('prev', e));\");
c = c.replace(/document\\.getElementById\\('playBtn'\\)\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('playpause'\\); \}\\);/g, \"document.getElementById('playBtn').addEventListener('click', e => handleMediaAction('playpause', e));\");
c = c.replace(/document\\.getElementById\\('nextBtn'\\)\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('next'\\); \}\\);/g, \"document.getElementById('nextBtn').addEventListener('click', e => handleMediaAction('next', e));\");

c = c.replace(/document\\.getElementById\\('btmuPrevBtn'\\)\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('prev'\\); \}\\);/g, \"document.getElementById('btmuPrevBtn').addEventListener('click', e => handleMediaAction('prev', e));\");
c = c.replace(/document\\.getElementById\\('btmuPlayBtn'\\)\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('playpause'\\); \}\\);/g, \"document.getElementById('btmuPlayBtn').addEventListener('click', e => handleMediaAction('playpause', e));\");
c = c.replace(/document\\.getElementById\\('btmuNextBtn'\\)\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('next'\\); \}\\);/g, \"document.getElementById('btmuNextBtn').addEventListener('click', e => handleMediaAction('next', e));\");

c = c.replace(/if\\(dPrev\\) dPrev\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('prev'\\); \}\\);/g, \"if(dPrev) dPrev.addEventListener('click', e => handleMediaAction('prev', e));\");
c = c.replace(/if\\(dPlay\\) dPlay\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('playpause'\\); \}\\);/g, \"if(dPlay) dPlay.addEventListener('click', e => handleMediaAction('playpause', e));\");
c = c.replace(/if\\(dNext\\) dNext\\.addEventListener\\('click', e => \{ e\\.stopPropagation\\(\\); window\\.notchAPI\\.controlMedia\\('next'\\); \}\\);/g, \"if(dNext) dNext.addEventListener('click', e => handleMediaAction('next', e));\");

fs.writeFileSync('renderer/app.js', c);
