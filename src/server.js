import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { db, saveNow, CV_DIR } from './db.js';
import { runHunt, huntState, aiScore, jobScore, SOURCES, enrichDescription, keywordScore } from './hunt.js';
import { fileToText, profileFromText, normalizeProfile, createTailoredCv, buildPdf, removeCvFile } from './cv.js';
import { testProvider, configuredProviders } from './ai.js';
import { closeBrowser } from './fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });
const PORT = +process.env.PORT || 4321;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/cv-files', express.static(CV_DIR));

const wrap = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { console.error(e); res.status(400).json({ error: e.message }); }
};

const publicSettings = () => {
  const s = structuredClone(db.settings);
  for (const k of ['geminiKey', 'groqKey', 'anthropicKey']) s.ai[k] = s.ai[k] ? '••••' + s.ai[k].slice(-4) : '';
  return s;
};

app.get('/api/state', wrap(() => ({
  profile: db.profile,
  settings: publicSettings(),
  sources: SOURCES.map(s => ({ id: s.id, name: s.name, region: s.region })),
  aiReady: configuredProviders(),
  counts: Object.values(db.jobs).reduce((a, j) => { a[j.status] = (a[j.status] || 0) + 1; a.total++; return a; }, { total: 0 })
})));

// ---------- profil ----------
app.put('/api/profile', wrap(req => { db.profile = normalizeProfile(req.body); return db.profile; }));

app.post('/api/profile/import', upload.single('file'), wrap(async req => {
  const text = req.file ? await fileToText(req.file.buffer, req.file.originalname) : (req.body.text || '');
  if (text.trim().length < 50) throw new Error('Nisam uspeo da pročitam tekst iz fajla.');
  const parsed = await profileFromText(text);
  const prev = db.profile || {};
  db.profile = { ...parsed, photo: prev.photo || '', preferences: prev.preferences || '' };
  return db.profile;
}));

app.post('/api/profile/photo', upload.single('file'), wrap(req => {
  if (!req.file) throw new Error('Nema slike');
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  db.profile = { ...(db.profile || normalizeProfile({})), photo: dataUrl };
  return { ok: true };
}));

// ---------- podešavanja ----------
app.put('/api/settings', wrap(req => {
  const incoming = req.body;
  const cur = db.settings;
  for (const k of ['geminiKey', 'groqKey', 'anthropicKey']) {
    if (incoming.ai && (incoming.ai[k] || '').startsWith('••••')) incoming.ai[k] = cur.ai[k];
  }
  db.settings = { ...cur, ...incoming, ai: { ...cur.ai, ...incoming.ai }, search: { ...cur.search, ...incoming.search } };
  return publicSettings();
}));

app.post('/api/ai/test/:name', wrap(async req => ({ result: await testProvider(req.params.name) })));

// ---------- lov na oglase ----------
app.post('/api/hunt', wrap(() => { runHunt(); return { started: true }; }));
app.get('/api/hunt/status', wrap(() => huntState));

app.get('/api/jobs', wrap(req => {
  const { q = '', status = '', source = '', minScore = 0, remote = '', sort = 'score' } = req.query;
  const qq = q.toLowerCase();
  let jobs = Object.values(db.jobs).filter(j =>
    (!status || j.status === status) &&
    (!source || j.source === source) &&
    (!remote || j.remote) &&
    jobScore(j) >= +minScore &&
    (!qq || `${j.title} ${j.company} ${j.location} ${j.snippet}`.toLowerCase().includes(qq))
  );
  jobs.sort(sort === 'date'
    ? (a, b) => (Date.parse(b.datePosted || b.firstSeen) || 0) - (Date.parse(a.datePosted || a.firstSeen) || 0)
    : (a, b) => jobScore(b) - jobScore(a));
  return jobs.slice(0, 500).map(j => ({ ...j, description: undefined, hasDescription: !!j.description, score: jobScore(j) }));
}));

app.get('/api/jobs/:id', wrap(req => db.jobs[req.params.id] || Promise.reject(new Error('Nema oglasa'))));
app.patch('/api/jobs/:id', wrap(req => {
  const patch = {};
  for (const k of ['status', 'note']) if (k in req.body) patch[k] = req.body[k];
  if (patch.status === 'poslato') patch.appliedAt = new Date().toISOString();
  return db.updateJob(req.params.id, patch);
}));
app.delete('/api/jobs/:id', wrap(req => { db.deleteJob(req.params.id); return { ok: true }; }));
app.post('/api/jobs/:id/score', wrap(async req => {
  await enrichDescription(db.jobs[req.params.id]);
  await aiScore([req.params.id], { force: true });
  return db.jobs[req.params.id];
}));
app.post('/api/jobs/rescore', wrap(async req => {
  const ids = (req.body.ids || []).slice(0, 60);
  for (const j of Object.values(db.jobs)) db.updateJob(j.id, { kwScore: keywordScore(j, db.settings, db.profile) });
  if (ids.length) aiScore(ids, { force: true });
  return { ok: true };
}));
app.post('/api/jobs/cleanup', wrap(() => {
  let n = 0;
  for (const j of Object.values(db.jobs)) if (j.status === 'odbačeno') { db.deleteJob(j.id); n++; }
  return { removed: n };
}));

// ---------- CV ----------
app.post('/api/cv', wrap(req => createTailoredCv(req.body)));
app.get('/api/cvs', wrap(() => db.cvs.map(c => ({ ...c, cv: undefined }))));
app.get('/api/cvs/:id', wrap(req => db.cvs.find(c => c.id === req.params.id) || Promise.reject(new Error('Nema CV-a'))));
app.put('/api/cvs/:id', wrap(async req => {
  const entry = db.cvs.find(c => c.id === req.params.id);
  if (!entry) throw new Error('Nema CV-a');
  if (req.body.cv) entry.cv = normalizeProfile({ ...req.body.cv, photo: entry.cv.photo });
  if (req.body.lang) entry.lang = req.body.lang;
  if (req.body.accent) entry.accent = req.body.accent;
  await buildPdf(entry);
  saveNow();
  return { ...entry, v: Date.now() };
}));
app.delete('/api/cvs/:id', wrap(req => {
  const entry = db.cvs.find(c => c.id === req.params.id);
  if (entry) removeCvFile(entry);
  db.deleteCv(req.params.id);
  return { ok: true };
}));
app.post('/api/cvs/:id/reveal', wrap(req => {
  const entry = db.cvs.find(c => c.id === req.params.id);
  if (entry && process.platform === 'darwin') exec(`open -R "${path.join(CV_DIR, entry.file)}"`);
  return { ok: true };
}));

const server = app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Job Hunter radi na ${url}\n  (zatvori ovaj prozor ili Ctrl+C da ugasiš)\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) exec(`open ${url}`);
});

const shutdown = async () => { saveNow(); await closeBrowser(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
