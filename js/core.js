'use strict';
/* ============================================================================
   SIMONIK-LG v2 — core.js : klien REST API (gas-pro-api + gas-instant-ux-pro + gas-scale-turbo)
   - fetch POST body JSON dengan Content-Type text/plain → TANPA CORS preflight (1 RTT).
   - Token sesi dikirim di BODY (bukan query string) agar tidak tercatat di log/riwayat.
   - Aksi tulis membawa reqId → server idempoten, aman di-retry saat sinyal putus.
   - Aksi baca: retry otomatis 1x, dedupe permintaan identik yang sedang berjalan.
   - Server memberi nq>0 bila ada notifikasi antre → klien memicu 'drain' di latar.
   - Warmup ?w=pub|admin saat idle agar respons pertama tidak dingin.
   ============================================================================ */
const API = (function () {
  const URL_ = String((window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '');
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/.test(URL_) && !/GANTI/.test(URL_);
  const WRITE = new Set(['prosesOp', 'buatLaporan', 'gantiSandi', 'simpanProfil', 'simpanPegawai', 'imporPegawai', 'resetSandi', 'simpanMaster',
    'simpanPengaturan', 'unggahLogo', 'simpanRahasia', 'gantiSandiDarurat', 'cabutSesiPengguna', 'notifSimpanConfig', 'notifRetry', 'waBlastCreate',
    'waBlastStop', 'crmSave', 'crmBulk', 'crmInteraksi', 'crmSync', 'crmImport', 'crmMerge', 'migrasiSkema', 'deBuatTemplate', 'deSimpanEngine', 'deTarik']);
  const LONG = new Set(['buatLaporan', 'migrasiImport', 'migrasiImportCsv', 'migrasiArsip', 'imporPegawai', 'crmImport', 'waBlastProcess', 'notifProsesSekarang', 'deBuatTemplate', 'crmSync', 'unggahLogo', 'prosesOp']);
  const inflight = new Map();
  const perf = [];
  let drainT = null;

  function reqId() {
    const a = crypto.getRandomValues(new Uint8Array(10));
    return Date.now().toString(36) + '-' + Array.from(a, b => (b % 36).toString(36)).join('');
  }
  function catat(action, ms, ok) {
    perf.push({ action, ms, ok, t: Date.now() });
    if (perf.length > 60) perf.shift();
  }
  async function kirim(body, timeoutMs) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(URL_, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      try { return JSON.parse(txt); } catch (e) { throw new Error('Respons server bukan JSON. Pastikan deployment "Siapa saja" dan URL /exec benar.'); }
    } finally { clearTimeout(to); }
  }
  function jadwalDrain() {
    clearTimeout(drainT);
    drainT = setTimeout(() => { kirim({ action: 'drain', args: [] }, 30000).catch(() => {}); }, 400);
  }

  /** api('aksi', ...args) → Promise<{success,data,message}>. Reject {network|auth, message}. */
  async function call(action, ...args) {
    if (!configured) throw { network: true, config: true, message: 'Aplikasi belum dihubungkan ke server. Admin: isi GAS_URL di js/config.js.' };
    const write = WRITE.has(action);
    const body = { action, args };
    if (write) body.reqId = reqId();
    const key = write ? null : action + '|' + JSON.stringify(args);
    if (key && inflight.has(key)) return inflight.get(key);
    const timeout = LONG.has(action) ? 120000 : 25000;
    const p = (async () => {
      const t0 = performance.now();
      let lastErr;
      for (let i = 0; i < 2; i++) {
        try {
          const r = await kirim(body, timeout);
          catat(action, Math.round(performance.now() - t0), !!r.success);
          if (typeof window.setOnline === 'function') window.setOnline(true);
          if (r && r.nq) jadwalDrain();
          if (r && r.code === 'AUTH' && !['login', 'loginDarurat'].includes(action)) {
            if (typeof window.sessionLost === 'function') window.sessionLost(r.message);
            throw { auth: true, message: r.message };
          }
          return r || { success: false, message: 'Respons kosong' };
        } catch (e) {
          if (e && e.auth) throw e;
          lastErr = e;
          if (!navigator.onLine) break;
          if (i === 0) await new Promise(res => setTimeout(res, 500));   // reqId sama → server tidak menulis ganda
        }
      }
      catat(action, Math.round(performance.now() - t0), false);
      if (typeof window.setOnline === 'function' && (!navigator.onLine || /abort|fetch|network|Failed/i.test(String(lastErr && lastErr.message)))) window.setOnline(false);
      throw { network: true, message: lastErr && lastErr.name === 'AbortError' ? 'Waktu tunggu server habis. Coba lagi.' : 'Tidak dapat terhubung ke server.' };
    })();
    if (key) { inflight.set(key, p); p.finally(() => inflight.delete(key)); }
    return p;
  }

  /** Beberapa aksi baca dalam 1 eksekusi Apps Script (maks 8). calls = [{key, action, args}] */
  async function batch(calls) {
    const r = await call('batch', calls);
    return r.success ? r.data : {};
  }

  async function get(params) {
    if (!configured) throw { network: true, config: true, message: 'Server belum dikonfigurasi.' };
    const q = new URLSearchParams(params).toString();
    const res = await fetch(URL_ + '?' + q, { redirect: 'follow' });
    return res.json();
  }

  function warmup(scope) {
    if (!configured) return;
    try {
      const k = 'warm_' + scope, last = +sessionStorage.getItem(k) || 0;
      if (Date.now() - last < 4 * 60000) return;
      sessionStorage.setItem(k, String(Date.now()));
    } catch (e) { /* abaikan */ }
    fetch(URL_ + '?w=' + scope, { redirect: 'follow' }).catch(() => {});
  }

  return { call, batch, get, warmup, configured, perf, url: URL_ };
})();

/** Bentuk lama tetap dipakai di seluruh app.js: api('aksi', ...args) */
function api(action, ...args) { return API.call(action, ...args); }
