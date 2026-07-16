const fs = require('fs');
const path = require('path');
const ical = require('node-ical');

class GoogleCalendar {
    constructor() {
        this.configPath = path.join(__dirname, '..', 'calendar-config.json');
        this.config = this.loadConfig();
    }

    loadConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } catch (e) { return {}; }
        }
        return { icalUrl: 'PASTE_YOUR_ICAL_LINK_HERE' };
    }

    saveConfig(config) {
        this.config = { ...this.config, ...config };
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    }

    async getEvents(targetDateStr) {
        if (!this.config.icalUrl || this.config.icalUrl === 'PASTE_YOUR_ICAL_LINK_HERE') {
            return [];
        }

        try {
            const events = await ical.async.fromURL(this.config.icalUrl);
            
            const target = targetDateStr ? new Date(targetDateStr) : new Date();
            const today = new Date(target.getFullYear(), target.getMonth(), target.getDate());
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            let dayEvents = [];

            for (let k in events) {
                if (events.hasOwnProperty(k)) {
                    let ev = events[k];
                    if (ev.type === 'VEVENT') {
                        let start = new Date(ev.start);
                        let end = new Date(ev.end);
                        if ((start >= today && start < tomorrow) || (start <= today && end > today)) {
                            dayEvents.push({
                                title: ev.summary,
                                start: start.toISOString(),
                                time: start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                color: '#4285F4'
                            });
                        }
                    }
                }
            }
            
            dayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
            
            if (dayEvents.length === 0) {
                return [{ title: "Nothing for today", time: "", color: "#5f6368" }];
            }
            return dayEvents;
        } catch (e) {
            console.error('[GoogleCalendar] Error:', e);
            return [{ title: "Failed to fetch iCal events", time: "Error", color: "#ea4335" }];
        }
    }
}

module.exports = new GoogleCalendar();
