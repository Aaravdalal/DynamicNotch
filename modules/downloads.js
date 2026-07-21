const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let watcher = null;
let activeDownloads = new Set();
let downloadTimer = null;

function startDownloadsMonitor(callback) {
  const downloadsPath = app.getPath('downloads');

  if (fs.existsSync(downloadsPath)) {
    try {
      watcher = fs.watch(downloadsPath, (eventType, filename) => {
        if (!filename) return;

        const isTemp = filename.endsWith('.crdownload') || filename.endsWith('.part') || filename.endsWith('.opdownload');

        if (isTemp) {
          if (!activeDownloads.has(filename)) {
            activeDownloads.add(filename);
            const cleanName = filename.replace(/\.(crdownload|part|opdownload)$/, '');
            // External (browser) downloads expose no reliable total size, so we
            // can't compute a real percentage. Send percent: null and let the
            // notch show an honest indeterminate spinner rather than a faked
            // fill that doesn't track actual progress.
            callback({ state: 'downloading', filename: cleanName, percent: null });
          }
        } else {
          if (activeDownloads.size > 0) {
            clearTimeout(downloadTimer);
            downloadTimer = setTimeout(() => {
              let completedAny = false;
              for (const tempFile of activeDownloads) {
                const fullPath = path.join(downloadsPath, tempFile);
                if (!fs.existsSync(fullPath)) {
                  activeDownloads.delete(tempFile);
                  completedAny = true;
                }
              }
              if (completedAny) {
                callback({ state: 'complete', filename: filename });
              }
            }, 500);
          }
        }
      });
    } catch (e) {
      console.error('Error watching downloads folder:', e);
    }
  }

  // Track Electron app internal downloads — these give us exact byte counts.
  app.whenReady().then(() => {
    const { session } = require('electron');
    session.defaultSession.on('will-download', (event, item, webContents) => {
      const name = item.getFilename();
      callback({ state: 'downloading', filename: name, percent: 0 });

      item.on('updated', (event, state) => {
        if (state === 'progressing') {
          const total = item.getTotalBytes();
          const received = item.getReceivedBytes();
          const percent = total > 0 ? (received / total) * 100 : null;
          callback({ state: 'downloading', filename: name, percent });
        }
      });
      item.once('done', (event, state) => {
        if (state === 'completed') {
          callback({ state: 'complete', filename: name });
        }
      });
    });
  });
}

module.exports = { startDownloadsMonitor };
