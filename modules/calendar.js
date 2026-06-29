const ical = require('node-ical');
const fs = require('fs');
const path = require('path');

// To let the user easily configure their iCal link without modifying code:
const CONFIG_PATH = path.join(__dirname, '..', 'calendar_config.json');

let iCalUrl = '';

// Helper to save/load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      iCalUrl = data.icalUrl || '';
    } else {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ icalUrl: "PASTE_YOUR_ICAL_LINK_HERE" }, null, 2));
    }
  } catch (err) {
    console.error('[Calendar Module] Error loading config:', err);
  }
}

async function fetchEventsForToday(targetDate = null) {
  loadConfig();
  if (!iCalUrl || iCalUrl === 'PASTE_YOUR_ICAL_LINK_HERE') {
    return { error: 'Please add your Google Calendar iCal link to calendar_config.json' };
  }

  try {
    const events = await ical.async.fromURL(iCalUrl);
    
    // We get events for 'targetDate' (which corresponds to the notch's calendarOffset)
    const target = targetDate ? new Date(targetDate) : new Date();
    target.setHours(0,0,0,0);
    const tomorrow = new Date(target);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayEvents = [];

    for (let k in events) {
      if (events.hasOwnProperty(k)) {
        let ev = events[k];
        if (ev.type === 'VEVENT') {
          let start = new Date(ev.start);
          let end = new Date(ev.end);
          // Check if event overlaps with the target day
          if ((start >= target && start < tomorrow) || (start <= target && end > target)) {
            dayEvents.push({
              summary: ev.summary,
              start: start.toISOString(),
              end: end.toISOString()
            });
          }
        }
      }
    }
    
    // Sort chronologically
    dayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    
    return dayEvents;
  } catch (err) {
    console.error('[Calendar Module] Error fetching events:', err);
    return { error: 'Failed to fetch events from iCal link' };
  }
}

module.exports = { fetchEventsForToday };
