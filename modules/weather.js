const https = require('https');

let cachedWeather = null;
let lastWeatherFetch = 0;
const WEATHER_CACHE_DURATION = 600000; // 10 minutes

async function getWeather() {
  const now = Date.now();
  if (cachedWeather && (now - lastWeatherFetch) < WEATHER_CACHE_DURATION) {
    return cachedWeather;
  }

  try {
    // Use wttr.in for simple, free weather data (no API key needed)
    const data = await fetchJSON('https://wttr.in/?format=j1');

    const current = data.current_condition[0];
    const weather = {
      temp: current.temp_F,
      tempC: current.temp_C,
      feelsLike: current.FeelsLikeF,
      humidity: current.humidity,
      description: current.weatherDesc[0].value,
      windSpeed: current.windspeedMiles,
      icon: getWeatherIcon(current.weatherCode),
      location: data.nearest_area[0].areaName[0].value,
    };

    cachedWeather = weather;
    lastWeatherFetch = now;
    return weather;
  } catch (e) {
    return cachedWeather || {
      temp: '--', tempC: '--', feelsLike: '--',
      humidity: '--', description: 'Unavailable',
      windSpeed: '--', icon: '🌡️', location: 'Unknown',
    };
  }
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'curl' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function getWeatherIcon(code) {
  const c = parseInt(code);
  if (c === 113) return '☀️';
  if (c === 116) return '⛅';
  if (c === 119 || c === 122) return '☁️';
  if ([143, 248, 260].includes(c)) return '🌫️';
  if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 311, 314, 317, 353, 356, 359].includes(c)) return '🌧️';
  if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377, 392, 395].includes(c)) return '🌨️';
  if ([200, 386, 389].includes(c)) return '⛈️';
  return '🌡️';
}

module.exports = { getWeather };
