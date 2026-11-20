// Izvlačenje podataka iz HTML-a: oglas sa bilo kog sajta + generičko "žetvenje" linkova sa listinga.
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';

export const clean = s => (s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
export const oneLine = s => clean(s).replace(/\s+/g, ' ');
export const hashId = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

export function stripHtml(html) {
  if (!html) return '';
  const $ = cheerio.load(`<div id="x">${html}</div>`);
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, div, tr').each((_, el) => { $(el).append('\n'); });
  $('li').each((_, el) => { $(el).prepend('• '); });
  return clean($('#x').text());
}

export function absUrl(href, base) {
  try { return new URL(href, base).toString().split('#')[0]; } catch { return null; }
}

/** Sve JobPosting stavke iz JSON-LD blokova (podržava @graph i nizove). */
export function jsonLdJobs($) {
  const out = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const t = node['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(node);
    if (node['@graph']) visit(node['@graph']);
    if (node.itemListElement) visit(node.itemListElement);
    if (node.item) visit(node.item);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    try { visit(JSON.parse(raw)); } catch {
      try { visit(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '))); } catch {}
    }
  });
  return out;
}

function ldLocation(jp) {
  const locs = [].concat(jp.jobLocation || []);
  const parts = locs.map(l => {
    const a = l?.address || {};
    return typeof a === 'string' ? a : [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter(Boolean).join(', ');
  }).filter(Boolean);
  if (/telecommute/i.test(jp.jobLocationType || '')) parts.unshift('Remote');
  return parts.join(' · ');
}

function ldSalary(jp) {
  const s = jp.baseSalary;
  if (!s) return '';
  const v = s.value || {};
  const amt = v.minValue && v.maxValue ? `${v.minValue}–${v.maxValue}` : (v.value || v.minValue || v.maxValue || '');
  return [amt, s.currency, v.unitText].filter(Boolean).join(' ');
}

export function detectLang(text) {
  const t = ` ${(text || '').toLowerCase()} `;
  const score = (words) => words.reduce((n, w) => n + (t.split(w).length - 1), 0);
  const sl = score([' in ', ' za ', ' delo ', ' delovno ', ' zahtevamo ', ' nudimo ', ' študent', ' izkušnje ', ' znanje ', ' ter ', ' kandidat', ' ki ', ' oziroma ', ' bo ', ' prijava ']);
  const sr = score([' i ', ' za ', ' posao ', ' iskustvo ', ' nudimo ', ' kandidat', ' rad ', ' koji ', ' poznavanje ', ' biće ', ' uslovi ', ' prijave ', ' radno ', ' od ']);
  const en = score([' the ', ' and ', ' you ', ' with ', ' experience ', ' we ', ' our ', ' will ', ' of ', ' to ', ' skills ', ' team ']);
  const de = score([' und ', ' der ', ' die ', ' wir ', ' sie ', ' mit ', ' erfahrung ', ' für ']);
  const slSpecific = score([' ter ', ' oziroma ', ' delo', ' ki ', 'š', 'č']);
  const srSpecific = score([' posao', ' koji ', ' biće', ' uslovi', ' rad ']);
  const ranked = [['sl', sl + slSpecific], ['sr', sr + srSpecific], ['en', en], ['de', de]].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 2 ? ranked[0][0] : 'en';
}

/** Glavni tekst stranice (bez menija, futera, kolačića). */
export function mainText($) {
  const $c = cheerio.load($.html());
  $c('script, style, noscript, svg, nav, footer, header, form, iframe, [class*=cookie], [id*=cookie], [class*=consent], [aria-hidden=true]').remove();
  const candidates = ['[itemprop=description]', '.job-description', '.job_description', '#job-description', '[class*=description]', '[class*=oglas]', 'article', 'main', '[role=main]', '.content', '#content', 'body'];
  let best = '';
  for (const sel of candidates) {
    $c(sel).each((_, el) => {
      const html = $c(el).html() || '';
      const txt = stripHtml(html);
      if (txt.length > best.length && (sel === 'body' ? !best : true)) best = txt;
    });
    if (best.length > 600 && sel !== 'body') break;
  }
  return best.slice(0, 20000);
}

/** Oglas sa bilo koje stranice. */
export function extractJob(html, url) {
  const $ = cheerio.load(html);
  const ld = jsonLdJobs($)[0];
  const meta = n => $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content') || '';
  let job = {
    url,
    title: oneLine(ld?.title || meta('og:title') || $('h1').first().text() || $('title').text()),
    company: oneLine(ld?.hiringOrganization?.name || (typeof ld?.hiringOrganization === 'string' ? ld.hiringOrganization : '') || meta('og:site_name')),
    location: ld ? ldLocation(ld) : '',
    salary: ld ? ldSalary(ld) : '',
    datePosted: ld?.datePosted || '',
    validThrough: ld?.validThrough || '',
    employmentType: [].concat(ld?.employmentType || []).join(', '),
    description: ''
  };
  const ldDesc = ld?.description ? stripHtml(ld.description) : '';
  const pageText = mainText($);
  job.description = ldDesc.length > 300 ? ldDesc : (pageText.length > ldDesc.length ? pageText : ldDesc);
  job.remote = /remote|rad od kuće|delo od doma|na daljavo|work from home|telecommute|hibrid/i.test(`${job.title} ${job.location} ${job.description.slice(0, 3000)}`);
  job.lang = detectLang(job.description);
  return job;
}

/**
 * Generički listing parser: nađi sve linkove koji liče na pojedinačne oglase.
 * linkTest: RegExp ili funkcija(url) -> bool
 */
export function harvestLinks(html, baseUrl, linkTest, { max = 200 } = {}) {
  const $ = cheerio.load(html);
  const test = typeof linkTest === 'function' ? linkTest : u => linkTest.test(u);
  const byUrl = new Map();

  // 1) JSON-LD na listingu (neki sajtovi ga imaju)
  for (const jp of jsonLdJobs($)) {
    const u = absUrl(jp.url || jp['@id'] || '', baseUrl);
    if (u && jp.title) byUrl.set(u, { url: u, title: oneLine(jp.title), company: oneLine(jp.hiringOrganization?.name || ''), location: ldLocation(jp), datePosted: jp.datePosted || '', snippet: stripHtml(jp.description || '').slice(0, 600) });
  }

  // 2) linkovi
  $('a[href]').each((_, a) => {
    const u = absUrl($(a).attr('href'), baseUrl);
    if (!u || !test(u)) return;
    const $a = $(a);
    let title = oneLine($a.attr('title') || $a.find('h1,h2,h3,h4,[class*=title],[class*=naslov]').first().text() || $a.text());
    // kartica = najbliži roditelj sa razumnom količinom teksta
    let $card = $a;
    for (let i = 0; i < 6; i++) {
      const p = $card.parent();
      if (!p.length) break;
      const len = oneLine(p.text()).length;
      if (len > 1500) break;
      $card = p;
      if (len > 120 && p.find('a[href]').filter((_, x) => test(absUrl($(x).attr('href'), baseUrl) || '')).length <= 3) {
        if (i >= 1) break;
      }
    }
    const cardText = oneLine($card.text());
    if (!title || title.length < 4) title = oneLine($card.find('h1,h2,h3,h4').first().text()) || title;
    if (!title || title.length < 3 || /^(več|vec|preberi|detajlno|detaljnije|more|apply|prijavi|prijava|oglas)$/i.test(title)) {
      const h = oneLine($card.find('h1,h2,h3,h4,strong,b').first().text());
      if (h) title = h;
    }
    if (!title || title.length < 3) return;
    const prev = byUrl.get(u);
    const item = {
      url: u,
      title: title.slice(0, 200),
      company: prev?.company || oneLine($card.find('[class*=company],[class*=employer],[class*=podjetje],[class*=poslodav],[class*=firma]').first().text()).slice(0, 120),
      location: prev?.location || oneLine($card.find('[class*=location],[class*=lokacij],[class*=kraj],[class*=mesto]').first().text()).slice(0, 120),
      datePosted: prev?.datePosted || '',
      snippet: prev?.snippet || cardText.slice(0, 600)
    };
    if (!prev || (prev.title.length < item.title.length && item.title.length < 160)) byUrl.set(u, { ...prev, ...item });
  });
  return [...byUrl.values()].slice(0, max);
}
