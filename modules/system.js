const si = require('systeminformation');

let cachedData = null;
let lastFetch = 0;
const CACHE_DURATION = 3000; // 3 seconds

async function getSystemInfo() {
  const now = Date.now();
  if (cachedData && (now - lastFetch) < CACHE_DURATION) {
    return cachedData;
  }

  try {
    const [cpuLoad, mem, battery, networkStats, fsSize] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.battery(),
      si.networkStats(),
      si.fsSize(),
    ]);

    const primaryNet = networkStats[0] || {};

    cachedData = {
      cpu: Math.round(cpuLoad.currentLoad || 0),
      ram: Math.round((mem.used / mem.total) * 100),
      ramUsed: (mem.used / 1073741824).toFixed(1),   // GB
      ramTotal: (mem.total / 1073741824).toFixed(1),  // GB
      battery: battery.percent || 0,
      batteryCharging: battery.isCharging || false,
      hasBattery: battery.hasBattery || false,
      networkDown: formatBytes(primaryNet.rx_sec || 0),
      networkUp: formatBytes(primaryNet.tx_sec || 0),
      diskUsed: fsSize.length > 0 ? Math.round((fsSize[0].used / fsSize[0].size) * 100) : 0,
    };

    lastFetch = now;
    return cachedData;
  } catch (e) {
    return {
      cpu: 0, ram: 0, ramUsed: '0', ramTotal: '0',
      battery: 0, batteryCharging: false, hasBattery: false,
      networkDown: '0 B/s', networkUp: '0 B/s', diskUsed: 0,
    };
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1048576).toFixed(1)} MB/s`;
}

module.exports = { getSystemInfo };
