const fs = require('fs');
const path = require('path');

// Basic Google Calendar module
// In a production app, this would handle OAuth2
// For this assistant demo, we'll implement the structure and allow for an API Key/ID
class GoogleCalendar {
    constructor() {
        this.configPath = path.join(__dirname, '..', 'calendar-config.json');
        this.eventsPath = path.join(__dirname, '..', 'events.json');
        this.config = this.loadConfig();
    }

    loadConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } catch (e) { return {}; }
        }
        return { apiKey: '', calendarId: '', connected: false };
    }

    saveConfig(config) {
        this.config = { ...this.config, ...config };
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    }

    async getEvents() {
        // If not connected, return mocked "Connect Google Calendar" event or existing local events
        if (!this.config.connected || !this.config.apiKey) {
            return this.getLocalEvents();
        }

        try {
            // Real fetch from Google Calendar API
            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.config.calendarId)}/events?key=${this.config.apiKey}&timeMin=${new Date().toISOString()}&singleEvents=true&orderBy=startTime&maxResults=5`;
            const fetch = require('node-fetch');
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                console.error('GCAL Error:', data.error.message);
                return this.getLocalEvents();
            }

            return (data.items || []).map(item => ({
                title: item.summary,
                start: item.start.dateTime || item.start.date,
                time: item.start.dateTime ? new Date(item.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All Day',
                date: item.start.date || item.start.dateTime.split('T')[0],
                color: '#4285F4'
            }));
        } catch (e) {
            return this.getLocalEvents();
        }
    }

    getLocalEvents() {
        // Fallback or demonstration data
        try {
            if (fs.existsSync(this.eventsPath)) {
                return JSON.parse(fs.readFileSync(this.eventsPath, 'utf8'));
            }
        } catch (e) {}
        return [
            { title: "Connect Google Calendar", date: new Date().toISOString().split('T')[0], time: "Setup", color: "#4285F4" }
        ];
    }
}

module.exports = new GoogleCalendar();
