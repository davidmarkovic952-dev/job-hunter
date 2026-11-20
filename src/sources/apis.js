// Izvori sa javnim API-jem / RSS-om — najstabilniji, ne zavise od dizajna sajta.
import * as cheerio from 'cheerio';
import { fetchJson, fetchText } from '../fetcher.js';
import { makeJob, matchesAny, sleep } from './common.js';
import { oneLine } from '../extract.js';

const enc = encodeURIComponent;

export const linkedin = {
  id: 'linkedin', name: 'LinkedIn (javni oglasi)', region: 'ALL',
  async search(ctx) {
    const out = new Map();
    const locs = ctx.locations.length ? ctx.locations : ['Slovenia'];
    for (const kw of ctx.keywords.slice(0, 6)) {
      for (const loc of locs.slice(0, 3)) {
        if (out.size >= ctx.max) break;
        const isRemote = /remote|daljavo|od kuće/i.test(loc);
        const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${enc(kw)}&location=${enc(isRemote ? 'European Union' : loc)}${isRemote ? '&f_WT=2' : ''}&f_TPR=r2592000&start=0`;
        try {
          const { text } = await fetchText(url);
          const $ = cheerio.load(text);
          let n = 0;
          $('li').each((_, li) => {
            const $li = $(li);
            const href = $li.find('a.base-card__full-link, a[href*="/jobs/view/"]').first().attr('href');
            if (!href) return;
            const clean = href.split('?')[0];
            const title = oneLine($li.find('.base-search-card__title, h3').first().text());
            if (!title) return;
            n++;
            out.set(clean, makeJob(this.id, {
              url: clean, title,
              company: $li.find('.base-search-card__subtitle, h4').first().text(),
              location: $li.find('.job-search-card__location').first().text(),
              datePosted: $li.find('time').attr('datetime'),
              snippet: `${title} · ${oneLine($li.find('.base-search-card__subtitle').text())} · ${oneLine($li.find('.job-search-card__location').text())}`,
              remote: isRemote || undefined
            }));
          });
          ctx.log(`  linkedin: ${n} za "${kw}" / ${loc}`);
        } catch (e) { ctx.log(`  linkedin: ${e.message}`); }
        await sleep(1500);
      }
    }
    return [...out.values()].slice(0, ctx.max);
  },
  async detail(url) {
    const id = (url.match(/(\d{8,})/) || [])[1];
    if (!id) return null;
    const { text } = await fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
    const $ = cheerio.load(text);
    const html = $('.show-more-less-html__markup, .description__text').first().html();
    return html || null;
  }
};

export const remotive = {
  id: 'remotive', name: 'Remotive (remote)', region: 'REMOTE',
  async search(ctx) {
    const out = new Map();
    for (const kw of ctx.keywords.slice(0, 6)) {
      try {
        const data = await fetchJson(`https://remotive.com/api/remote-jobs?search=${enc(kw)}&limit=40`);
        for (const j of data.jobs || []) out.set(j.url, makeJob(this.id, {
          url: j.url, title: j.title, company: j.company_name, location: j.candidate_required_location || 'Remote',
          description: j.description, datePosted: j.publication_date, salary: j.salary, tags: j.tags, remote: true
        }));
      } catch (e) { ctx.log(`  remotive: ${e.message}`); }
      await sleep(1200);
    }
    ctx.log(`  remotive: ${out.size}`);
    return [...out.values()].slice(0, ctx.max);
  }
};

export const remoteok = {
  id: 'remoteok', name: 'RemoteOK', region: 'REMOTE',
  async search(ctx) {
    const data = await fetchJson('https://remoteok.com/api');
    const jobs = (Array.isArray(data) ? data : []).filter(j => j && j.position);
    const out = jobs.filter(j => matchesAny(`${j.position} ${(j.tags || []).join(' ')} ${j.description || ''}`.slice(0, 4000), ctx.keywords))
      .map(j => makeJob(this.id, {
        url: j.url || `https://remoteok.com/remote-jobs/${j.id}`, title: j.position, company: j.company, location: j.location || 'Remote',
        description: j.description, datePosted: j.date, tags: j.tags, remote: true,
        salary: j.salary_min ? `${j.salary_min}–${j.salary_max} USD` : ''
      }));
    ctx.log(`  remoteok: ${out.length} od ${jobs.length}`);
    return out.slice(0, ctx.max);
  }
};

