// CV: uvoz postojećeg CV-a → profil, prilagođavanje oglasu (AI), šablon i PDF.
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { askJson } from './ai.js';
import { db, CV_DIR } from './db.js';
import { fetchSmart, htmlToPdf } from './fetcher.js';
import { extractJob, hashId, detectLang } from './extract.js';
import { enrichDescription } from './hunt.js';
import * as apis from './sources/apis.js';
import { slug } from './sources/common.js';

export const PROFILE_SCHEMA = `{
 "name":"", "title":"kratka profesionalna titula", "email":"", "phone":"", "location":"", "birthDate":"",
 "links":[{"label":"GitHub","url":""}],
 "summary":"2-4 rečenice",
 "skills":[{"group":"npr. Frontend","items":["React","..."]}],
 "experience":[{"role":"","company":"","location":"","start":"MM/YYYY","end":"MM/YYYY ili Danas","bullets":["konkretan rezultat/zadatak"]}],
 "projects":[{"name":"","url":"","description":"1-2 rečenice","tech":["..."]}],
 "education":[{"school":"","degree":"","start":"","end":"","details":""}],
 "languages":[{"name":"","level":"npr. maternji / C1 / B2"}],
 "certifications":[""],
 "interests":""
}`;

// ---------- 1) čitanje fajla ----------
export async function fileToText(buffer, filename = '') {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return (await pdfParse(buffer)).text;
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer })).value;
  return buffer.toString('utf8');
}

// ---------- 2) postojeći CV → strukturisan profil ----------
export async function profileFromText(text) {
  const system = `Pretvori tekst CV-a u strukturisan JSON tačno po šemi. Ne izmišljaj ništa — samo ono što piše u CV-u. Zadrži jezik originala za opise. Šema:\n${PROFILE_SCHEMA}`;
  const { data } = await askJson(system, `CV TEKST:\n${text.slice(0, 30000)}`);
  return normalizeProfile(data);
}

export function normalizeProfile(p = {}) {
  const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
  return {
    name: p.name || '', title: p.title || '', email: p.email || '', phone: p.phone || '', location: p.location || '', birthDate: p.birthDate || '',
    photo: p.photo || '',
    links: arr(p.links).map(l => typeof l === 'string' ? { label: '', url: l } : { label: l.label || '', url: l.url || '' }).filter(l => l.url),
    summary: p.summary || '',
    skills: arr(p.skills).map(g => typeof g === 'string' ? { group: '', items: [g] } : { group: g.group || '', items: arr(g.items).map(String) }).filter(g => g.items.length),
    experience: arr(p.experience).map(e => ({ role: e.role || '', company: e.company || '', location: e.location || '', start: e.start || '', end: e.end || '', bullets: arr(e.bullets).map(String) })),
    projects: arr(p.projects).map(x => ({ name: x.name || '', url: x.url || '', description: x.description || '', tech: arr(x.tech).map(String) })),
    education: arr(p.education).map(e => ({ school: e.school || '', degree: e.degree || '', start: e.start || '', end: e.end || '', details: e.details || '' })),
    languages: arr(p.languages).map(l => typeof l === 'string' ? { name: l, level: '' } : { name: l.name || '', level: l.level || '' }),
    certifications: arr(p.certifications).map(String).filter(Boolean),
    interests: p.interests || '',
    preferences: p.preferences || ''
  };
}

// ---------- 3) preuzimanje oglasa sa linka ----------
export async function jobFromUrl(url) {
  if (/linkedin\.com\/jobs/.test(url)) {
    const htmlDesc = await apis.linkedin.detail(url).catch(() => null);
    if (htmlDesc) {
      const { text } = await fetchSmart(url, { render: 'never' }).catch(() => ({ text: '' }));
      const base = text ? extractJob(text, url) : { url, title: '', company: '' };
      const desc = extractJob(`<html><body><main>${htmlDesc}</main></body></html>`, url).description;
      return { ...base, description: desc, lang: detectLang(desc) };
    }
  }
  const { text, finalUrl } = await fetchSmart(url, { needs: h => extractJob(h, url).description.length > 500 });
  const job = extractJob(text, finalUrl || url);
  if (job.description.length < 150) throw new Error('Nisam uspeo da pročitam oglas sa ove stranice (možda traži prijavu). Nalepi tekst oglasa ručno.');
  return job;
}

// ---------- 4) prilagođavanje ----------
const LANG_NAME = { sl: 'slovenački (Slovenščina)', sr: 'srpski (latinica, ekavica)', en: 'engleski', de: 'nemački', hr: 'hrvatski' };

