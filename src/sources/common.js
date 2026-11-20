import { hashId, oneLine, stripHtml } from '../extract.js';

export const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj');

export const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function matchesAny(text, words) {
  if (!words?.length) return true;
  const t = ` ${norm(text)} `;
  return words.some(w => {
    const k = norm(w).trim();
    if (!k) return false;
    if (k.length <= 3) return new RegExp(`[^a-z0-9]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(t);
    return t.includes(k);
  });
}

export function makeJob(source, raw) {
  const url = raw.url;
  return {
    id: hashId(url),
    source,
    url,
    title: oneLine(raw.title).slice(0, 220),
    company: oneLine(raw.company || '').slice(0, 140),
    location: oneLine(raw.location || '').slice(0, 160),
    snippet: oneLine(raw.snippet || stripHtml(raw.description || '').slice(0, 600)).slice(0, 700),
    description: raw.description ? stripHtml(raw.description).slice(0, 20000) : '',
    datePosted: normDate(raw.datePosted),
    salary: oneLine(raw.salary || ''),
    remote: raw.remote ?? /remote|rad od kuće|na daljavo|od doma|work from home|anywhere|worldwide/i.test(`${raw.title} ${raw.location} ${raw.snippet || ''}`),
    tags: (raw.tags || []).slice(0, 15),
    scrapedAt: new Date().toISOString()
  };
}

export function normDate(d) {
  if (!d) return '';
  if (typeof d === 'number') return new Date(d < 1e12 ? d * 1000 : d).toISOString();
  const m = String(d).match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])).toISOString();
  const t = Date.parse(d);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** Izvuci datum oblika 12.03.2026 iz teksta kartice. */
export function dateFromText(text) {
  const m = (text || '').match(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})\b/);
  return m ? normDate(m[0]) : '';
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
