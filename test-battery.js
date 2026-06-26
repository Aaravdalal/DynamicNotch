const { getBatteryStatus } = require('./modules/battery');

async function test() {
  const status = await getBatteryStatus();
  console.log('Battery Status:', JSON.stringify(status, null, 2));
}

test();
