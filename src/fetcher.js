// Preuzimanje stranica: prvo običan HTTP, a ako stranica traži JavaScript — headless Chrome (puppeteer).
import puppeteer from 'puppeteer';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const HEADERS = {
  'user-agent': UA,
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'sl-SI,sl;q=0.9,sr;q=0.8,en;q=0.7'
};

export async function fetchText(url, { timeoutMs = 25000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { ...HEADERS, ...headers }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} za ${url}`);
    return { text: await res.text(), finalUrl: res.url };
  } finally { clearTimeout(t); }
}

export async function fetchJson(url, opts) {
  const { text } = await fetchText(url, { ...opts, headers: { accept: 'application/json' } });
  return JSON.parse(text);
}

let browserPromise = null;
export function getBrowser() {
  if (!browserPromise) {
    const opts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
    if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
    browserPromise = puppeteer.launch(opts).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}

export async function renderHtml(url, { waitMs = 2500, scroll = true } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'accept-language': HEADERS['accept-language'] });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
    // klikni "prihvati kolačiće" ako postoji
    await page.evaluate(() => {
      const re = /^(sprejmi|sprejmem|prihvat|accept|strinjam|slažem|se strinjam|razumem|ok)/i;
      for (const b of document.querySelectorAll('button, a[role=button]')) {
        if (re.test((b.textContent || '').trim())) { b.click(); break; }
      }
    }).catch(() => {});
    if (scroll) {
      await page.evaluate(async () => {
        for (let i = 0; i < 6; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 350)); }
      }).catch(() => {});
    }
    await new Promise(r => setTimeout(r, waitMs));
    return { text: await page.content(), finalUrl: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

/** HTTP pa, ako je rezultat prazan/sumnjiv, render kroz Chrome. */
export async function fetchSmart(url, { needs, render = 'auto' } = {}) {
  if (render !== 'always') {
    try {
      const r = await fetchText(url);
      if (!needs || needs(r.text)) return { ...r, rendered: false };
    } catch (e) {
      if (render === 'never') throw e;
    }
  }
  if (render === 'never') return { text: '', finalUrl: url, rendered: false };
  const r = await renderHtml(url);
  return { ...r, rendered: true };
}

export async function htmlToPdf(html, outFile) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.pdf({ path: outFile, format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally { await page.close().catch(() => {}); }
}
