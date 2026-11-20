// ===== Job Hunter frontend =====
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let STATE = null;
let SOURCES = {};

async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.body && !(o.body instanceof FormData)) { o.body = JSON.stringify(o.body); o.headers = { 'content-type': 'application/json' }; }
  const res = await fetch(path, o);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Greška ${res.status}`);
  return data;
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), err ? 9000 : 3500);
}
function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Radim…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
const fmtDate = d => d ? new Date(d).toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const scoreClass = s => s >= 70 ? 's-good' : s >= 50 ? 's-mid' : 's-bad';

// ---------- tabovi ----------
$$('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(name) {
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  ({ jobs: loadJobs, cvs: loadCvs, applied: loadApplied, profile: renderProfile, settings: renderSettings })[name]?.();
}

async function loadState() {
  STATE = await api('/api/state');
  SOURCES = Object.fromEntries(STATE.sources.map(s => [s.id, s]));
  const sel = $('#f-source');
  if (sel.options.length === 1) STATE.sources.forEach(s => sel.add(new Option(s.name, s.id)));
  $('#cnt-novo').textContent = STATE.counts.novo || '';
  const ai = STATE.aiReady;
  $('#ai-status').innerHTML = ai.length
    ? `AI: <b style="color:#86efac">${ai.join(' → ')}</b>`
    : `<b style="color:#fca5a5">AI nije podešen</b><br>Dodaj besplatan Gemini ključ u Podešavanjima.`;
  if (!STATE.profile?.name) $('#ai-status').innerHTML += `<br><br><b style="color:#fcd34d">Profil je prazan</b><br>Uvezi CV u „Moj profil".`;
}

// ---------- OGLASI ----------
['#f-q', '#f-status', '#f-source', '#f-remote', '#f-sort'].forEach(s => $(s).addEventListener(s === '#f-q' ? 'input' : 'change', debounce(loadJobs, 250)));
$('#f-min').oninput = e => { $('#f-min-v').textContent = e.target.value; debounce(loadJobs, 250)(); };
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadJobs() {
  const p = new URLSearchParams({
    q: $('#f-q').value, status: $('#f-status').value, source: $('#f-source').value,
    minScore: $('#f-min').value, remote: $('#f-remote').checked ? '1' : '', sort: $('#f-sort').value
  });
  const jobs = await api('/api/jobs?' + p);
  const list = $('#jobs-list');
  if (!jobs.length) {
    list.innerHTML = `<div class="empty">Nema oglasa za ove filtere.<br>Klikni <b>„Skupi nove oglase"</b> ili smanji minimalnu ocenu.</div>`;
    return;
  }
  list.innerHTML = jobs.map(jobCard).join('');
}

function jobCard(j) {
  const s = j.score ?? 0;
  const ai = j.ai;
  return `<div class="job st-${esc(j.status)}" data-id="${j.id}">
    <div class="score ${scoreClass(s)}" title="${ai ? 'AI ocena' : 'Ocena po ključnim rečima'}">${s}<small>${ai ? 'AI' : 'kw'}</small></div>
    <div>
      <h4><a href="${esc(j.url)}" target="_blank">${esc(j.title)}</a></h4>
      <div class="meta">
        ${j.company ? `<span>🏢 ${esc(j.company)}</span>` : ''}
        ${j.location ? `<span>📍 ${esc(j.location)}</span>` : ''}
        ${j.remote ? '<span class="tag">remote</span>' : ''}
        ${j.salary ? `<span>💶 ${esc(j.salary)}</span>` : ''}
        <span>${esc(SOURCES[j.source]?.name || j.source)}</span>
        ${j.datePosted ? `<span>🗓 ${fmtDate(j.datePosted)}</span>` : ''}
        ${j.status !== 'novo' ? `<span class="tag st">${esc(j.status)}</span>` : ''}
        ${ai?.level ? `<span class="tag st">${esc(ai.level)}</span>` : ''}
      </div>
      ${ai?.reason ? `<div class="reason">🤖 ${esc(ai.reason)} ${(ai.flags || []).map(f => `<span class="tag flag">${esc(f)}</span>`).join(' ')}</div>` : `<div class="snippet">${esc(j.snippet)}</div>`}
    </div>
    <div class="actions">
      <button class="primary small" data-act="cv">Napravi CV</button>
      <button class="small" data-act="view">Opis</button>
      ${!ai ? '<button class="small" data-act="score">AI oceni</button>' : ''}
      ${j.status !== 'sačuvano' ? '<button class="small" data-act="st" data-v="sačuvano">★ Sačuvaj</button>' : ''}
      ${j.status !== 'poslato' ? '<button class="small" data-act="st" data-v="poslato">✓ Poslao sam</button>' : ''}
      ${j.status !== 'odbačeno' ? '<button class="small ghost" data-act="st" data-v="odbačeno">✕ Odbaci</button>' : '<button class="small ghost" data-act="st" data-v="novo">↺ Vrati</button>'}
    </div>
  </div>`;
}

