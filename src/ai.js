// AI sloj: Gemini (besplatno) → Groq (besplatno) → Ollama (lokalno) → Claude (opciono)
// Svaki poziv traži JSON odgovor. Ako jedan provajder padne ili udari limit, prelazi na sledeći.
import { db } from './db.js';

const lastCall = {};
const MIN_GAP = { gemini: 4500, groq: 2200, ollama: 0, anthropic: 500 };

async function throttle(name) {
  const gap = MIN_GAP[name] || 0;
  const wait = (lastCall[name] || 0) + gap - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall[name] = Date.now();
}

class AiError extends Error {
  constructor(msg, retryable = true) { super(msg); this.retryable = retryable; }
}

async function httpJson(url, opts, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new AiError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

const providers = {
  async gemini(cfg, system, user) {
    if (!cfg.geminiKey) throw new AiError('Gemini ključ nije podešen', true);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent?key=${encodeURIComponent(cfg.geminiKey)}`;
    const data = await httpJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
      })
    });
    const txt = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!txt) throw new AiError('Gemini vratio prazan odgovor');
    return txt;
  },
  async groq(cfg, system, user) {
    if (!cfg.groqKey) throw new AiError('Groq ključ nije podešen', true);
    const data = await httpJson('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.groqKey}` },
      body: JSON.stringify({
        model: cfg.groqModel,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    });
    return data?.choices?.[0]?.message?.content || '';
  },
  async ollama(cfg, system, user) {
    let data;
    try {
      data = await httpJson(`${cfg.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.ollamaModel, stream: false, format: 'json',
          options: { temperature: 0.4, num_ctx: 16384 },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      }, 300000);
    } catch (e) {
      throw new AiError(`Ollama nije dostupan (${e.message})`, true);
    }
    return data?.message?.content || '';
  },
  async anthropic(cfg, system, user) {
    if (!cfg.anthropicKey) throw new AiError('Claude ključ nije podešen', true);
    const data = await httpJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: cfg.anthropicModel, max_tokens: 8000, system: system + '\nOdgovori ISKLJUČIVO validnim JSON-om.',
        messages: [{ role: 'user', content: user }]
      })
    });
    return data?.content?.map(c => c.text || '').join('') || '';
  }
};

export function parseJsonLoose(txt) {
  if (typeof txt !== 'string') return txt;
  let s = txt.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch {}
  const start = Math.min(...['{', '['].map(c => s.indexOf(c)).filter(i => i >= 0));
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (Number.isFinite(start) && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error('AI nije vratio validan JSON');
}

export function configuredProviders() {
  const cfg = db.settings.ai;
  return cfg.order.filter(p => p === 'ollama' || cfg[`${p}Key`]);
}

/** Pozovi AI i vrati parsiran JSON. */
export async function askJson(system, user, { log = () => {} } = {}) {
  const cfg = db.settings.ai;
  const order = [...cfg.order];
  if (cfg.anthropicKey && !order.includes('anthropic')) order.push('anthropic');
  const errors = [];
  for (const name of order) {
    const fn = providers[name];
    if (!fn) continue;
    if (name !== 'ollama' && !cfg[`${name}Key`]) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await throttle(name);
        const txt = await fn(cfg, system, user);
        const out = parseJsonLoose(txt);
        return { data: out, provider: name };
      } catch (e) {
        errors.push(`${name}: ${e.message}`);
        log(`AI ${name} greška: ${e.message.slice(0, 160)}`);
        const is429 = /HTTP 429/.test(e.message);
        if (is429 && attempt === 0) { await new Promise(r => setTimeout(r, 15000)); continue; }
        break;
      }
    }
  }
  throw new Error('Nijedan AI provajder nije uspeo. Podesi besplatan Gemini ključ u Podešavanjima.\n' + errors.join('\n'));
}

export async function testProvider(name) {
  const cfg = db.settings.ai;
  const txt = await providers[name](cfg, 'Ti si test.', 'Vrati JSON: {"ok": true}');
  return parseJsonLoose(txt);
}