export const arbeitnow = {
  id: 'arbeitnow', name: 'Arbeitnow (EU)', region: 'EU',
  async search(ctx) {
    const out = [];
    for (let p = 1; p <= 3; p++) {
      try {
        const data = await fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`);
        for (const j of data.data || []) {
          if (!matchesAny(`${j.title} ${(j.tags || []).join(' ')}`, ctx.keywords)) continue;
          out.push(makeJob(this.id, {
            url: j.url, title: j.title, company: j.company_name, location: j.location, description: j.description,
            datePosted: j.created_at, tags: j.tags, remote: j.remote
          }));
        }
      } catch (e) { ctx.log(`  arbeitnow: ${e.message}`); break; }
      await sleep(800);
    }
    ctx.log(`  arbeitnow: ${out.length}`);
    return out.slice(0, ctx.max);
  }
};

export const jobicy = {
  id: 'jobicy', name: 'Jobicy (remote)', region: 'REMOTE',
  async search(ctx) {
    const out = new Map();
    for (const kw of ctx.keywords.slice(0, 5)) {
      try {
        const data = await fetchJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${enc(kw)}`);
        for (const j of data.jobs || []) out.set(j.url, makeJob(this.id, {
          url: j.url, title: j.jobTitle, company: j.companyName, location: j.jobGeo || 'Remote',
          description: j.jobDescription || j.jobExcerpt, datePosted: j.pubDate, remote: true,
          salary: j.annualSalaryMin ? `${j.annualSalaryMin}–${j.annualSalaryMax} ${j.salaryCurrency || ''}/god` : ''
        }));
      } catch (e) { ctx.log(`  jobicy: ${e.message}`); }
      await sleep(1000);
    }
    ctx.log(`  jobicy: ${out.size}`);
    return [...out.values()].slice(0, ctx.max);
  }
};

export const himalayas = {
  id: 'himalayas', name: 'Himalayas (remote)', region: 'REMOTE',
  async search(ctx) {
    const out = [];
    for (let off = 0; off < 300; off += 100) {
      try {
        const data = await fetchJson(`https://himalayas.app/jobs/api?limit=100&offset=${off}`);
        for (const j of data.jobs || []) {
          if (!matchesAny(`${j.title} ${(j.categories || []).join(' ')} ${j.excerpt || ''}`, ctx.keywords)) continue;
          out.push(makeJob(this.id, {
            url: j.applicationLink || j.guid, title: j.title, company: j.companyName,
            location: (j.locationRestrictions || []).join(', ') || 'Remote (worldwide)',
            description: j.description, datePosted: j.pubDate, remote: true,
            salary: j.minSalary ? `${j.minSalary}–${j.maxSalary} ${j.currency || ''}` : ''
          }));
        }
      } catch (e) { ctx.log(`  himalayas: ${e.message}`); break; }
      await sleep(800);
    }
    ctx.log(`  himalayas: ${out.length}`);
    return out.slice(0, ctx.max);
  }
};

export const wwr = {
  id: 'wwr', name: 'We Work Remotely', region: 'REMOTE',
  async search(ctx) {
    const feeds = ['remote-programming-jobs', 'remote-full-stack-programming-jobs', 'remote-front-end-programming-jobs', 'remote-customer-support-jobs', 'remote-devops-sysadmin-jobs', 'remote-design-jobs'];
    const out = new Map();
    for (const f of feeds) {
      try {
        const { text } = await fetchText(`https://weworkremotely.com/categories/${f}.rss`);
        const $ = cheerio.load(text, { xmlMode: true });
        $('item').each((_, it) => {
          const $it = $(it);
          const full = $it.find('title').text();
          const [company, ...rest] = full.split(':');
          const title = rest.join(':').trim() || full;
          const desc = $it.find('description').text();
          if (!matchesAny(`${title} ${desc.slice(0, 1500)}`, ctx.keywords)) return;
          const link = $it.find('link').text().trim() || $it.find('guid').text().trim();
          out.set(link, makeJob(this.id, {
            url: link, title, company, location: $it.find('region').text() || 'Remote',
            description: desc, datePosted: $it.find('pubDate').text(), remote: true
          }));
        });
      } catch (e) { ctx.log(`  wwr: ${e.message}`); }
      await sleep(600);
    }
    ctx.log(`  wwr: ${out.size}`);
    return [...out.values()].slice(0, ctx.max);
  }
};
