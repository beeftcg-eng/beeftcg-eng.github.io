// node tools/brewhouse-shot.js <out.png> - opens the public Brewhouse phone app in a throwaway
// headless browser, presses "Sync card data" (Riftbound, the default game) and captures the browser.
const puppeteer = require(process.env.PUPPETEER || '/var/home/beef/Desktop/round-zero/tests/node_modules/puppeteer-core');
const CHROME = process.env.CHROME || '/home/beef/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto('https://beeftcg-eng.github.io/deckbuilder/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  for (const b of await page.$$('button')) {
    if ((await b.evaluate(n => n.textContent.trim())) === 'Sync card data') { await b.click(); break; }
  }
  await page.waitForFunction(() => document.querySelectorAll('.card-tile img').length >= 12, { timeout: 120000, polling: 1000 });
  await new Promise(r => setTimeout(r, 4000)); // let the card images finish loading
  await page.screenshot({ path: process.argv[2] });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
