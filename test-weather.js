fetch('https://weather.com/weather/today/l/37.38,-122.08', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
  }
})
  .then(r => r.text())
  .then(html => {
    const temp = html.match(/data-testid="TemperatureValue"[^>]*>([^<]+)<\/span>/);
    const phrase = html.match(/data-testid="wxIcon"[^>]*>([^<]+)<\/div>/);
    console.log(temp ? temp[1] : 'fail temp');
    console.log(phrase ? phrase[1] : 'fail phrase');
  });
