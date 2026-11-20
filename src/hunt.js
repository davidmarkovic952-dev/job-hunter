// Skupljanje oglasa sa svih izvora + filtriranje + ocena (ključne reči, pa AI za najbolje).
import { db } from './db.js';
import { askJson } from './ai.js';
import { fetchSmart } from './fetcher.js';
import { extractJob } from './extract.js';
import { norm, matchesAny } from './sources/common.js';
import * as html from './sources/html-sites.js';
import * as apis from './sources/apis.js';

export const SOURCES = [
  html.studentski, html.mojedelo, html.zaposlitev, html.slotech,
  html.infostud, html.helloworld,
  apis.linkedin, apis.remotive, apis.remoteok, apis.arbeitnow, apis.jobicy, apis.himalayas, apis.wwr
];

export const huntState = { running: false, log: [], startedAt: null, finishedAt: null, found: 0, added: 0, stage: '' };
const log = msg => {
  const line = `${new Date().toLocaleTimeString('sr-RS')}  ${msg}`;
  huntState.log.push(line);
  if (huntState.log.length > 600) huntState.log.shift();
  console.log(line);
};

// ---------- ocena po ključnim rečima ----------
const SENIOR_RE = /\b(senior|sr\.|lead|principal|staff|head of|architect|vodja|direktor)\b/i;
const YEARS_RE = /(\d{1,2})\s*\+?\s*(?:years|godina|godine|let|leta)\b/i;
const GERMAN_RE = /(nemščin|nemški jezik|deutsch|german (?:is )?(?:required|fluent|c1|b2)|nemački jezik|nemačk)/i;

function profileTerms(profile) {
  const terms = new Set();
  for (const g of profile?.skills || []) for (const s of g.items || []) if (s.length < 40) terms.add(s);
  return [...terms];
}

