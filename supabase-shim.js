/* Adaptador Supabase: guarda los datos de la app en la tabla "docs" y los archivos exportados en el bucket "archivos" */
window.__LOCAL = true; // habilita Respaldo en Parámetros
(function () {
  const cfg = window.APP_CONFIG || {};
  function fatal(msg) {
    const show = () => { const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:300;display:grid;place-items:center;background:var(--bg);padding:16px';
      el.innerHTML = `<div style="max-width:520px;background:var(--surface);color:var(--ink);border:2px solid var(--crit);border-radius:12px;padding:24px;display:grid;gap:10px;font-size:14px"><b style="font-size:17px">La página no se pudo conectar con Supabase</b><div>${msg}</div><div class="faint">No cargues datos hasta resolverlo: no se guardarían.</div></div>`;
      document.body.appendChild(el); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    window.claude = { use: () => new Promise(() => {}) }; // la app queda esperando, sin trabajar en modo "sin guardado"
  }
  if (!window.APP_CONFIG || !/^https:\/\/.+\.supabase\.co/.test(String(cfg.SUPABASE_URL || '')) || !cfg.SUPABASE_ANON_KEY || /TU-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
    fatal('El archivo <b>config.js</b> tiene un error o está incompleto. La URL y la clave van <b>entre comillas simples</b>, por ejemplo:<pre style="white-space:pre-wrap;font-size:12px;background:var(--surface2);padding:8px;border-radius:6px">SUPABASE_URL: \'https://abcd.supabase.co\',\nSUPABASE_ANON_KEY: \'sb_publishable_xxxx\'</pre>');
    return;
  }
  if (!window.supabase || !window.supabase.createClient) { fatal('No se pudo descargar la librería de Supabase. Revisá la conexión a internet y recargá con Ctrl+F5.'); return; }
  let sb; try { sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); } catch (e) { fatal('Supabase rechazó la configuración: ' + e.message); return; }
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
  function panel(html) {
    let el = document.getElementById('restoreBox');
    if (!el) { el = document.createElement('div'); el.id = 'restoreBox';
      el.style.cssText = 'position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:rgba(0,0,0,.45);padding:16px';
      document.body.appendChild(el); }
    el.innerHTML = `<div style="background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:20px;width:min(440px,100%);display:grid;gap:10px;font-size:14px">${html}</div>`;
    return el;
  }
  window.__restore = async json => {
    let o; try { o = JSON.parse(json); } catch (e) { throw new Error('el archivo no es un respaldo válido'); }
    if (!o['config/params']) throw new Error('no es un respaldo de esta app');
    const entries = Object.entries(o); const fails = [];
    panel(`<b>Restaurando respaldo…</b><div id="rsMsg">Borrando datos anteriores</div>`);
    const { error: e1 } = await sb.from('docs').delete().neq('path', '');
    if (e1) { panel(`<b>No se pudo restaurar</b><div>Supabase no dejó borrar los datos anteriores: ${e1.message}</div><button class="btn" onclick="this.closest('#restoreBox').remove()">Cerrar</button>`); throw new Error(e1.message); }
    for (let i = 0; i < entries.length; i++) {
      const [path, data] = entries[i];
      const m = document.getElementById('rsMsg'); if (m) m.textContent = `Subiendo ${i + 1} de ${entries.length}: ${path}`;
      let ok = false, last = null;
      for (let t = 0; t < 3 && !ok; t++) { const { error } = await sb.from('docs').upsert({ path, data, updated_at: new Date().toISOString() }); if (error) { last = error; await new Promise(r => setTimeout(r, 800)); } else ok = true; }
      if (!ok) fails.push(`${path}: ${last && last.message}`);
    }
    const { count, error: e2 } = await sb.from('docs').select('path', { count: 'exact', head: true });
    const got = e2 ? '?' : count;
    if (fails.length || got !== entries.length) {
      panel(`<b>La restauración quedó incompleta</b><div>Se guardaron ${got} de ${entries.length} registros.</div>${fails.length ? `<pre style="white-space:pre-wrap;font-size:12px;max-height:200px;overflow:auto">${fails.join('\n').replace(/</g, '&lt;')}</pre>` : ''}<div>Sacá una captura de este mensaje para revisarlo.</div><button class="btn" onclick="location.reload()">Cerrar y recargar</button>`);
      throw new Error('restauración incompleta');
    }
    panel(`<b>Respaldo restaurado</b><div>Se guardaron ${got} registros en Supabase. La página se va a recargar.</div>`);
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