$('#jobs-list').onclick = e => jobAction(e, loadJobs);
$('#applied-list').onclick = e => jobAction(e, loadApplied);

async function jobAction(e, reload) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'st') { await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status: btn.dataset.v } }); reload(); loadState(); }
    if (act === 'score') { busy(btn, true, '…'); await api(`/api/jobs/${id}/score`, { method: 'POST' }); reload(); }
    if (act === 'view') viewJob(id);
    if (act === 'cv') { showTab('newcv'); makeCv({ jobId: id }); }
  } catch (err) { toast(err.message, true); busy(btn, false); }
}

async function viewJob(id) {
  const j = await api(`/api/jobs/${id}`);
  openModal(`<h2>${esc(j.title)}</h2><p class="muted">${esc(j.company)} · ${esc(j.location)} · <a href="${esc(j.url)}" target="_blank">otvori oglas ↗</a></p>
    ${j.ai ? `<p>🤖 <b>${j.ai.score}/100</b> — ${esc(j.ai.reason)}</p>` : ''}
    <div class="desc-text">${esc(j.description || j.snippet || 'Opis još nije preuzet — klikni „AI oceni" ili „Napravi CV" i preuzeće se.')}</div>`);
}

// lov
$('#btn-hunt').onclick = async () => {
  if (!STATE.profile?.name) toast('Savet: prvo uvezi CV u „Moj profil" — ocene će biti mnogo tačnije.');
  try { await api('/api/hunt', { method: 'POST' }); pollHunt(); } catch (e) { toast(e.message, true); }
};
$('#hunt-hide').onclick = () => $('#hunt-box').classList.add('hidden');
async function pollHunt() {
  $('#hunt-box').classList.remove('hidden');
  $('#btn-hunt').disabled = true;
  const st = await api('/api/hunt/status');
  $('#hunt-stage').textContent = st.running ? (st.stage || 'Skupljam…') : 'Gotovo';
  $('#hunt-spin').classList.toggle('done', !st.running);
  $('#hunt-counts').textContent = `${st.found} pregledano · ${st.added} novih`;
  const log = $('#hunt-log'); log.textContent = st.log.join('\n'); log.scrollTop = log.scrollHeight;
  if (st.running) { if (st.added) debounce(loadJobs, 100)(); setTimeout(pollHunt, 1500); }
  else { $('#btn-hunt').disabled = false; loadJobs(); loadState(); }
}

// ---------- NOVI CV ----------
$('#btn-make-cv').onclick = () => {
  const url = $('#cv-url').value.trim();
  const text = $('#cv-text').value.trim();
  if (!url && !text) return toast('Unesi link oglasa ili nalepi tekst.', true);
  makeCv({ url, text, title: $('#cv-title').value, company: $('#cv-company').value });
};

async function makeCv(body) {
  const btn = $('#btn-make-cv');
  body.lang = $('#cv-lang').value;
  busy(btn, true, 'Pravim CV… (20–60 s)');
  $('#cv-result').innerHTML = `<div class="card"><span class="spinner" style="display:inline-block"></span> Čitam oglas i prilagođavam CV…</div>`;
  try {
    const entry = await api('/api/cv', { method: 'POST', body });
    renderCvResult(entry);
    loadState();
  } catch (e) {
    $('#cv-result').innerHTML = `<div class="card" style="border-color:#fca5a5">❌ ${esc(e.message)}</div>`;
    if (/nalepi|pročitam/i.test(e.message)) $('#cv-paste-wrap').open = true;
  } finally { busy(btn, false); }
}

