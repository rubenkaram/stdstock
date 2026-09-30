/* Adaptador Supabase: guarda los datos de la app en la tabla "docs" y los archivos exportados en el bucket "archivos" */
window.__LOCAL = true; // habilita Respaldo en Parámetros
(function () {
  const cfg = window.APP_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const mem = new Map(); const listeners = {};
  const err = e => ({ code: 'unavailable', message: (e && e.message) || String(e) });
  const notify = p => { const col = p.split('/').slice(0, -1).join('/'); (listeners[col] || []).forEach(f => f()); };
  async function put(path, data) {
    const v = JSON.parse(JSON.stringify(data)); mem.set(path, v);
    const { error } = await sb.from('docs').upsert({ path, data: v, updated_at: new Date().toISOString() });
    if (error) throw err(error); notify(path);
  }
  async function del(path) {
    mem.delete(path); const { error } = await sb.from('docs').delete().eq('path', path);
    if (error) throw err(error); notify(path);
  }
  const snap = p => { const d = mem.get(p); return { id: p.split('/').pop(), exists: d !== undefined, data: () => d, metadata: { fromCache: false, hasPendingWrites: false } }; };
  const newId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const docRef = p => ({ id: p.split('/').pop(), path: p, get: async () => snap(p), set: d => put(p, d), delete: () => del(p),
    update: async d => { const cur = mem.get(p); if (cur === undefined) throw { code: 'invalid_argument', message: 'no existe' }; await put(p, Object.assign({}, cur, d)); },
    collection: c => colRef(p + '/' + c) });
  function colRef(c) {
    const docsOf = () => [...mem.keys()].filter(k => k.startsWith(c + '/') && k.slice(c.length + 1).indexOf('/') < 0).sort().map(snap);
    return { path: c, doc: id => docRef(c + '/' + (id || newId())),
      add: async d => { const r = docRef(c + '/' + newId()); await r.set(d); return r; },
      get: async () => { const docs = docsOf(); return { docs, size: docs.length, empty: !docs.length }; },
      onSnapshot: next => { const f = () => { const docs = docsOf(); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); };
        (listeners[c] || (listeners[c] = [])).push(f); setTimeout(f, 0); return () => { listeners[c] = listeners[c].filter(x => x !== f); }; } };
  }
  async function loadAll() {
    mem.clear(); let from = 0; const step = 200;
    for (;;) {
      const { data, error } = await sb.from('docs').select('path,data').order('path').range(from, from + step - 1);
      if (error) throw err(error);
      data.forEach(r => mem.set(r.path, r.data)); if (data.length < step) break; from += step;
    }
  }
  const stamp = () => new Date().toISOString().slice(0, 7);
  const downloads = { save: async ({ filename, data }) => {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    const safe = filename.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '-');
    const { error } = await sb.storage.from('archivos').upload(`exportados/${stamp()}/${safe}`, blob, { upsert: true });
    if (error) console.warn('No se pudo subir a Supabase Storage', error);
    return { status: 'saved' };
  } };
  window.__backup = () => JSON.stringify(Object.fromEntries(mem));
  window.__restore = async json => {
    const o = JSON.parse(json); if (!o['config/params']) throw new Error('no es un respaldo de esta app');
    const { error: e1 } = await sb.from('docs').delete().neq('path', ''); if (e1) throw err(e1);
    const rows = Object.entries(o).map(([path, data]) => ({ path, data, updated_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 20) { const { error } = await sb.from('docs').upsert(rows.slice(i, i + 20)); if (error) throw err(error); }
  };

  /* Pantalla de ingreso */
  let resolveReady; const ready = new Promise(r => resolveReady = r);
  const css = `#login{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:var(--bg);padding:16px}#login form{width:min(360px,100%);display:grid;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:24px}#login h2{margin:0}#login label{display:grid;gap:4px;font-size:13px;color:var(--muted)}#login .msg{color:var(--crit);font-size:13px;min-height:1em}#logout{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:30}`;
  function showLogin(msg) {
    let el = document.getElementById('login');
    if (!el) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      el = document.createElement('div'); el.id = 'login';
      el.innerHTML = `<form><h2>Estándar Stock</h2><p class="sub" style="margin:0">Ingresá con tu usuario de Karam.</p><label>Email<input type="text" id="lgEmail" autocomplete="username"></label><label>Contraseña<input type="password" id="lgPass" autocomplete="current-password"></label><div class="msg" id="lgMsg"></div><button class="btn pri" type="submit">Ingresar</button></form>`;
      document.body.appendChild(el);
      el.querySelector('form').addEventListener('submit', async e => { e.preventDefault(); e.stopPropagation();
        document.getElementById('lgMsg').textContent = 'Ingresando…';
        const { error } = await sb.auth.signInWithPassword({ email: document.getElementById('lgEmail').value.trim(), password: document.getElementById('lgPass').value });
        if (error) { document.getElementById('lgMsg').textContent = 'Email o contraseña incorrectos.'; return; }
        start(); }, true);
    }
    document.getElementById('lgMsg').textContent = msg || '';
  }
  async function start() {
    try { await loadAll(); } catch (e) { showLogin('No se pudieron leer los datos: ' + e.message); return; }
    const el = document.getElementById('login'); if (el) el.remove();
    const b = document.createElement('button'); b.id = 'logout'; b.className = 'btn sm'; b.textContent = 'Salir';
    b.onclick = async () => { await sb.auth.signOut(); location.reload(); }; document.body.appendChild(b);
    resolveReady();
  }
  sb.auth.getSession().then(({ data }) => { if (data.session) start(); else showLogin(); });
  window.claude = { use: async n => { await ready; return n === 'db' ? { doc: docRef, collection: colRef } : n === 'downloads' ? downloads : null; } };
})();
