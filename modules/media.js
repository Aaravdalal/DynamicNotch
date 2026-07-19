const { spawn, exec } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class MediaMonitor extends EventEmitter {
    constructor() {
        super();
        this.lastMediaInfo = { playing: false, paused: false, title: '', artist: '', track: '', artUrl: '', duration: 0, source: '' };
        this.cachedArt = {};
        this.monitorProc = null;
        this.buffer = '';
        this.destroyed = false;
        this.startMonitor();
    }

    destroy() {
        this.destroyed = true;
        if (this.monitorProc) {
            try { this.monitorProc.kill(); } catch (e) {}
            this.monitorProc = null;
        }
    }

    startMonitor() {
        if (this.destroyed) return;
        const scriptPath = path.join(__dirname, '..', 'scripts', 'monitor-titles.ps1');
        try {
            this.monitorProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
        } catch (e) {
            console.error('Failed to spawn monitor:', e.message);
            return;
        }

        this.monitorProc.stdout.on('data', (data) => {
            this.buffer += data.toString();
            const lines = this.buffer.split(/\r?\n/);
            this.buffer = lines.pop();

            const titles = [];
            for (let line of lines) {
                if (line.startsWith('UPDATE|')) {
                    const parts = line.split('|');
                    if (parts.length >= 3) {
                        titles.push({ proc: parts[1], title: parts[2] });
                    }
                }
            }
            if (titles.length > 0) {
                this.processTitles(titles);
            }
        });

        this.monitorProc.stderr.on('data', (data) => {
            // Suppress noisy errors
        });

        this.monitorProc.on('error', (err) => {
            console.error('Monitor process error:', err.message);
        });

        this.monitorProc.on('close', () => {
            if (!this.destroyed) {
                setTimeout(() => this.startMonitor(), 5000);
            }
        });
    }

    async processTitles(lines) {
        let detected = null;

        // First pass: Explicit Spotify/YouTube
        for (let item of lines) {
            const lowTitle = item.title.toLowerCase();
            const lowProc = item.proc.toLowerCase();

            if (lowProc === 'spotify' || lowTitle.includes('spotify')) {
                if (/^spotify(\s+(premium|free|ads))?$/i.test(item.title)) continue;
                
                let part = item.title;
                if (item.title.endsWith(' - Spotify')) part = item.title.substring(0, item.title.length - 10);
                
                const parts = part.split(' - ');
                if (parts.length >= 2) {
                    detected = { artist: parts[0].trim(), track: parts[1].trim(), source: 'Spotify' };
                } else {
                    detected = { artist: 'Spotify', track: part.trim(), source: 'Spotify' };
                }
                if (detected) break;
            }
            const ytIdx = lowTitle.indexOf(' - youtube');
            if (ytIdx !== -1) {
                let part = item.title.substring(0, ytIdx);
                part = part.replace(/^\(\d+\+?\)\s*/, '');
                detected = { artist: 'YouTube', track: part, source: 'YouTube' };
                break;
            }
        }

        // Second pass: General "Artist - Song"
        if (!detected) {
            for (let item of lines) {
                if (['explorer', 'taskmgr', 'settings', 'clock', 'antigravity', 'electron', 'chrome', 'msedge', 'firefox', 'brave'].includes(item.proc.toLowerCase())) continue;
                const parts = item.title.split(' - ');
                if (parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
                    detected = { artist: parts[0].trim(), track: parts[1].trim(), source: item.proc };
                    break;
                }
            }
        }

        if (detected) {
            if (this.clearTimeout) {
                clearTimeout(this.clearTimeout);
                this.clearTimeout = null;
            }
            const changed = detected.track !== this.lastMediaInfo.track || detected.artist !== this.lastMediaInfo.artist || !this.lastMediaInfo.playing;
            if (changed) {
                // Fetch art with a hard timeout — never let it block the update
                let artResult = { url: '', duration: 0 };
                try {
                    const artPromise = this.fetchArt(detected.artist, detected.track);
                    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ url: '', duration: 0 }), 5000));
                    artResult = await Promise.race([artPromise, timeoutPromise]);
                } catch (e) {
                    console.error('fetchArt error:', e.message);
                }
        this.lastMediaInfo = {
            playing: true,
            paused: false,
            artist: artResult.channelName || detected.artist,
            track: detected.track,
            artUrl: artResult.url,
            duration: artResult.duration,
            videoId: artResult.videoId || null,
            album: artResult.album || '',
            source: detected.source
        };
                this.emit('update', this.lastMediaInfo);
            }
        } else if (this.lastMediaInfo.playing && !this.clearTimeout) {
            this.clearTimeout = setTimeout(() => {
                this.lastMediaInfo = { playing: false, paused: false, title: '', artist: '', track: '', artUrl: '', duration: 0, album: '', source: '' };
                this.emit('update', this.lastMediaInfo);
                this.clearTimeout = null;
            }, 5000);
        }
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

let mediaPs = null;
function getMediaPs() {
    if (!mediaPs) {
        mediaPs = spawn('powershell', ['-NoProfile', '-Command', '-'], { windowsHide: true });
        mediaPs.stdin.write(`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);}'\n`);
    }
    return mediaPs;
}

async function controlMedia(action) {
    const keyMap = { playpause: 'B3', next: 'B0', prev: 'B1' };
    const vk = keyMap[action];
    if (!vk) return;
    const ps = getMediaPs();
    ps.stdin.write(`$key=[Convert]::ToByte('${vk}',16); [K]::keybd_event($key, 0, 1, [UIntPtr]::Zero); Start-Sleep -Milliseconds 50; [K]::keybd_event($key, 0, 3, [UIntPtr]::Zero);\n`);
}

module.exports = { 
    getMediaInfo: () => monitor.getMediaInfo(), 
    controlMedia,
    destroyMediaMonitor: () => monitor.destroy(),
    onMediaUpdate: (cb) => {
        monitor.on('update', cb);
        // If already playing, emit the current state immediately to the new listener
        if (monitor.getMediaInfo().playing) {
            cb(monitor.getMediaInfo());
        }
    }
};