function renderCvResult(entry, v = Date.now()) {
  const pdf = `/cv-files/${encodeURIComponent(entry.file)}?v=${v}`;
  $('#cv-result').innerHTML = `<div class="result">
    <div>
      <div class="card">
        <div class="muted">Poklapanje sa oglasom</div>
        <div class="big-score" style="color:${entry.matchScore >= 70 ? 'var(--good)' : entry.matchScore >= 50 ? 'var(--mid)' : 'var(--bad)'}">${entry.matchScore ?? '–'}%</div>
        <div><b>${esc(entry.job.title)}</b> ${entry.job.company ? `· ${esc(entry.job.company)}` : ''}</div>
        <div class="muted">Jezik: ${entry.lang} · AI: ${esc(entry.provider)}</div>
        <div class="row-actions">
          <a href="${pdf}" download="${esc(entry.file)}"><button class="primary">⬇ Preuzmi PDF</button></a>
          <button id="btn-reveal">Prikaži u Finderu</button>
        </div>
      </div>
      ${entry.covered?.length ? `<div class="card"><b>✅ Pokrivaš</b><ul>${entry.covered.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${entry.gaps?.length ? `<div class="card"><b>⚠️ Fali ti (ne piše se u CV)</b><ul>${entry.gaps.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${entry.tips?.length ? `<div class="card"><b>💡 Saveti</b><ul>${entry.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="card">
        <b>Doradi pre slanja</b>
        <label>Naslov (pozicija)</label><input id="ed-title" value="${esc(entry.cv.title)}">
        <label>Profil / sažetak</label><textarea id="ed-summary" rows="6">${esc(entry.cv.summary)}</textarea>
        <details><summary class="muted">Napredno: ceo CV kao JSON</summary><textarea id="ed-json" rows="14" style="font-family:monospace;font-size:11px">${esc(JSON.stringify({ ...entry.cv, photo: undefined }, null, 2))}</textarea></details>
        <div class="row-actions">
          <select id="ed-lang" style="width:auto">${['sl', 'sr', 'en', 'de'].map(l => `<option ${l === entry.lang ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input type="color" id="ed-accent" value="${entry.accent || '#1f4e79'}" style="width:44px;padding:2px">
          <button class="primary" id="btn-rerender">Osveži PDF</button>
        </div>
      </div>
    </div>
    <iframe src="${pdf}"></iframe>
  </div>`;
  $('#btn-reveal').onclick = () => api(`/api/cvs/${entry.id}/reveal`, { method: 'POST' });
  $('#btn-rerender').onclick = async e => {
    let cv;
    try { cv = JSON.parse($('#ed-json').value); } catch { return toast('JSON nije ispravan', true); }
    cv.title = $('#ed-title').value; cv.summary = $('#ed-summary').value;
    busy(e.target, true, 'Osvežavam…');
    try {
      const upd = await api(`/api/cvs/${entry.id}`, { method: 'PUT', body: { cv, lang: $('#ed-lang').value, accent: $('#ed-accent').value } });
      renderCvResult(upd, upd.v);
    } catch (err) { toast(err.message, true); busy(e.target, false); }
  };
  // sinhronizuj JSON sa poljima
  $('#ed-title').oninput = $('#ed-summary').oninput = () => {
    try { const o = JSON.parse($('#ed-json').value); o.title = $('#ed-title').value; o.summary = $('#ed-summary').value; $('#ed-json').value = JSON.stringify(o, null, 2); } catch {}
  };
}

// ---------- CV LISTA ----------
async function loadCvs() {
  const cvs = await api('/api/cvs');
  $('#cvs-list').innerHTML = cvs.length ? cvs.map(c => `<div class="cvrow" data-cv="${c.id}">
    <div><b>${esc(c.job.title || 'Bez naziva')}</b> ${c.job.company ? `· ${esc(c.job.company)}` : ''}
      <div class="meta"><span>${fmtDate(c.createdAt)}</span><span>jezik: ${c.lang}</span><span>poklapanje: ${c.matchScore ?? '–'}%</span>${c.job.url ? `<a href="${esc(c.job.url)}" target="_blank">oglas ↗</a>` : ''}</div></div>
    <div style="display:flex;gap:6px">
      <button class="small" data-a="open">Otvori / doradi</button>
      <a href="/cv-files/${encodeURIComponent(c.file)}" download><button class="small">⬇ PDF</button></a>
      <button class="small danger" data-a="del">Obriši</button>
    </div></div>`).join('') : '<div class="empty">Još nema napravljenih CV-ova.</div>';
}
$('#cvs-list').onclick = async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = b.closest('[data-cv]').dataset.cv;
  if (b.dataset.a === 'del') { if (!confirm('Obrisati ovaj CV?')) return; await api(`/api/cvs/${id}`, { method: 'DELETE' }); loadCvs(); }
  if (b.dataset.a === 'open') { const entry = await api(`/api/cvs/${id}`); showTab('newcv'); renderCvResult(entry); }
};

// ---------- PRIJAVE ----------
async function loadApplied() {
  const a = await api('/api/jobs?status=poslato&minScore=0&sort=date');
  const b = await api('/api/jobs?status=razgovor&minScore=0&sort=date');
  const all = [...b, ...a];
  $('#applied-list').innerHTML = all.length ? all.map(j => `<div class="job" data-id="${j.id}">
    <div class="score ${j.status === 'razgovor' ? 's-good' : 's-mid'}" style="font-size:20px">${j.status === 'razgovor' ? '🗣' : '📬'}</div>
    <div><h4><a href="${esc(j.url)}" target="_blank">${esc(j.title)}</a></h4>
      <div class="meta"><span>🏢 ${esc(j.company)}</span><span>poslato: ${fmtDate(j.appliedAt)}</span><span class="tag st">${j.status}</span></div>
      <textarea class="note" rows="2" placeholder="Beleška…" data-note="${j.id}" style="margin-top:6px">${esc(j.note || '')}</textarea></div>
    <div class="actions">
      ${j.status !== 'razgovor' ? '<button class="small primary" data-act="st" data-v="razgovor">Pozvali me!</button>' : ''}
      <button class="small" data-act="st" data-v="odbačeno">Odbijen</button>
    </div></div>`).join('') : '<div class="empty">Još nema označenih prijava. Na oglasu klikni „✓ Poslao sam".</div>';
  $$('[data-note]').forEach(t => t.onchange = () => api(`/api/jobs/${t.dataset.note}`, { method: 'PATCH', body: { note: t.value } }).then(() => toast('Beleška sačuvana')));
}

// ---------- PROFIL ----------
const PROFILE_FIELDS = [['name', 'Ime i prezime'], ['title', 'Titula (npr. Junior Full-Stack Developer)'], ['email', 'Email'], ['phone', 'Telefon'], ['location', 'Lokacija'], ['birthDate', 'Datum rođenja (opciono)']];
const REPEATS = {
  experience: { label: 'Radno iskustvo', fields: [['role', 'Pozicija'], ['company', 'Firma'], ['location', 'Lokacija'], ['start', 'Od'], ['end', 'Do'], ['bullets', 'Šta si radio (svaki red = jedna stavka)', 'lines']] },
  projects: { label: 'Projekti', fields: [['name', 'Naziv'], ['url', 'Link'], ['description', 'Opis', 'text'], ['tech', 'Tehnologije (zarezom)', 'csv']] },
  education: { label: 'Obrazovanje', fields: [['degree', 'Smer / zvanje'], ['school', 'Škola'], ['start', 'Od'], ['end', 'Do'], ['details', 'Detalji', 'text']] },
  skills: { label: 'Veštine (po grupama)', fields: [['group', 'Grupa (npr. Frontend)'], ['items', 'Veštine (zarezom)', 'csv']] },
  languages: { label: 'Jezici', fields: [['name', 'Jezik'], ['level', 'Nivo']] },
  links: { label: 'Linkovi', fields: [['label', 'Naziv (GitHub, LinkedIn, Portfolio)'], ['url', 'URL']] }
};
let PROFILE = null;

function renderProfile() {
  PROFILE = structuredClone(STATE.profile || { links: [], skills: [], experience: [], projects: [], education: [], languages: [], certifications: [] });
  const p = PROFILE;
  let h = `<div class="card"><h3>Osnovno</h3><div class="grid2">${PROFILE_FIELDS.map(([k, l]) => `<div><label>${l}</label><input data-f="${k}" value="${esc(p[k])}"></div>`).join('')}</div>
    <label>Profesionalni sažetak (osnova — AI ga prilagođava svakom oglasu)</label><textarea data-f="summary" rows="4">${esc(p.summary)}</textarea>
    <label>Šta tražim (AI koristi pri ocenjivanju oglasa)</label><textarea data-f="preferences" rows="2" placeholder="npr. Studentski posao u Ljubljani ili remote, IT/web/AI, 40h nedeljno, ne tražim senior pozicije">${esc(p.preferences)}</textarea>
    <div class="grid2"><div><label>Sertifikati (zarezom)</label><input data-f="certifications" value="${esc((p.certifications || []).join(', '))}"></div>
    <div><label>Interesovanja</label><input data-f="interests" value="${esc(p.interests)}"></div></div>
    <label>Fotografija (opciono — u Sloveniji je česta)</label>
    <div class="with-btn">${p.photo ? `<img src="${p.photo}" style="width:44px;height:44px;border-radius:50%;object-fit:cover">` : ''}<input type="file" id="photo-file" accept="image/*"><button id="btn-photo">Postavi</button>${p.photo ? '<button id="btn-photo-rm" class="danger">Ukloni</button>' : ''}</div>
  </div>`;
  for (const [key, def] of Object.entries(REPEATS)) {
    h += `<div class="card"><div class="section-title"><h3>${def.label}</h3><button class="small" data-add="${key}">+ Dodaj</button></div>`;
    (p[key] || []).forEach((item, i) => {
      h += `<div class="repeat"><button class="small ghost rm" data-rm="${key}" data-i="${i}">✕</button><div class="grid2">`;
      for (const [f, l, type] of def.fields) {
        const v = item[f];
        const val = type === 'lines' ? (v || []).join('\n') : type === 'csv' ? (v || []).join(', ') : v;
        const wide = type === 'lines' || type === 'text';
        h += `<div style="${wide ? 'grid-column:1/-1' : ''}"><label>${l}</label>${wide ? `<textarea rows="${type === 'lines' ? 4 : 2}" data-r="${key}" data-i="${i}" data-k="${f}" data-t="${type}">${esc(val)}</textarea>` : `<input data-r="${key}" data-i="${i}" data-k="${f}" data-t="${type || ''}" value="${esc(val)}">`}</div>`;
      }
      h += `</div></div>`;
    });
    h += `</div>`;
  }
  $('#profile-form').innerHTML = h;
  $('#btn-photo').onclick = async () => {
    const f = $('#photo-file').files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    await api('/api/profile/photo', { method: 'POST', body: fd }); await loadState(); renderProfile(); toast('Slika postavljena');
  };
  const rm = $('#btn-photo-rm'); if (rm) rm.onclick = async () => { collectProfile(); PROFILE.photo = ''; await saveProfile(); };
}

function collectProfile() {
  const p = PROFILE;
  $$('#profile-form [data-f]').forEach(el => { p[el.dataset.f] = el.dataset.f === 'certifications' ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value; });
  $$('#profile-form [data-r]').forEach(el => {
    const { r, i, k, t } = el.dataset;
    p[r][i][k] = t === 'lines' ? el.value.split('\n').map(s => s.replace(/^[•\-–]\s*/, '').trim()).filter(Boolean)
      : t === 'csv' ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value;
  });
  return p;
}
$('#profile-form').onclick = e => {
  const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
  if (!add && !rm) return;
  collectProfile();
  if (add) { const k = add.dataset.add; (PROFILE[k] ||= []).push(Object.fromEntries(REPEATS[k].fields.map(([f, , t]) => [f, t === 'lines' || t === 'csv' ? [] : '']))); }
  if (rm) PROFILE[rm.dataset.rm].splice(+rm.dataset.i, 1);
  STATE.profile = PROFILE; renderProfile();
};
async function saveProfile() {
  STATE.profile = await api('/api/profile', { method: 'PUT', body: collectProfile() });
  await loadState(); renderProfile(); toast('Profil sačuvan ✓');
}
$('#btn-save-profile').onclick = () => saveProfile().catch(e => toast(e.message, true));
$('#btn-import').onclick = async e => {
  const f = $('#cv-import').files[0];
  if (!f) return toast('Izaberi PDF ili DOCX fajl', true);
  if (STATE.profile?.name && !confirm('Ovo će zameniti trenutni profil podacima iz fajla. Nastaviti?')) return;
  const fd = new FormData(); fd.append('file', f);
  busy(e.target, true, 'AI čita CV…');
  try { await api('/api/profile/import', { method: 'POST', body: fd }); await loadState(); renderProfile(); toast('CV uvezen — proveri i dopuni podatke, pa Sačuvaj.'); }
  catch (err) { toast(err.message, true); } finally { busy(e.target, false); }
};

// ---------- PODEŠAVANJA ----------
function renderSettings() {
  const s = STATE.settings;
  for (const k of ['geminiKey', 'geminiModel', 'groqKey', 'groqModel', 'ollamaUrl', 'ollamaModel', 'anthropicKey']) $(`#s-${k}`).value = s.ai[k] || '';
  $('#s-order').value = s.ai.order.join(', ');
  for (const k of ['keywords', 'locations', 'exclude', 'mustHaveAny']) $(`#s-${k}`).value = (s.search[k] || []).join(', ');
  for (const k of ['maxAgeDays', 'maxPerSource', 'aiScoreTop']) $(`#s-${k}`).value = s.search[k];
  $('#s-remoteOnly').checked = s.search.remoteOnly;
  $('#s-sources').innerHTML = STATE.sources.map(src => `<label><input type="checkbox" data-src="${src.id}" ${s.search.sources[src.id] ? 'checked' : ''}> ${esc(src.name)} <span class="muted">${src.region}</span></label>`).join('');
}
const csv = v => v.split(',').map(x => x.trim()).filter(Boolean);
function collectSettings() {
  const ai = {}; for (const k of ['geminiKey', 'geminiModel', 'groqKey', 'groqModel', 'ollamaUrl', 'ollamaModel', 'anthropicKey']) ai[k] = $(`#s-${k}`).value.trim();
  ai.order = csv($('#s-order').value);
  const search = { sources: {} };
  for (const k of ['keywords', 'locations', 'exclude', 'mustHaveAny']) search[k] = csv($(`#s-${k}`).value);
  for (const k of ['maxAgeDays', 'maxPerSource', 'aiScoreTop']) search[k] = +$(`#s-${k}`).value || 0;
  search.remoteOnly = $('#s-remoteOnly').checked;
  $$('[data-src]').forEach(c => search.sources[c.dataset.src] = c.checked);
  return { ai, search };
}
$('#btn-save-settings').onclick = async () => {
  try { STATE.settings = await api('/api/settings', { method: 'PUT', body: collectSettings() }); await loadState(); renderSettings(); toast('Sačuvano ✓'); }
  catch (e) { toast(e.message, true); }
};
$$('[data-test]').forEach(b => b.onclick = async () => {
  busy(b, true, '…');
  try { await api('/api/settings', { method: 'PUT', body: collectSettings() }); await api(`/api/ai/test/${b.dataset.test}`, { method: 'POST' }); toast(`${b.dataset.test}: radi ✓`); await loadState(); }
  catch (e) { toast(`${b.dataset.test}: ${e.message}`, true); } finally { busy(b, false); }
});

// ---------- modal ----------
function openModal(html) { $('#modal-content').innerHTML = html; $('#modal').classList.remove('hidden'); }
$('#modal-close').onclick = () => $('#modal').classList.add('hidden');
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };

// ---------- start ----------
(async () => {
  await loadState();
  if (!STATE.aiReady.length) showTab('settings');
  else if (!STATE.profile?.name) showTab('profile');
  else loadJobs();
  const st = await api('/api/hunt/status');
  if (st.running) pollHunt();
})();
