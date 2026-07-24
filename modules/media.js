const { spawn, exec } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

const EMPTY_MEDIA = { playing: false, paused: false, title: '', artist: '', track: '', artUrl: '', duration: 0, durationMs: 0, positionMs: 0, posAt: 0, videoId: null, album: '', source: '' };

class MediaMonitor extends EventEmitter {
    constructor() {
        super();
        this.lastMediaInfo = { ...EMPTY_MEDIA };
        this.cachedArt = {};      // keyed by "artist track" for fetchArt
        this.artForKey = null;    // art of the currently-playing track
        this.lastKey = '';        // title|artist|source of the current track
        this.monitorProc = null;
        this.buffer = '';
        this.destroyed = false;
        this.clearTimeout = null;
        this.startMonitor();
    }

    destroy() {
        this.destroyed = true;
        if (this.monitorProc) {
            try { this.monitorProc.kill(); } catch (e) {}
            this.monitorProc = null;
        }
    }

    // Source of truth is now Windows' System Media Transport Controls (SMTC),
    // which reports the real track, play state, and — crucially — the true
    // position and duration. This replaces window-title scraping (which guessed
    // the song from any "X - Y" window) and the renderer's fake progress timer.
    startMonitor() {
        if (this.destroyed) return;
        const scriptPath = path.join(__dirname, '..', 'scripts', 'smtc-monitor.ps1');
        try {
            this.monitorProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
        } catch (e) {
            console.error('Failed to spawn SMTC monitor:', e.message);
            return;
        }

        this.monitorProc.stdout.on('data', (data) => {
            this.buffer += data.toString();
            const lines = this.buffer.split(/\r?\n/);
            this.buffer = lines.pop();
            for (const line of lines) {
                const s = line.trim();
                if (s.startsWith('SMTC|')) this.handleSmtc(s.substring(5));
            }
        });

        this.monitorProc.stderr.on('data', () => { /* WinRT warnings are noise */ });
        this.monitorProc.on('error', (err) => console.error('SMTC monitor error:', err.message));
        this.monitorProc.on('close', () => {
            if (!this.destroyed) setTimeout(() => this.startMonitor(), 5000);
        });
    }

    // Map SMTC's SourceAppUserModelId to the app's notion of a "source". Browser
    // sessions are treated as YouTube so the art/videoId scrape and the PiP star
    // keep working (the notch's video features are YouTube-only).
    deriveSource(appId) {
        const a = (appId || '').toLowerCase();
        if (a.includes('spotify')) return 'Spotify';
        if (/(chrome|msedge|edge|firefox|brave|opera|vivaldi)/.test(a)) return 'YouTube';
        if (a.includes('apple') || a.includes('music')) return 'Apple Music';
        return appId || 'Media';
    }

    // Debounced clear — a brief NONE (track change, tab switch) shouldn't blank
    // the notch instantly.
    scheduleClear() {
        if (!this.lastMediaInfo.playing && !this.lastMediaInfo.paused) return;
        if (this.clearTimeout) return;
        this.clearTimeout = setTimeout(() => {
            this.clearTimeout = null;
            this.lastKey = '';
            this.artForKey = null;
            this.lastMediaInfo = { ...EMPTY_MEDIA };
            this.emit('update', this.lastMediaInfo);
        }, 2500);
    }

    async handleSmtc(payload) {
        if (payload === 'NONE') { this.scheduleClear(); return; }

        let d;
        try { d = JSON.parse(payload); } catch (e) { return; }
        const status = d.status || '';
        const playing = status === 'Playing';
        const paused = status === 'Paused';

        // Stopped / Closed / no title → nothing to show.
        if ((!playing && !paused) || !d.title) { this.scheduleClear(); return; }

        if (this.clearTimeout) { clearTimeout(this.clearTimeout); this.clearTimeout = null; }

        const source = this.deriveSource(d.appId);
        const key = `${d.title}|${d.artist}|${source}`;
        const trackChanged = key !== this.lastKey;

        if (trackChanged) {
            this.lastKey = key;
            this.artForKey = null;
            this.artTries = 0;
        }
        // Fetch artwork (and, for YouTube, the videoId for PiP) WITHOUT blocking
        // the position stream, and retry on later ticks until it lands. The
        // YouTube scrape is flaky — one miss used to leave the whole song showing
        // the empty placeholder — so we re-attempt (bounded) whenever we still
        // have no URL. The art appears on a subsequent ~900ms emit.
        if ((!this.artForKey || !this.artForKey.url) && !this.artFetching && (this.artTries || 0) < 8) {
            this.artFetching = true;
            this.artTries = (this.artTries || 0) + 1;
            const keyAtFetch = key;
            const artQuery = source === 'YouTube'
                ? this.fetchArt('YouTube', d.title)
                : this.fetchArt(d.artist || source, d.title);
            Promise.race([artQuery, new Promise((res) => setTimeout(() => res(null), 7000))])
                .then((art) => { if (art && art.url && this.lastKey === keyAtFetch) this.artForKey = art; })
                .catch(() => {})
                .finally(() => { this.artFetching = false; });
        }
        const art = this.artForKey || { url: '', duration: 0, videoId: null, album: '', channelName: '' };

        // Prefer SMTC's real duration; fall back to the art provider's.
        const durationMs = d.durationMs > 0 ? d.durationMs : (art.duration || 0);
        const artUrl = art.url || '';

        this.lastMediaInfo = {
            playing,
            paused,
            title: d.title,
            track: d.title,
            artist: d.artist || art.channelName || source,
            artUrl,
            duration: durationMs,
            durationMs,
            positionMs: d.positionMs || 0,
            posAt: Date.now(),      // when positionMs was sampled, for renderer interpolation
            videoId: art.videoId || null,
            album: d.album || art.album || '',
            source
        };
        this.emit('update', this.lastMediaInfo);
    }

