const { exec } = require('child_process');
const path = require('path');

let cachedTitle = '';
let lastPlayingResult = null;
let lastFetchTime = 0;
let cachedArtUrl = '';
let lastArtQuery = '';
const MIN_INTERVAL = 2000;

function execAsync(cmd, timeout = 5000) {
  return new Promise((resolve) => {
    const proc = exec(cmd, { encoding: 'utf-8', timeout, windowsHide: true }, (err, stdout) => {
      if (err) resolve('');
      else resolve((stdout || '').trim());
    });
  });
}

function fetchArt(artist, track) {
  const query = `${artist} ${track}`;
  if (query === lastArtQuery) return; // Don't re-fetch same song
  lastArtQuery = query;

  try {
    const https = require('https');
    const encoded = encodeURIComponent(query);
    const url = `https://itunes.apple.com/search?term=${encoded}&media=music&limit=1`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.results && json.results.length > 0 && json.results[0].artworkUrl100) {
            cachedArtUrl = json.results[0].artworkUrl100.replace('100x100', '300x300');
          }
        } catch (e) {}
      });
    }).on('error', () => {});
  } catch (e) {}
}

async function getSpotifyInfo() {
  const now = Date.now();
  if (now - lastFetchTime < MIN_INTERVAL) return makeResult(cachedTitle);
  lastFetchTime = now;

  try {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'get-spotify-title.ps1');
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    const title = await execAsync(cmd);

    const prev = cachedTitle;
    cachedTitle = title;
    const result = makeResult(title);

    if (result.playing && title !== prev && result.artist && result.track) {
      fetchArt(result.artist, result.track);
    }
    return result;
  } catch (e) {
    return { playing: false, title: '', artist: '', track: '', artUrl: '' };
  }
}

function makeResult(title) {
  if (title === '') {
    // Spotify is closed completely. Let it disappear.
    lastPlayingResult = null;
    return { playing: false, paused: false, title: '', artist: '', track: '', artUrl: '' };
  }

  if (/^Spotify(\s+(Premium|Free))?$/i.test(title)) {
    // Spotify is open but paused
    if (lastPlayingResult) {
       return { ...lastPlayingResult, playing: false, paused: true };
    }
    return { playing: false, paused: false, title: '', artist: '', track: '', artUrl: '' };
  }
  const dashIdx = title.indexOf(' - ');
  let res;
  if (dashIdx > 0) {
    res = {
      playing: true,
      paused: false,
      artist: title.substring(0, dashIdx).trim(),
      track: title.substring(dashIdx + 3).trim(),
      title,
      artUrl: cachedArtUrl,
    };
  } else {
    res = { playing: true, paused: false, title, artist: '', track: title, artUrl: cachedArtUrl };
  }
  lastPlayingResult = res;
  return res;
}

async function controlSpotify(action) {
  const keyMap = { playpause: 'B3', next: 'B0', prev: 'B1' };
  const vk = keyMap[action];
  if (!vk) return;
  const scriptPath = path.join(__dirname, '..', 'scripts', 'media-key.ps1');
  await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -vk "${vk}"`, 5000);
}

module.exports = { getSpotifyInfo, controlSpotify };