export function keywordScore(job, settings, profile) {
  const title = `${job.title}`;
  const body = `${job.snippet} ${job.description || ''} ${(job.tags || []).join(' ')}`.slice(0, 8000);
  const kws = settings.search.keywords;
  const skills = profileTerms(profile);
  let s = 30;
  for (const k of kws) { if (matchesAny(title, [k])) s += 18; else if (matchesAny(body, [k])) s += 6; }
  let skillHits = 0;
  for (const k of skills) if (matchesAny(`${title} ${body}`, [k])) skillHits++;
  s += Math.min(30, skillHits * 4);
  if (SENIOR_RE.test(title)) s -= 30;
  const y = body.match(YEARS_RE);
  if (y && +y[1] >= 3 && +y[1] < 30) s -= Math.min(30, (+y[1] - 2) * 7);
  const speaksGerman = (profile?.languages || []).some(l => /nem|german|deutsch/i.test(l.name));
  if (GERMAN_RE.test(body) && !speaksGerman) s -= 20;
  if (/študent|student|dostupno studentima|internship|praksa|junior|entry/i.test(`${title} ${body.slice(0, 2000)}`)) s += 8;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function passesFilters(job, settings) {
  const sx = settings.search;
  if (sx.exclude?.length && matchesAny(job.title, sx.exclude)) return false;
  if (sx.mustHaveAny?.length && !matchesAny(`${job.title} ${job.snippet} ${job.description}`, sx.mustHaveAny)) return false;
  if (sx.remoteOnly && !job.remote) return false;
  if (job.datePosted && sx.maxAgeDays) {
    const age = (Date.now() - Date.parse(job.datePosted)) / 864e5;
    if (age > sx.maxAgeDays) return false;
  }
  return true;
}

// ---------- AI ocena ----------
export function compactProfile(p) {
  if (!p) return 'Profil nije unet.';
  return JSON.stringify({
    title: p.title, location: p.location, summary: p.summary,
    skills: (p.skills || []).flatMap(g => g.items).slice(0, 60),
    experience: (p.experience || []).map(e => `${e.role} @ ${e.company} (${e.start}–${e.end})`),
    projects: (p.projects || []).map(x => x.name).slice(0, 10),
    education: (p.education || []).map(e => `${e.degree}, ${e.school}`),
    languages: (p.languages || []).map(l => `${l.name} ${l.level}`),
    preferences: p.preferences || ''
  });
}

const SCORE_SYSTEM = `Ti si iskusan regruter. Za kandidata i listu oglasa proceni koliko je svaki oglas realno dobar za kandidata (šansa da ga pozovu + koliko mu posao odgovara).
Budi strog: senior uloge i oglasi sa uslovima koje kandidat očigledno nema (godine iskustva, jezik, licence) dobijaju nisku ocenu.
Vrati JSON: {"results":[{"id":"...","score":0-100,"reason":"1 kratka rečenica na srpskom (latinica)","flags":["kratke crvene zastavice"],"level":"student|junior|mid|senior"}]}`;

async function aiScoreBatch(jobs, profile) {
  const list = jobs.map(j => ({
    id: j.id, title: j.title, company: j.company, location: j.location, remote: j.remote,
    text: (j.description || j.snippet || '').slice(0, 1600)
  }));
  const { data, provider } = await askJson(SCORE_SYSTEM, `KANDIDAT:\n${compactProfile(profile)}\n\nOGLASI:\n${JSON.stringify(list)}`, { log });
  const res = Array.isArray(data) ? data : data.results || [];
  for (const r of res) {
    if (!r?.id || !db.jobs[r.id]) continue;
    db.updateJob(r.id, { ai: { score: Math.max(0, Math.min(100, +r.score || 0)), reason: r.reason || '', flags: r.flags || [], level: r.level || '', provider, at: new Date().toISOString() } });
  }
  return res.length;
}

export async function enrichDescription(job) {
  if (job.description && job.description.length > 400) return job;
  try {
    if (job.source === 'linkedin') {
      const htmlDesc = await apis.linkedin.detail(job.url);
      if (htmlDesc) return db.updateJob(job.id, { description: extractJob(`<html><body><main>${htmlDesc}</main></body></html>`, job.url).description });
    }
    const { text } = await fetchSmart(job.url, { needs: h => extractJob(h, job.url).description.length > 400 });
    const ex = extractJob(text, job.url);
    const patch = { description: ex.description };
    if (!job.company && ex.company) patch.company = ex.company;
    if (!job.location && ex.location) patch.location = ex.location;
    if (!job.salary && ex.salary) patch.salary = ex.salary;
    if (!job.datePosted && ex.datePosted) patch.datePosted = ex.datePosted;
    return db.updateJob(job.id, patch);
  } catch (e) {
    log(`  opis nije preuzet (${job.title.slice(0, 40)}): ${e.message}`);
    return job;
  }
}

export async function aiScore(jobIds, { force = false } = {}) {
  const profile = db.profile;
  let jobs = jobIds.map(id => db.jobs[id]).filter(Boolean).filter(j => force || !j.ai);
  if (!jobs.length) return 0;
  huntState.stage = 'Preuzimam pune opise za najbolje oglase';
  for (const j of jobs) await enrichDescription(j);
  jobs = jobs.map(j => db.jobs[j.id]);
  for (const j of jobs) db.updateJob(j.id, { kwScore: keywordScore(j, db.settings, profile) });
  huntState.stage = `AI ocenjuje ${jobs.length} oglasa`;
  let done = 0;
  for (let i = 0; i < jobs.length; i += 8) {
    try {
      done += await aiScoreBatch(jobs.slice(i, i + 8), profile);
      log(`AI ocenio ${Math.min(i + 8, jobs.length)}/${jobs.length}`);
    } catch (e) {
      log(`AI ocenjivanje zaustavljeno: ${e.message.split('\n')[0]}`);
      break;
    }
  }
  return done;
}

export async function runHunt() {
  if (huntState.running) return;
  Object.assign(huntState, { running: true, log: [], startedAt: new Date().toISOString(), finishedAt: null, found: 0, added: 0, stage: 'Skupljam oglase' });
  const settings = db.settings;
  const profile = db.profile;
  const ctx = {
    keywords: settings.search.keywords, locations: settings.search.locations,
    max: settings.search.maxPerSource, log
  };
  const enabled = SOURCES.filter(s => settings.search.sources[s.id]);
  const newIds = [];
  try {
    // po 3 izvora paralelno
    for (let i = 0; i < enabled.length; i += 3) {
      await Promise.all(enabled.slice(i, i + 3).map(async src => {
        log(`→ ${src.name}`);
        let jobs = [];
        try { jobs = await src.search(ctx); } catch (e) { log(`✗ ${src.name}: ${e.message}`); return; }
        let kept = 0;
        for (const j of jobs) {
          if (!j.url || !j.title) continue;
          huntState.found++;
          if (!passesFilters(j, settings)) continue;
          const { job, isNew } = db.upsertJob({ ...j, kwScore: keywordScore(j, settings, profile) });
          kept++;
          if (isNew) { huntState.added++; newIds.push(job.id); }
        }
        log(`✓ ${src.name}: ${jobs.length} nađeno, ${kept} prošlo filtere`);
      }));
    }
    // AI ocena za najbolje nove oglase
    const top = newIds.map(id => db.jobs[id]).filter(j => j && j.kwScore >= 35)
      .sort((a, b) => b.kwScore - a.kwScore).slice(0, settings.search.aiScoreTop).map(j => j.id);
    if (top.length) {
      log(`AI ocena za ${top.length} najperspektivnijih novih oglasa…`);
      await aiScore(top);
    }
    log(`Gotovo: ${huntState.found} oglasa pregledano, ${huntState.added} novih.`);
  } catch (e) {
    log(`Greška: ${e.message}`);
  } finally {
    huntState.running = false;
    huntState.stage = '';
    huntState.finishedAt = new Date().toISOString();
  }
}

export function jobScore(j) { return j.ai?.score ?? j.kwScore ?? 0; }
export { norm };