    async fetchArt(artist, track) {
        const query = `${artist} ${track}`;
        if (this.cachedArt[query]) return this.cachedArt[query];

        if (artist === 'YouTube') {
            try {
                const fetch = require('node-fetch');
                const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(track)}`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(searchUrl, { signal: controller.signal });
                clearTimeout(timeout);
                const html = await res.text();
                const match = html.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
                if (match && match[1]) {
                    const videoId = match[1];
                    const url = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                    
                    let durationMs = 0;
                    const lengthMatch = html.match(/"lengthText":\{[^}]*"simpleText":"([^"]+)"\}/);
                    if (lengthMatch && lengthMatch[1]) {
                        const parts = lengthMatch[1].split(':').map(Number);
                        if (parts.length === 2) durationMs = (parts[0] * 60 + parts[1]) * 1000;
                        else if (parts.length === 3) durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
                    }

                    let channelName = '';
                    const authorMatch = html.match(/"shortBylineText":\{"runs":\[\{"text":"([^"]+)"/);
                    if (authorMatch && authorMatch[1]) {
                        channelName = authorMatch[1];
                    }

                    const artInfo = { url, duration: durationMs, videoId, channelName };
                    this.cachedArt[query] = artInfo;
                    return artInfo;
                }
            } catch (e) {
                console.error('youtube scrape error:', e.message);
            }

            // Final YouTube fallback: try iTunes search with just the track name
            try {
                const fetch = require('node-fetch');
                const url = `https://itunes.apple.com/search?term=${encodeURIComponent(track)}&media=music&limit=1`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeout);
                const json = await res.json();
                if (json.results && json.results.length > 0) {
                    const artUrl = json.results[0].artworkUrl100.replace('100x100', '300x300');
                    const duration = json.results[0].trackTimeMillis || 0;
                    const album = json.results[0].collectionName || '';
                    const artInfo = { url: artUrl, duration, album };
                    this.cachedArt[query] = artInfo;
                    return artInfo;
                }
            } catch (e) {}

            // Absolute last resort: no art, but still return so the update fires
            return { url: '', duration: 0 };
        }

        // Non-YouTube (Spotify etc): use iTunes
        try {
            const fetch = require('node-fetch');
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=1`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            const json = await res.json();
            if (json.results && json.results.length > 0) {
                const artUrl = json.results[0].artworkUrl100.replace('100x100', '300x300');
                const duration = json.results[0].trackTimeMillis || 0;
                const album = json.results[0].collectionName || '';
                const artInfo = { url: artUrl, duration, album };
                this.cachedArt[query] = artInfo;
                return artInfo;
            }
        } catch (e) {}
        return { url: '', duration: 0 };
    }

    getMediaInfo() {
        return this.lastMediaInfo;
    }
}

const monitor = new MediaMonitor();

// Persistent SMTC control process. Global media keys (the old approach) went to
// whatever app had key focus and frequently controlled nothing; driving the
// GlobalSystemMediaTransportControls session directly targets the exact player
// we're displaying, so play/pause/next/prev/seek actually work. Kept warm so the
// WinRT session manager loads once and each command has minimal latency.
let ctrlPs = null;
function getCtrlPs() {
    if (ctrlPs) return ctrlPs;
    const scriptPath = path.join(__dirname, '..', 'scripts', 'media-control.ps1');
    ctrlPs = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    ctrlPs.stderr.on('data', () => { /* WinRT warnings are noise */ });
    ctrlPs.on('close', () => { ctrlPs = null; });
    ctrlPs.on('error', () => { ctrlPs = null; });
    return ctrlPs;
}

function sendCtrl(cmd) {
    try {
        getCtrlPs().stdin.write(cmd + '\n');
    } catch (e) {
        // Process died — drop the handle and try once more with a fresh one.
        ctrlPs = null;
        try { getCtrlPs().stdin.write(cmd + '\n'); } catch (e2) { console.error('controlMedia error:', e2.message); }
    }
}

function controlMedia(action) {
    if (['playpause', 'play', 'pause', 'next', 'prev'].includes(action)) sendCtrl(action);
}

// Seek the current SMTC session to positionMs. The scrubber updates optimistically
// and re-syncs to the real position on the next SMTC tick regardless.
function seekMedia(positionMs) {
    const ms = Math.max(0, Math.round(positionMs || 0));
    sendCtrl('seek ' + ms);
}

// Warm the control process at startup so the first play/pause / seek press isn't
// stalled behind PowerShell + WinRT cold start.
try { getCtrlPs(); } catch (e) {}

module.exports = {
    getMediaInfo: () => monitor.getMediaInfo(),
    controlMedia,
    seekMedia,
    destroyMediaMonitor: () => {
        monitor.destroy();
        if (ctrlPs) { try { ctrlPs.kill(); } catch (e) {} ctrlPs = null; }
    },
    onMediaUpdate: (cb) => {
        monitor.on('update', cb);
        // If already playing, emit the current state immediately to the new listener
        if (monitor.getMediaInfo().playing) {
            cb(monitor.getMediaInfo());
        }
    }
};
