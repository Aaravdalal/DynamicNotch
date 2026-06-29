const { app, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let trayDir = '';

function initFileTray() {
  trayDir = path.join(app.getPath('userData'), 'file-tray');
  if (!fs.existsSync(trayDir)) {
    fs.mkdirSync(trayDir, { recursive: true });
  }

  ipcMain.handle('store-files', async (event, sourcePaths) => {
    const results = [];
    for (const src of sourcePaths) {
      try {
        const basename = path.basename(src);
        const dest = path.join(trayDir, basename);
        // Copy file or directory
        if (src !== dest) {
          fs.cpSync(src, dest, { recursive: true });
        }
        
        // Get icon
        let iconDataUrl = null;
        try {
          const nativeImg = await app.getFileIcon(dest, { size: 'normal' });
          iconDataUrl = nativeImg.toDataURL();
        } catch (e) {
          console.error('Could not get icon for', dest);
        }
        
        results.push({ name: basename, path: dest, icon: iconDataUrl });
      } catch (err) {
        console.error('Error copying file to tray:', err);
      }
    }
    return results;
  });

  ipcMain.handle('get-tray-files', async (event) => {
    if (!fs.existsSync(trayDir)) return [];
    
    const files = fs.readdirSync(trayDir);
    const results = [];
    
    for (const file of files) {
      const fullPath = path.join(trayDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() || stat.isDirectory()) {
        let iconDataUrl = null;
        try {
          const nativeImg = await app.getFileIcon(fullPath, { size: 'normal' });
          iconDataUrl = nativeImg.toDataURL();
        } catch (e) {
          console.error('Could not get icon for', fullPath);
        }
        results.push({ name: file, path: fullPath, icon: iconDataUrl, isDir: stat.isDirectory() });
      }
    }
    
    // Sort by modified time (newest first)
    return results;
  });

  ipcMain.handle('remove-tray-file', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
      return true;
    } catch (e) {
      console.error('Error removing file:', e);
      return false;
    }
  });

  // Handle dragging OUT of the electron app
  ipcMain.on('start-drag-out', (event, filePath) => {
    try {
      app.getFileIcon(filePath, { size: 'normal' }).then(icon => {
        event.sender.startDrag({
          file: filePath,
          icon: icon
        });
      }).catch(() => {
        // Fallback without icon if it fails
        const fallbackIcon = nativeImage.createEmpty();
        event.sender.startDrag({
          file: filePath,
          icon: fallbackIcon
        });
      });
    } catch (e) {
      console.error('Error starting drag:', e);
    }
  });

  ipcMain.handle('open-quickshare', () => {
    require('child_process').exec('"C:\\Program Files\\Google\\NearbyShare\\nearby_share.exe"');
  });

  ipcMain.handle('share-files', async (event, filePaths) => {
    if (!filePaths || filePaths.length === 0) return;
    const { exec } = require('child_process');
    
    console.log('[FileTray] Opening Quick Share for files:', filePaths);
    
    // Open Quick Share app
    exec('"C:\\Program Files\\Google\\NearbyShare\\nearby_share.exe"', (err) => {
      if (err) console.error('[FileTray] Error opening Quick Share:', err);
    });
    
    // Notify the renderer to show a toast
    event.sender.send('share-initiated', filePaths);
  });
}

module.exports = { initFileTray };