const TAILOR_SYSTEM = (lang) => `Ti si vrhunski karijerni savetnik i pisac CV-a. Prilagodi kandidatov CV konkretnom oglasu tako da maksimalno poveća šansu za poziv na razgovor.

PRAVILA (obavezno):
1. NIKAD ne izmišljaj iskustvo, firme, datume, diplome, sertifikate ni veštine koje kandidat nema. Smeš da preformulišeš, istakneš, preurediš i izostaviš.
2. "title" prilagodi nazivu pozicije iz oglasa (ako je realno za kandidata).
3. "summary": 3-4 jake rečenice — ko je kandidat, šta konkretno donosi baš ovom poslodavcu, ključne reči iz oglasa koje kandidat stvarno pokriva.
4. "skills": najrelevantnije grupe i veštine prve; izbaci one koje nemaju veze sa oglasom; koristi iste termine kao oglas (ATS ključne reči) kad kandidat tu veštinu ima.
5. "experience": zadrži sve stavke (redosled hronološki), ali bullet-e prepiši da naglase ono što oglas traži; počni glagolom radnje; 2-5 bullet-a po poslu; konkretno.
6. "projects": izaberi najviše 4 najrelevantnija projekta i opiši ih iz ugla oglasa.
7. Sav tekst piši na jeziku: ${LANG_NAME[lang] || lang}. Imena firmi, škola i tehnologija ostavi u originalu.
8. Sažeto: CV mora stati na 1 stranu (najviše 2 ako ima puno relevantnog iskustva).
9. Ostala polja (name, email, phone, location, links, education, languages, certifications) prepiši iz profila; prevedi samo opisne delove.

Vrati JSON: {"cv": <ista šema kao profil>, "matchScore": 0-100, "covered": ["zahtevi iz oglasa koje kandidat pokriva"], "gaps": ["zahtevi koje kandidat NEMA — budi iskren"], "tips": ["1-3 kratka saveta na srpskom za prijavu"]}`;

export async function tailorCv(profile, job, lang) {
  const user = `PROFIL KANDIDATA (JSON):\n${JSON.stringify({ ...profile, photo: undefined })}\n\nOGLAS:\nNaziv: ${job.title}\nPoslodavac: ${job.company}\nLokacija: ${job.location}\n\n${(job.description || job.snippet || '').slice(0, 12000)}`;
  const { data, provider } = await askJson(TAILOR_SYSTEM(lang), user);
  const cv = normalizeProfile({ ...data.cv, photo: profile.photo });
  // sigurnosna mreža: kontakt podaci uvek iz profila
  for (const k of ['name', 'email', 'phone', 'birthDate']) cv[k] = profile[k] || cv[k];
  if (!cv.links.length) cv.links = profile.links;
  return { cv, matchScore: data.matchScore ?? null, covered: data.covered || [], gaps: data.gaps || [], tips: data.tips || [], provider };
}

