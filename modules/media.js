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
        this.startMonitor();
    }

    startMonitor() {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'monitor-titles.ps1');
        this.monitorProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });

        this.monitorProc.stdout.on('data', (data) => {
            this.buffer += data.toString();
            const lines = this.buffer.split(/\r?\n/);
            this.buffer = lines.pop(); // Keep partial line in buffer

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
            console.error(`Monitor Error: ${data}`);
        });

        this.monitorProc.on('close', () => {
            setTimeout(() => this.startMonitor(), 5000); // restart if crashes
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
            if (lowTitle.includes(' - youtube')) {
                const part = item.title.split(' - YouTube')[0];
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
                const artUrl = await this.fetchArt(detected.artist, detected.track);
                this.lastMediaInfo = {
                    playing: true,
                    paused: false,
                    artist: detected.artist,
                    track: detected.track,
                    artUrl: artUrl.url,
                    duration: artUrl.duration,
                    source: detected.source
                };
                this.emit('update', this.lastMediaInfo);
            }
        } else if (this.lastMediaInfo.playing && !this.clearTimeout) {
            this.clearTimeout = setTimeout(() => {
                this.lastMediaInfo = { playing: false, paused: false, title: '', artist: '', track: '', artUrl: '', duration: 0, source: '' };
                this.emit('update', this.lastMediaInfo);
                this.clearTimeout = null;
            }, 5000);
        }
    }

    async fetchArt(artist, track) {
        const query = `${artist} ${track}`;
        if (this.cachedArt[query]) return this.cachedArt[query];
        try {
            const fetch = require('node-fetch');
            const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=1`;
            const res = await fetch(url);
            const json = await res.json();
            if (json.results && json.results.length > 0) {
                const url = json.results[0].artworkUrl100.replace('100x100', '300x300');
                const duration = json.results[0].trackTimeMillis || 0;
                const artInfo = { url, duration };
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

async function controlMedia(action) {
    const keyMap = { playpause: 'B3', next: 'B0', prev: 'B1' };
    const vk = keyMap[action];
    if (!vk) return;
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'media-key.ps1');
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -vk "${vk}"`, { windowsHide: true }, () => resolve());
    });
}

module.exports = { 
    getMediaInfo: () => monitor.getMediaInfo(), 
    controlMedia,
    onMediaUpdate: (cb) => {
        monitor.on('update', cb);
        // If already playing, emit the current state immediately to the new listener
        if (monitor.getMediaInfo().playing) {
            cb(monitor.getMediaInfo());
        }
    }
};
