// Offline testovi: parseri, šablon, PDF i ceo AI tok preko lažnog Ollama servera.
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert';
process.env.JH_DATA_DIR = '/tmp/jh-test-data';
fs.rmSync('/tmp/jh-test-data', { recursive: true, force: true });

const { harvestLinks, extractJob, detectLang } = await import('../src/extract.js');
const { keywordScore } = await import('../src/hunt.js');
const { db } = await import('../src/db.js');

// 1) Infostud-like listing
const infostud = `<html><body><div class="list">
 <div class="job-card"><a href="/posao/Junior-React-Developer/Firma-doo/701234"><h2>Junior React Developer</h2></a>
   <p class="company-name">Firma d.o.o.</p><p class="location">Beograd | Hibrid</p><span>21.10.2026</span></div>
 <div class="job-card"><a href="/posao/IT-Support/Druga-firma/701235?utm=x"><h2>IT Support</h2></a><p class="company-name">Druga firma</p><p>Rad od kuće</p></div>
 <a href="/oglasi-za-posao-it?page=2">Sledeća</a></div></body></html>`;
const items = harvestLinks(infostud, 'https://poslovi.infostud.com/oglasi-za-posao-it', /poslovi\.infostud\.com\/posao\/[^/]+\/[^/]+\/\d+/);
assert.equal(items.length, 2);
assert.equal(items[0].title, 'Junior React Developer');
assert.equal(items[0].company, 'Firma d.o.o.');
assert.match(items[0].location, /Beograd/);
console.log('✓ harvestLinks (Infostud oblik)', items.map(i => i.title));

// 2) JSON-LD detalj
const detail = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"Razvijalec spletnih aplikacij","hiringOrganization":{"@type":"Organization","name":"Kyuroku d.o.o."},"datePosted":"2026-11-10","jobLocation":{"@type":"Place","address":{"addressLocality":"Ljubljana","addressCountry":"SI"}},"description":"<p>Iščemo študenta za razvoj spletnih aplikacij v Reactu in Node.js ter avtomatizacijo podpore z AI orodji. Delo je v Ljubljani, delovni čas 40 ur na teden. Zahtevamo znanje JavaScripta in osnove dela z bazami. Nudimo dobro plačilo in prijetno ekipo, ki bo te naučila veliko novega. Prijava preko e-pošte, kandidat naj priloži življenjepis in kratko predstavitev ter povezavo do portfelja ali GitHub profila.</p>"}]}</script></head><body><h1>x</h1></body></html>`;
const job = extractJob(detail, 'https://example.si/oglas/1');
assert.equal(job.title, 'Razvijalec spletnih aplikacij');
assert.equal(job.company, 'Kyuroku d.o.o.');
assert.match(job.location, /Ljubljana/);
assert.equal(job.lang, 'sl');
console.log('✓ extractJob JSON-LD', job.title, '|', job.location, '| jezik:', job.lang);
assert.equal(detectLang('Tražimo kandidata koji ima iskustvo u radu sa React-om. Nudimo rad od kuće i uslovi su odlični za posao.'), 'sr');
assert.equal(detectLang('We are looking for a developer with experience in React and you will join our team.'), 'en');
console.log('✓ detectLang sr/en');

// 3) keyword score
const s1 = keywordScore({ title: 'Junior React Developer', snippet: 'React, Node.js, student', description: '' }, db.settings, null);
const s2 = keywordScore({ title: 'Senior Java Architect', snippet: '10+ years experience, Deutsch C1 erforderlich', description: '' }, db.settings, null);
assert(s1 > s2 + 30, `${s1} vs ${s2}`);
console.log('✓ keywordScore junior', s1, '> senior', s2);

// 4) lažni Ollama server
const FAKE_PROFILE = { name: 'David Marković', title: 'Full-Stack Developer', email: 'david@example.com', phone: '+381 64 000 000', location: 'Velenje, Slovenija',
  links: [{ label: 'GitHub', url: 'https://github.com/davidmarkovic952-dev' }], summary: 'Developer.',
  skills: [{ group: 'Frontend', items: ['React', 'Vite'] }, { group: 'Backend', items: ['Node.js', 'PostgreSQL'] }],
  experience: [{ role: 'Praktikant', company: 'Steerscape d.o.o.', location: 'Ljubljana', start: '2025', end: '2025', bullets: ['WordPress migracije', 'QA testiranje'] }],
  projects: [{ name: 'Pošiljko', url: '', description: 'SaaS za webshopove', tech: ['React', 'Node.js'] }],
  education: [{ school: 'ŠC Velenje, VSŠ', degree: 'Računalništvo in informatika', start: '2024', end: '' , details: ''}],
  languages: [{ name: 'Srpski', level: 'maternji' }, { name: 'Engleski', level: 'C1' }] };
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const m = JSON.parse(body).messages; const sys = m[0].content; const user = m[1].content;
    let out;
    if (sys.includes('Pretvori tekst CV-a')) out = FAKE_PROFILE;
    else if (sys.includes('Prilagodi kandidatov CV')) out = { cv: { ...FAKE_PROFILE, title: 'Razvijalec spletnih aplikacij', summary: 'Študent računalništva z izkušnjami v Reactu in Node.js.', email: 'WRONG@x.com' }, matchScore: 82, covered: ['React', 'Node.js'], gaps: ['Baze — osnovno'], tips: ['Priloži GitHub'] };
    else if (sys.includes('regruter')) { const ids = [...user.matchAll(/"id":"([a-f0-9]{12})"/g)].map(x => x[1]); out = { results: ids.map(id => ({ id, score: 77, reason: 'Dobar spoj', flags: [], level: 'junior' })) }; }
    else out = { ok: true };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { content: JSON.stringify(out) } }));
  });
}).listen(11555);
db.settings = { ...db.settings, ai: { ...db.settings.ai, order: ['ollama'], ollamaUrl: 'http://127.0.0.1:11555' } };

const { profileFromText, createTailoredCv } = await import('../src/cv.js');
db.profile = await profileFromText('David Marković ... CV tekst '.repeat(5));
assert.equal(db.profile.name, 'David Marković');
console.log('✓ uvoz CV-a → profil');

const entry = await createTailoredCv({ text: detail.replace(/<[^>]+>/g, ' '), title: 'Razvijalec spletnih aplikacij', company: 'Kyuroku', lang: 'auto' });
assert.equal(entry.cv.email, 'david@example.com', 'kontakt mora ostati iz profila');
assert.equal(entry.lang, 'sl');
const pdf = `/tmp/jh-test-data/cv/${entry.file}`;
assert(fs.statSync(pdf).size > 10000);
console.log('✓ prilagođen CV + PDF:', entry.file, fs.statSync(pdf).size, 'bajtova, jezik', entry.lang);

// 5) AI ocena oglasa
const { aiScore } = await import('../src/hunt.js');
const { job: j1 } = db.upsertJob({ id: 'aaaaaaaaaaaa', source: 'test', url: 'https://x/1', title: 'Junior React', snippet: 'x', description: 'React Node '.repeat(60) });
await aiScore([j1.id]);
assert.equal(db.jobs[j1.id].ai.score, 77);
console.log('✓ AI ocena oglasa');

const { closeBrowser } = await import('../src/fetcher.js');
await closeBrowser(); srv.close();
console.log('\nSVI TESTOVI PROŠLI');
process.exit(0);