// ---------- 5) šablon ----------
const L = {
  sr: { summary: 'Profil', skills: 'Veštine', experience: 'Radno iskustvo', projects: 'Projekti', education: 'Obrazovanje', languages: 'Jezici', certs: 'Sertifikati', interests: 'Interesovanja', born: 'Rođen' },
  sl: { summary: 'Profil', skills: 'Znanja in veščine', experience: 'Delovne izkušnje', projects: 'Projekti', education: 'Izobrazba', languages: 'Jeziki', certs: 'Certifikati', interests: 'Interesi', born: 'Rojen' },
  en: { summary: 'Profile', skills: 'Skills', experience: 'Experience', projects: 'Projects', education: 'Education', languages: 'Languages', certs: 'Certifications', interests: 'Interests', born: 'Born' },
  de: { summary: 'Profil', skills: 'Kenntnisse', experience: 'Berufserfahrung', projects: 'Projekte', education: 'Ausbildung', languages: 'Sprachen', certs: 'Zertifikate', interests: 'Interessen', born: 'Geboren' }
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const prettyUrl = u => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export function renderCvHtml(cv, lang = 'en', { accent = '#1f4e79' } = {}) {
  const t = L[lang] || L.en;
  const contact = [cv.location, cv.phone, cv.email && `<a href="mailto:${esc(cv.email)}">${esc(cv.email)}</a>`, ...cv.links.map(l => `<a href="${esc(l.url)}">${esc(prettyUrl(l.url))}</a>`), cv.birthDate && `${t.born}: ${esc(cv.birthDate)}`]
    .filter(Boolean).map(x => x.startsWith('<a') ? x : esc(x)).join('<span class="dot">•</span>');
  const sec = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : '';
  const dates = (a, b) => [a, b].filter(Boolean).join(' – ');

  const skills = cv.skills.map(g => `<div class="skill"><b>${esc(g.group)}${g.group ? ':' : ''}</b> ${g.items.map(esc).join(', ')}</div>`).join('');
  const exp = cv.experience.map(e => `
    <div class="item">
      <div class="row"><div><span class="role">${esc(e.role)}</span>${e.company ? ` <span class="at">· ${esc(e.company)}</span>` : ''}${e.location ? ` <span class="muted">· ${esc(e.location)}</span>` : ''}</div><div class="date">${esc(dates(e.start, e.end))}</div></div>
      ${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    </div>`).join('');
  const proj = cv.projects.map(p => `
    <div class="item">
      <div class="row"><div><span class="role">${esc(p.name)}</span>${p.url ? ` <a class="muted" href="${esc(p.url)}">${esc(prettyUrl(p.url))}</a>` : ''}</div></div>
      <div class="desc">${esc(p.description)}${p.tech.length ? ` <span class="tech">${p.tech.map(esc).join(' · ')}</span>` : ''}</div>
    </div>`).join('');
  const edu = cv.education.map(e => `
    <div class="item"><div class="row"><div><span class="role">${esc(e.degree)}</span>${e.school ? ` <span class="at">· ${esc(e.school)}</span>` : ''}</div><div class="date">${esc(dates(e.start, e.end))}</div></div>
    ${e.details ? `<div class="desc">${esc(e.details)}</div>` : ''}</div>`).join('');
  const langs = cv.languages.map(l => `${esc(l.name)}${l.level ? ` <span class="muted">(${esc(l.level)})</span>` : ''}`).join(', ');

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(cv.name)} — CV</title>
<style>
@page { size: A4; margin: 14mm 15mm 14mm 15mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif; color: #1d232b; font-size: 10.4pt; line-height: 1.42; margin: 0; }
a { color: inherit; text-decoration: none; }
header { display: flex; gap: 16px; align-items: center; border-bottom: 2px solid ${accent}; padding-bottom: 10px; margin-bottom: 4px; }
header img { width: 78px; height: 78px; border-radius: 50%; object-fit: cover; }
h1 { font-size: 22pt; margin: 0; letter-spacing: -0.3px; color: #0f1720; }
.headline { font-size: 11.5pt; color: ${accent}; font-weight: 600; margin-top: 1px; }
.contact { font-size: 9pt; color: #4a5560; margin-top: 5px; }
.dot { margin: 0 6px; color: #a0a8b0; }
section { margin-top: 11px; break-inside: auto; }
h2 { font-size: 9.6pt; text-transform: uppercase; letter-spacing: 1.2px; color: ${accent}; margin: 0 0 5px; padding-bottom: 2px; border-bottom: 1px solid #dde3ea; }
.item { margin-bottom: 7px; break-inside: avoid; }
.row { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.role { font-weight: 650; }
.at { color: #2c3540; }
.muted { color: #6b7681; font-size: 9.2pt; }
.date { color: #5a6570; font-size: 9pt; white-space: nowrap; }
ul { margin: 3px 0 0 0; padding-left: 16px; }
li { margin: 1px 0; }
.desc { margin-top: 1px; }
.tech { color: #5a6570; font-size: 9pt; }
.skill { margin: 1.5px 0; }
p { margin: 0; }
</style></head><body>
<header>
  ${cv.photo ? `<img src="${esc(cv.photo)}" alt="">` : ''}
  <div><h1>${esc(cv.name)}</h1>${cv.title ? `<div class="headline">${esc(cv.title)}</div>` : ''}<div class="contact">${contact}</div></div>
</header>
${sec(t.summary, cv.summary ? `<p>${esc(cv.summary)}</p>` : '')}
${sec(t.experience, exp)}
${sec(t.projects, proj)}
${sec(t.skills, skills)}
${sec(t.education, edu)}
${sec(t.languages, langs ? `<p>${langs}</p>` : '')}
${sec(t.certs, cv.certifications.length ? `<p>${cv.certifications.map(esc).join(' · ')}</p>` : '')}
${sec(t.interests, cv.interests ? `<p>${esc(cv.interests)}</p>` : '')}
</body></html>`;
}

// ---------- 6) ceo tok ----------
export async function buildPdf(entry) {
  const html = renderCvHtml(entry.cv, entry.lang, { accent: entry.accent });
  const file = path.join(CV_DIR, entry.file);
  await htmlToPdf(html, file);
  return file;
}

export async function createTailoredCv({ url, jobId, text, lang, title, company }) {
  const profile = db.profile;
  if (!profile?.name) throw new Error('Prvo popuni profil (tab "Moj profil") ili uvezi postojeći CV.');
  let job;
  if (jobId) {
    job = db.jobs[jobId];
    if (!job) throw new Error('Oglas ne postoji');
    job = await enrichDescription(job);
  } else if (text && text.trim().length > 80) {
    job = { url: url || '', title: title || '', company: company || '', location: '', description: text.trim() };
  } else if (url) {
    job = await jobFromUrl(url);
  } else throw new Error('Unesi link oglasa ili nalepi tekst oglasa.');

  const targetLang = lang && lang !== 'auto' ? lang : (job.lang || detectLang(job.description));
  const result = await tailorCv(profile, job, targetLang);
  const id = hashId(`${job.url || job.title}-${Date.now()}`);
  const base = slug(`${profile.name} ${job.company || ''} ${job.title || ''}`).slice(0, 70) || 'cv';
  const entry = {
    id, createdAt: new Date().toISOString(), lang: targetLang, file: `${base}-${id.slice(0, 5)}.pdf`,
    job: { id: jobId || null, url: job.url, title: job.title, company: job.company, location: job.location },
    ...result
  };
  await buildPdf(entry);
  db.addCv(entry);
  if (jobId) db.updateJob(jobId, { cvId: id, status: db.jobs[jobId].status === 'novo' ? 'sačuvano' : db.jobs[jobId].status });
  return entry;
}

export function cvFilePath(entry) { return path.join(CV_DIR, entry.file); }
export function removeCvFile(entry) { try { fs.unlinkSync(cvFilePath(entry)); } catch {} }
