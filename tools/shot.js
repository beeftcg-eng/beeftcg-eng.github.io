// Headless screenshot: node tools/shot.js <url> <out.png> [width] [height] [waitMs]
// Env: LS='{"key":"value"}' seeds localStorage before the page loads; FAKE_CONFIG=<file> serves that
// file as /config.js on 127.0.0.1 (used for Pairings' demo data) and blocks the service worker.
// Needs puppeteer-core (from ~/Desktop/turn zero/tests) and Playwright's chrome-headless-shell.
const puppeteer = require(process.env.PUPPETEER || '/var/home/beef/Desktop/turn zero/tests/node_modules/puppeteer-core');
const CHROME = process.env.CHROME || '/home/beef/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const [url, out, w = '420', h = '860', wait = '2500'] = process.argv.slice(2);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 2 });
  if (process.env.LS) await page.evaluateOnNewDocument(ls => { for (const [k, v] of Object.entries(JSON.parse(ls))) localStorage.setItem(k, v) }, process.env.LS);
  if (process.env.FAKE_CONFIG) {
    const body = require('fs').readFileSync(process.env.FAKE_CONFIG, 'utf8');
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = new URL(r.url());
      if (u.hostname === '127.0.0.1' && u.pathname === '/config.js') return r.respond({ status: 200, contentType: 'application/javascript', body });
      if (u.hostname === '127.0.0.1' && u.pathname === '/sw.js') return r.abort();
      return r.continue();
    });
  }
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, +wait));
  await page.screenshot({ path: out });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
