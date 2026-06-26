const fs = require('fs');
const path = require('path');

async function getCalendarEvents() {
  try {
    const eventsPath = path.join(__dirname, '..', 'events.json');
    const raw = fs.readFileSync(eventsPath, 'utf-8');
    const events = JSON.parse(raw);

    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Filter to upcoming events within the next 3 days
    const upcoming = events
      .map(e => {
        const eventDate = new Date(`${e.date}T${e.time}:00`);
        return { ...e, dateObj: eventDate };
      })
      .filter(e => e.dateObj >= now && e.dateObj <= threeDaysLater)
      .sort((a, b) => a.dateObj - b.dateObj)
      .slice(0, 4)
      .map(e => ({
        title: e.title,
        time: e.time,
        date: e.date,
        duration: e.duration,
        color: e.color || '#6C5CE7',
        relative: getRelativeTime(e.dateObj, now),
      }));

    return upcoming;
  } catch (e) {
    return [];
  }
}

function getRelativeTime(eventDate, now) {
  const diffMs = eventDate - now;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffHours < 24) return `in ${diffHours}h`;
  if (diffDays === 1) return 'Tomorrow';
  return `in ${diffDays} days`;
}

module.exports = { getCalendarEvents };
