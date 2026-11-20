// Sajtovi bez javnog API-ja: čitamo HTML listinga i hvatamo linkove ka oglasima.
// Ako sajt promeni dizajn, i dalje radi dok god URL oglasa ima isti oblik.
import { fetchSmart } from '../fetcher.js';
import { harvestLinks } from '../extract.js';
import { makeJob, slug, dateFromText, sleep, matchesAny } from './common.js';

async function crawl({ source, urls, linkTest, ctx, filterLocal = false, pause = 900 }) {
  const seen = new Map();
  for (const url of urls) {
    if (seen.size >= ctx.max) break;
    try {
      const { text, rendered } = await fetchSmart(url, {
        needs: html => harvestLinks(html, url, linkTest).length > 0
      });
      const items = harvestLinks(text, url, linkTest);
      ctx.log(`  ${source}: ${items.length} linkova sa ${url}${rendered ? ' (Chrome render)' : ''}`);
      for (const it of items) {
        if (seen.has(it.url)) continue;
        if (filterLocal && !matchesAny(`${it.title} ${it.snippet}`, ctx.keywords)) continue;
        seen.set(it.url, makeJob(source, { ...it, datePosted: it.datePosted || dateFromText(it.snippet) }));
      }
    } catch (e) {
      ctx.log(`  ${source}: greška za ${url} — ${e.message}`);
    }
    await sleep(pause);
  }
  return [...seen.values()].slice(0, ctx.max);
}

const enc = encodeURIComponent;

export const studentski = {
  id: 'studentski', name: 'e-Študentski servis', region: 'SI',
  async search(ctx) {
    const base = 'https://www.studentski-servis.com/studenti/prosta-dela';
    const urls = [];
    for (const kw of ctx.keywords.slice(0, 8)) urls.push(`${base}?kljucne_besede=${enc(kw)}`);
    for (let p = 1; p <= 4; p++) urls.push(p === 1 ? base : `${base}?page=${p}`);
    return crawl({
      source: this.id, urls, ctx, filterLocal: true,
      linkTest: u => /studentski-servis\.com\/studenti\/prosta-dela\/./i.test(u) && /\d{5,}/.test(u)
    });
  }
};

export const mojedelo = {
  id: 'mojedelo', name: 'MojeDelo.com', region: 'SI',
  async search(ctx) {
    const urls = [];
    for (const kw of ctx.keywords.slice(0, 8)) urls.push(`https://www.mojedelo.com/iskanje-zaposlitve?q=${enc(kw)}`);
    urls.push('https://www.mojedelo.com/prosta-delovna-mesta/racunalnistvo-programiranje');
    urls.push('https://www.mojedelo.com/prosta-delovna-mesta');
    return crawl({
      source: this.id, urls, ctx, filterLocal: true,
      linkTest: u => /mojedelo\.com\/(oglas|prosta-delovna-mesta\/[^/?#]+\/[^/?#]+-\d+|delovno-mesto)\//i.test(u + '/') && /\d{4,}/.test(u)
    });
  }
};

export const zaposlitev = {
  id: 'zaposlitev', name: 'Zaposlitev.net', region: 'SI',
  async search(ctx) {
    const urls = ctx.keywords.slice(0, 8).map(kw => `https://www.zaposlitev.net/delo/?q=${enc(kw)}`);
    urls.push('https://www.zaposlitev.net/');
    return crawl({
      source: this.id, urls, ctx, filterLocal: true,
      linkTest: u => /zaposlitev\.net\/.*(oglas|delo|zaposlitev)[^?]*\d{4,}/i.test(u)
    });
  }
};

export const slotech = {
  id: 'slotech', name: 'Slo-Tech (IT oglasi)', region: 'SI',
  async search(ctx) {
    return crawl({
      source: this.id, urls: ['https://slo-tech.com/delo'], ctx, filterLocal: false,
      linkTest: /slo-tech\.com\/delo\/\d+$/i
    });
  }
};

export const infostud = {
  id: 'infostud', name: 'Infostud (Srbija)', region: 'RS',
  async search(ctx) {
    const urls = [];
    for (const kw of ctx.keywords.slice(0, 8)) {
      urls.push(`https://poslovi.infostud.com/oglasi-za-posao-${slug(kw)}`);
    }
    urls.push('https://poslovi.infostud.com/oglasi-za-posao-it');
    urls.push('https://poslovi.infostud.com/oglasi-za-posao-it?page=2');
    return crawl({
      source: this.id, urls, ctx, filterLocal: false,
      linkTest: /poslovi\.infostud\.com\/posao\/[^/]+\/[^/]+\/\d+/i
    });
  }
};

export const helloworld = {
  id: 'helloworld', name: 'HelloWorld.rs', region: 'RS',
  async search(ctx) {
    const urls = [];
    for (const kw of ctx.keywords.slice(0, 6)) urls.push(`https://www.helloworld.rs/oglasi-za-posao?q=${enc(kw)}`);
    urls.push('https://www.helloworld.rs/oglasi-za-posao');
    urls.push('https://www.helloworld.rs/oglasi-za-posao?page=2');
    return crawl({
      source: this.id, urls, ctx, filterLocal: true,
      linkTest: /helloworld\.rs\/posao\/[^/]+\/[^/]+\/\d+/i
    });
  }
};
