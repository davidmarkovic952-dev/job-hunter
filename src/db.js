// Jednostavna JSON baza (bez native zavisnosti) — sve se čuva u data/db.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.JH_DATA_DIR || path.join(__dirname, '..', 'data');
export const CV_DIR = path.join(DATA_DIR, 'cv');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(CV_DIR, { recursive: true });

export const DEFAULT_SETTINGS = {
  ai: {
    order: ['gemini', 'groq', 'ollama'],
    geminiKey: '',
    geminiModel: 'gemini-2.5-flash',
    groqKey: '',
    groqModel: 'llama-3.3-70b-versatile',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:7b',
    anthropicKey: '',
    anthropicModel: 'claude-haiku-4-5'
  },
  search: {
    keywords: ['frontend', 'react', 'web developer', 'IT podpora', 'IT support', 'AI', 'automation', 'wordpress', 'junior developer'],
    locations: ['Ljubljana', 'Velenje', 'Remote'],
    sources: {
      studentski: true, mojedelo: true, zaposlitev: true, slotech: true,
      infostud: true, helloworld: true, linkedin: true,
      remotive: true, remoteok: true, arbeitnow: true, jobicy: true, himalayas: true, wwr: true
    },
    exclude: ['senior', 'lead', 'principal', 'head of', '7+ years', '10+ years'],
    mustHaveAny: [],
    remoteOnly: false,
    maxAgeDays: 30,
    maxPerSource: 60,
    aiScoreTop: 40
  }
};

const EMPTY = { profile: null, settings: DEFAULT_SETTINGS, jobs: {}, cvs: [] };

function merge(def, val) {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return val === undefined ? def : val;
  const out = { ...def };
  for (const k of Object.keys(val || {})) out[k] = k in def ? merge(def[k], val[k]) : val[k];
  return out;
}

let state;
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    state = { ...EMPTY, ...raw, settings: merge(DEFAULT_SETTINGS, raw.settings || {}) };
  } catch {
    state = structuredClone(EMPTY);
  }
}
load();

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
export function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const db = {
  get profile() { return state.profile; },
  set profile(p) { state.profile = p; save(); },
  get settings() { return state.settings; },
  set settings(s) { state.settings = merge(DEFAULT_SETTINGS, s); save(); },
  get jobs() { return state.jobs; },
  get cvs() { return state.cvs; },
  upsertJob(job) {
    const prev = state.jobs[job.id];
    state.jobs[job.id] = prev
      ? { ...prev, ...job, status: prev.status, ai: job.ai || prev.ai, firstSeen: prev.firstSeen, description: job.description || prev.description }
      : { status: 'novo', firstSeen: new Date().toISOString(), ...job };
    save();
    return { job: state.jobs[job.id], isNew: !prev };
  },
  updateJob(id, patch) {
    if (!state.jobs[id]) return null;
    state.jobs[id] = { ...state.jobs[id], ...patch };
    save();
    return state.jobs[id];
  },
  deleteJob(id) { delete state.jobs[id]; save(); },
  addCv(entry) { state.cvs.unshift(entry); save(); },
  deleteCv(id) { state.cvs = state.cvs.filter(c => c.id !== id); save(); }
};
