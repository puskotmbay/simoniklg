'use strict';
/* ============================================================================
   SIMONIK-LG v2 — app.js (frontend GitHub Pages, backend GAS REST API via core.js)
   Prinsip kecepatan (gas-instant-ux-pro + gas-scale-turbo):
   1. SPA: semua halaman sudah ada di DOM → pindah menu 0 ms, data dari memori.
   2. Optimistic UI: setiap aksi langsung tampil, disimpan ke IndexedDB, lalu
      dikirim di latar belakang lewat antrean (sekaligus menjadi mode offline).
   3. Snapshot lokal: buka aplikasi → tampil instan dari data terakhir, lalu
      disegarkan dari server (1 panggilan bootstrap).
   4. Filter/cari/rekap dihitung lokal; server hanya untuk perubahan & delta.
   5. Sinkron berversi: klien mengirim ver → bila sama, server menjawab tanpa membaca Sheets.
   ============================================================================ */

// ─── KONSTANTA & STATE ──────────────────────────────────────────────────────
const TZ = 'Asia/Makassar';
const MAX_FILES = 3;
const MAX_TOTAL = 5 * 1024 * 1024;
const LS_TOKEN = 'simonik_token', LS_THEME = 'simonik_theme', LS_OFFSET = 'simonik_offset';
const LIBS = {
  qr: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  leaflet: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
};
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const BLN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const HARI = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

const S = {
  token: null, user: null, cfg: {}, master: { lokasi: [], jenis: [] }, pegawai: [],
  keg: new Map(), loadedFrom: null, stats: null, hapusHariIni: 0,
  offset: +(safeLS(LS_OFFSET) || 0), lastSync: '', serverToday: '', ver: '',
  online: navigator.onLine, syncing: false, outbox: [], flushing: false,
  route: null, params: {}, history: [],
  charts: {}, maps: {}, timers: {}, thumbs: {}, localFiles: {},
  gps: { state: 'idle', pos: null, error: '', watch: null },
  ui: {
    riwayat: { q: '', chip: 'semua', lokasi: '', jenis: '', limit: 30 },
    data: { q: '', pegawai: '', from: '', to: '', lokasi: '', jenis: '', verif: '', tab: 'semua', page: 1, sel: new Set() },
    verif: { pegawai: '', flagged: false, sel: new Set() },
    peta: { from: '', to: '', jenis: null, pegawai: '', lokasi: '', warn: true },
    dash: { mode: 'bulan', from: '', to: '' },
    laporan: { mode: 'bulanan', pegawai: '', tanggal: '', bulan: '', foto: true },
    pegawaiQ: '', pegawaiPeran: '', masterTab: 'lokasi', logQ: '', logAksi: ''
  },
  logs: null, arsip: null
};

function safeLS(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; }
}

// ─── UTILITAS ───────────────────────────────────────────────────────────────
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, cls) => `<i class="bi bi-${n}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fmtD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const nowMs = () => Date.now() + S.offset;
const dateStr = ms => fmtD.format(new Date(ms));
const timeStr = ms => fmtT.format(new Date(ms));
const todayStr = () => dateStr(nowMs());
const nowStamp = () => todayStr() + ' ' + timeStr(nowMs());
function addDays(d, n) { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd + n, 12)); return t.toISOString().slice(0, 10); }
function hariOf(d) { const [y, m, dd] = d.split('-').map(Number); return HARI[new Date(Date.UTC(y, m - 1, dd, 12)).getUTCDay()]; }
function tglIndo(d, short) { if (!d) return '-'; const [y, m, dd] = d.split('-'); return `${+dd} ${(short ? BLN : BULAN)[+m - 1]} ${y}`; }
function kegStartMs(r) { return Date.parse(`${r.Tanggal}T${r.Jam_Mulai || '00:00:00'}+08:00`); }
function durasi(a, b) {
  if (!a || !b) return '';
  const toM = s => { const p = s.split(':'); return +p[0] * 60 + +p[1]; };
  let m = toM(b) - toM(a); if (m < 0) m += 1440;
  return (m >= 60 ? Math.floor(m / 60) + 'j ' : '') + (m % 60) + 'm';
}
function hhmm(s) { return s ? s.slice(0, 5) : '–'; }
function initials(n) { return String(n || '?').replace(/^(dr|drg|ns|h|hj)\.?\s+/i, '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function haversine(a, b, c, d) {
  if ([a, b, c, d].some(x => x === '' || x == null || isNaN(+x))) return null;
  const R = 6371000, r = Math.PI / 180, dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function fmtJarak(m) { return m == null ? '-' : m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
function rand(n) { const c = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; const a = crypto.getRandomValues(new Uint8Array(n)); for (let i = 0; i < n; i++) s += c[a[i] % c.length]; return s; }
function genId() { return 'KGT-' + todayStr().replace(/-/g, '') + '-' + rand(6); }
function greetWord() { const h = +timeStr(nowMs()).slice(0, 2); return h < 11 ? 'Selamat Pagi' : h < 15 ? 'Selamat Siang' : h < 18 ? 'Selamat Sore' : 'Selamat Malam'; }
function isDesktop() { return window.matchMedia('(min-width:1024px)').matches; }
function isStaff() { return S.user && S.user.peran !== 'Pegawai'; }
function isAdmin() { return S.user && S.user.peran === 'Admin'; }

const jenisLabel = r => r.Jenis_Kegiatan === 'Lainnya' ? (r.Jenis_Lainnya || 'Lainnya') : r.Jenis_Kegiatan;
const lokasiLabel = r => r.Lokasi === 'Lainnya' ? (r.Lokasi_Lainnya || 'Lainnya') : r.Lokasi;
function lokasiFull(r) {
  if (r.Lokasi === 'Lainnya') return r.Lokasi_Lainnya || 'Lainnya';
  const m = S.master.lokasi.find(x => x.nama === r.Lokasi);
  return (m && m.tipe === 'Kelurahan' ? 'Kelurahan ' : m && m.tipe === 'Desa' ? 'Desa ' : '') + r.Lokasi;
}
function jenisInfo(name) {
  const m = S.master.jenis.find(x => x.nama === name) || S.master.jenis.find(x => x.nama === 'Lainnya');
  return m || { warna: '#64748B', ikon: 'three-dots' };
}
function flagsOf(r) { return String(r.Peringatan || '').split('|').filter(Boolean); }

// ─── LIB LAZY LOAD (Chart.js & Leaflet hanya dimuat saat diperlukan) ──────
const _libP = {};
function loadLib(k) {
  if (k === 'chart' && window.Chart) return Promise.resolve();
  if (k === 'leaflet' && window.L) return Promise.resolve();
  if (k === 'qr' && window.qrcode) return Promise.resolve();
  if (_libP[k]) return _libP[k];
  _libP[k] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIBS[k]; s.async = true;
    s.onload = () => res(); s.onerror = () => { delete _libP[k]; rej(new Error('Gagal memuat pustaka ' + k)); };
    document.head.appendChild(s);
  });
  return _libP[k];
}

// ─── INDEXEDDB (outbox, draf, snapshot) ─────────────────────────────────────
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise(res => {
      try {
        const rq = indexedDB.open('simonik_lg', 1);
        rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('kv'); d.createObjectStore('outbox', { keyPath: 'id' }); };
        rq.onsuccess = () => { this.db = rq.result; res(this.db); };
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async tx(store, mode, fn) {
    const d = await this.open(); if (!d) return null;
    return new Promise(res => {
      try {
        const t = d.transaction(store, mode); const st = t.objectStore(store); const rq = fn(st);
        t.oncomplete = () => res(rq ? rq.result : null); t.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  put(store, val, key) { return this.tx(store, 'readwrite', s => key === undefined ? s.put(val) : s.put(val, key)); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
  all(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); }
};

const saveSnapshot = debounce(() => {
  if (!S.user) return;
  DB.put('kv', {
    uid: S.user.id, user: S.user, cfg: S.cfg, master: S.master, pegawai: S.pegawai, stats: S.stats,
    keg: Array.from(S.keg.values()), loadedFrom: S.loadedFrom, lastSync: S.lastSync, ver: S.ver, hapusHariIni: S.hapusHariIni,
    hapusDay: todayStr(), savedAt: Date.now()
  }, 'snapshot');
}, 600);

// ─── TOAST, MODAL, DRAWER, KONFIRMASI ───────────────────────────────────────
function toast(type, title, msg, ms) {
  const icons = { success: 'check-circle-fill', error: 'x-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.setAttribute('role', 'status');
  el.innerHTML = `${ic(icons[type] || icons.info)}<div class="grow"><b>${esc(title)}</b>${msg ? `<span class="text-sm muted">${esc(msg)}</span>` : ''}</div>`;
  $('#toasts').appendChild(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  el.addEventListener('click', kill);
  setTimeout(kill, ms || (type === 'error' ? 6000 : 3500));
  const all = $$('#toasts .toast'); if (all.length > 3) all[0].remove();
}

function openModal({ title, body, foot, size, dismissable = true, onOpen }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grabber"></div>
    <div class="modal-head"><h3>${esc(title)}</h3>${dismissable ? `<button class="icon-btn" data-close aria-label="Tutup">${ic('x-lg')}</button>` : ''}</div>
    <div class="modal-body">${body || ''}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  $('#modalRoot').appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if ((e.target === back && dismissable) || e.target.closest('[data-close]')) close(); });
  const m = { el: back, close, $: s => $(s, back) };
  if (onOpen) onOpen(m);
  setTimeout(() => { const f = back.querySelector('input,textarea,select'); if (f && !('ontouchstart' in window)) f.focus(); }, 60);
  return m;
}

function openDrawer({ title, body, foot, onOpen }) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="drawer-back"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head" style="border-bottom:1px solid var(--border);padding-bottom:14px"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Tutup">${ic('x-lg')}</button></div>
    <div class="modal-body" style="flex:1;padding-top:16px">${body}</div><div class="modal-foot">${foot || ''}</div></aside>`;
  $('#modalRoot').appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target.classList.contains('drawer-back') || e.target.closest('[data-close]')) close(); });
  const m = { el: wrap, close, $: s => $(s, wrap) };
  if (onOpen) onOpen(m);
  return m;
}

function confirmDialog({ title, message, okText = 'Ya, lanjutkan', danger = false, icon = 'question-circle' }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title,
      body: `<div class="row" style="align-items:flex-start;gap:14px"><div class="kpi ic ${danger ? 'ic-red' : 'ic-amber'}" style="padding:0;border:0;box-shadow:none;width:44px;height:44px;flex:none;display:grid;place-items:center;border-radius:12px">${ic(icon)}</div><p style="padding-top:4px">${message}</p></div>`,
      foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" id="cfOk">${esc(okText)}</button>`,
      onOpen: mm => mm.$('#cfOk').addEventListener('click', () => { done = true; mm.close(); resolve(true); })
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($('#modalRoot'), { childList: true });
  });
}

function btnLoading(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.html = btn.innerHTML; btn.classList.add('is-loading'); btn.innerHTML = `<span class="spin"></span> ${esc(text || 'Memproses…')}`; }
  else { btn.classList.remove('is-loading'); if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

function downloadBase64(b64, name, mime) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: mime || 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
function b64ToUrl(b64, mime) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

function emptyState(icon, title, text, action) {
  return `<div class="empty"><div class="em-ic">${ic(icon)}</div><h4>${esc(title)}</h4><p class="text-sm">${esc(text || '')}</p>${action || ''}</div>`;
}

// ─── TEMA ───────────────────────────────────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  safeLS(LS_THEME, next);
  syncThemeIcons();
  if (['dashboard'].includes(S.route)) renderCurrent();
  if (S.route === 'akun') renderCurrent();
}
function syncThemeIcons() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $$('[data-action="theme"] i').forEach(i => { i.className = 'bi bi-' + (dark ? 'sun' : 'moon'); });
  $$('.side-link[data-action="theme"] span').forEach(s => { s.textContent = dark ? 'Mode Terang' : 'Mode Gelap'; });
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0B1410' : '#15803D');
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ─── STATUS KONEKSI ─────────────────────────────────────────────────────────
function setOnline(v) {
  if (S.online === v) return;
  S.online = v;
  updateStatusBar();
  if (v) flushOutbox();
}
function updateStatusBar() {
  const bar = $('#statusbar'); if (!bar) return;
  const pend = S.outbox.length;
  bar.classList.toggle('offline', !S.online);
  bar.classList.toggle('syncing', S.flushing || S.syncing);
  let t;
  if (!S.online) t = pend ? `Offline — ${pend} data menunggu dikirim` : 'Offline — data tersimpan di HP';
  else if (S.flushing) t = `Mengirim ${pend} data ke server…`;
  else if (pend) t = `Online — ${pend} data dalam antrean`;
  else t = S.user && S.user.peran === 'Pegawai'
    ? (S.gps.state === 'ok' ? `Online — GPS aktif (±${Math.round(S.gps.pos.acc)} m)` : `Online — Kec. ${S.cfg.kecamatan || 'Aesesa'}`)
    : `Online — tersinkron ${S.lastSync ? S.lastSync.slice(11, 16) + ' WITA' : ''}`;
  $('#statusText').textContent = t;
  const dot = $('#syncBtn .dot');
  if (dot) { dot.hidden = false; dot.classList.toggle('warn', !S.online || pend > 0); }
  $$('[data-badge="antrean"]').forEach(b => { b.textContent = pend; b.hidden = !pend; });
}

// ─── DATA STORE ─────────────────────────────────────────────────────────────
function pendingIds() {
  const s = new Set();
  S.outbox.forEach(o => { if (o.data.id) s.add(o.data.id); (o.data.ids || []).forEach(i => s.add(i)); });
  return s;
}
function mergeRows(rows, opts = {}) {
  if (!rows || !rows.length) return 0;
  const pend = opts.force ? new Set() : pendingIds();
  let n = 0;
  rows.forEach(r => {
    if (pend.has(r.ID_Kegiatan)) return;
    if (r.Dihapus === 'TRUE' && !isAdmin()) { if (S.keg.delete(r.ID_Kegiatan)) n++; return; }
    S.keg.set(r.ID_Kegiatan, r); n++;
  });
  if (n) saveSnapshot();
  return n;
}
function allRows() { return Array.from(S.keg.values()); }
function liveRows() { return allRows().filter(r => r.Dihapus !== 'TRUE'); }
function myRows() { return liveRows().filter(r => r.ID_Pegawai === S.user.id); }
function activeKeg() { return myRows().find(r => r.Status_Kegiatan === 'Berlangsung'); }
const byNewest = (a, b) => (b.Tanggal + b.Jam_Mulai).localeCompare(a.Tanggal + a.Jam_Mulai);

// ─── ANTREAN (OUTBOX) — optimistic & offline ───────────────────────────────
const OP_LABEL = { mulai: 'Mulai Kegiatan', selesai: 'Selesai Kegiatan', ubah: 'Ubah Catatan', hapus: 'Hapus Kegiatan', verifikasi: 'Verifikasi' };

async function enqueue(type, data, label) {
  const ids = data.ids || (data.id ? [data.id] : []);
  const prev = {};
  ids.forEach(id => { const r = S.keg.get(id); prev[id] = r ? JSON.parse(JSON.stringify(r)) : null; });
  const op = { id: 'op_' + Date.now() + '_' + rand(4), type, data, label: label || OP_LABEL[type], created: nowMs(), createdStr: nowStamp(), tries: 0, prev };
  applyLocal(op);
  S.outbox.push(op);
  await DB.put('outbox', op);
  saveSnapshot();
  updateStatusBar();
  renderNavState();
  flushOutbox();
  return op;
}

function applyLocal(op) {
  const d = op.data, u = S.user;
  if (op.type === 'mulai') {
    S.keg.set(d.id, {
      ID_Kegiatan: d.id, ID_Pegawai: u.id, NIP: u.nip, Nama: u.nama, Jabatan: u.jabatan,
      Tanggal: dateStr(d.t), Hari: hariOf(dateStr(d.t)), Jam_Mulai: timeStr(d.t),
      Lat_Mulai: (+d.lat).toFixed(6), Lng_Mulai: (+d.lng).toFixed(6), Akurasi_Mulai: Math.round(d.acc),
      Jam_Selesai: '', Lokasi: d.lokasi, Lokasi_Lainnya: d.lokasiLainnya, Tempat_Spesifik: d.tempat,
      Jenis_Kegiatan: d.jenis, Jenis_Lainnya: d.jenisLainnya, Uraian_Kegiatan: '', Keterangan: '',
      Berkas: [], Jumlah_Berkas: '0', Status_Kegiatan: 'Berlangsung', Status_Verifikasi: 'Tercatat',
      Mode_Input: S.online ? 'Online' : 'Offline', Peringatan: d.acc > 200 ? 'Akurasi GPS rendah' : '', Dihapus: 'FALSE', _pending: true
    });
  } else if (op.type === 'selesai') {
    const r = S.keg.get(d.id); if (!r) return;
    Object.assign(r, {
      Jam_Selesai: timeStr(d.t), Lat_Selesai: (+d.lat).toFixed(6), Lng_Selesai: (+d.lng).toFixed(6), Akurasi_Selesai: Math.round(d.acc),
      Uraian_Kegiatan: d.uraian, Keterangan: d.keterangan, Status_Kegiatan: 'Selesai',
      Berkas: d.files.map((f, i) => ({ id: 'local_' + i, name: f.name, mime: f.mime, size: f.size, source: f.source, flag: f.flag, local: true })),
      Jumlah_Berkas: String(d.files.length), Sumber_Foto: [...new Set(d.files.map(f => f.source))].join(', '),
      Peringatan: [flagsOf(r), d.files.some(f => f.source === 'Galeri') ? ['Foto dari Galeri'] : [], d.files.map(f => f.flag).filter(Boolean)].flat().filter((v, i, a) => a.indexOf(v) === i).join('|'),
      _pending: true
    });
    S.localFiles[d.id] = d.files.map(f => ({ name: f.name, mime: f.mime, url: f.preview || null }));
  } else if (op.type === 'ubah') {
    const r = S.keg.get(d.id); if (!r) return;
    const f = d.fields, map = { lokasi: 'Lokasi', lokasiLainnya: 'Lokasi_Lainnya', tempat: 'Tempat_Spesifik', jenis: 'Jenis_Kegiatan', jenisLainnya: 'Jenis_Lainnya', uraian: 'Uraian_Kegiatan', keterangan: 'Keterangan' };
    Object.keys(map).forEach(k => { if (f[k] !== undefined) r[map[k]] = f[k]; });
    if (f.restore) { r.Dihapus = 'FALSE'; r.Alasan_Hapus = ''; }
    r._pending = true;
  } else if (op.type === 'hapus') {
    const r = S.keg.get(d.id); if (!r) return;
    if (isAdmin()) { r.Dihapus = 'TRUE'; r.Alasan_Hapus = d.alasan; r._pending = true; }
    else S.keg.delete(d.id);
    if (S.user.peran === 'Pegawai') S.hapusHariIni++;
  } else if (op.type === 'verifikasi') {
    d.ids.forEach(id => {
      const r = S.keg.get(id); if (!r) return;
      r.Status_Verifikasi = 'Diverifikasi'; r.Diverifikasi_Oleh = u.nama + (u.nip ? ` (${u.nip})` : ''); r.Tgl_Verifikasi = nowStamp();
      if (d.catatan) r.Catatan_Kapus = d.catatan; r._pending = true;
    });
  }
}

function rollback(op) {
  Object.keys(op.prev || {}).forEach(id => { const p = op.prev[id]; if (p) S.keg.set(id, p); else S.keg.delete(id); });
  if (op.type === 'hapus' && S.user.peran === 'Pegawai') S.hapusHariIni = Math.max(0, S.hapusHariIni - 1);
  saveSnapshot();
}

async function removeOp(op) {
  S.outbox = S.outbox.filter(o => o.id !== op.id);
  await DB.del('outbox', op.id);
}

let _retryTimer = null;
async function flushOutbox() {
  if (S.flushing || !S.outbox.length || !S.token) return;
  S.flushing = true; updateStatusBar();
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      let r;
      try {
        r = await api('prosesOp', S.token, { type: op.type, data: op.data });
      } catch (e) {
        if (e.auth) break;
        op.tries++; op.lastError = e.message; DB.put('outbox', op);
        clearTimeout(_retryTimer);
        _retryTimer = setTimeout(flushOutbox, Math.min(60000, 5000 * op.tries));
        break;
      }
      await removeOp(op);
      if (r.success) {
        const rows = (r.data && r.data.rows) || [];
        rows.forEach(x => { delete x._pending; });
        if (op.type === 'selesai') delete S.localFiles[op.data.id];
        mergeRows(rows);
        if (op.type === 'mulai' || op.type === 'selesai') {
          if (S.route === 'beranda' || S.route === 'riwayat') toast('success', op.type === 'mulai' ? 'Mulai kegiatan terkirim' : 'Laporan kegiatan terkirim', op.type === 'selesai' ? 'Notifikasi telah dikirim ke Admin & Kapus.' : '');
        }
      } else {
        rollback(op);
        toast('error', `${op.label} gagal`, r.message);
      }
      renderCurrent(true);
    }
  } finally {
    S.flushing = false; updateStatusBar(); renderNavState();
    if (S.route === 'antrean') renderCurrent();
  }
}

// ─── SINKRON DELTA & POLLING ────────────────────────────────────────────────
async function syncNow(manual) {
  if (!S.token || S.syncing) return;
  S.syncing = true; updateStatusBar();
  const btn = $('#syncBtn i'); if (btn) btn.classList.add('spin-ic');
  try {
    await flushOutbox();
    const r = await api('sinkron', S.token, S.lastSync, S.outbox.length ? '' : S.ver);
    if (r.success) {
      applyServerClock(r.data);
      const n = r.data.same ? 0 : mergeRows(r.data.rows);
      if (r.data.stats) S.stats = r.data.stats;
      if (r.data.hapusHariIni !== undefined) S.hapusHariIni = r.data.hapusHariIni;
      if (!r.data.same) S.lastSync = r.data.serverNow;
      S.ver = r.data.ver || '';
      saveSnapshot();
      if (n || manual) renderCurrent(true);
      if (manual) toast('success', 'Data sudah terbaru', n ? `${n} perubahan diterima.` : 'Tidak ada perubahan baru.');
    }
  } catch (e) {
    if (manual && !e.auth) toast('warning', 'Tidak dapat terhubung', 'Data tetap tersimpan di HP dan akan dikirim saat sinyal kembali.');
  } finally {
    S.syncing = false; updateStatusBar();
    if (btn) btn.classList.remove('spin-ic');
  }
}
function applyServerClock(d) {
  if (!d || !d.serverTime) return;
  S.offset = d.serverTime - Date.now();
  if (Math.abs(S.offset) < 1500) S.offset = 0;
  safeLS(LS_OFFSET, String(S.offset));
  S.serverToday = d.today;
}
setInterval(() => { if (S.token && document.visibilityState === 'visible' && S.online) syncNow(false); }, 45000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token) syncNow(false); });
window.addEventListener('online', () => { setOnline(true); syncNow(false); });
window.addEventListener('offline', () => setOnline(false));

// ─── BOOT, LOGIN, SESI ──────────────────────────────────────────────────────
async function boot() {
  syncThemeIcons();
  bindGlobal();
  S.token = safeLS(LS_TOKEN) || sessionStorageGet();
  S.outbox = ((await DB.all('outbox')) || []).sort((a, b) => a.created - b.created);
  if (PUB.handleHash()) return;               // #/cek/KODE, #/darurat → halaman publik
  if (!S.token) { if (/^#\/masuk/.test(location.hash)) showLogin(); else PUB.showLanding(); return; }
  API.warmup('admin');

  const snap = await DB.get('kv', 'snapshot');
  if (snap && snap.user) {
    loadSnapshot(snap);
    enterApp();        // tampil instan dari data lokal
  }
  try {
    const r = await api('bootstrap', S.token);
    if (!r.success) { if (!snap) { showLogin(r.message); } return; }
    applyBootstrap(r.data);
    if (!snap) enterApp(); else { buildChrome(); renderCurrent(true); }
    if (r.data.mustChange) forceChangePassword();
    flushOutbox();
  } catch (e) {
    if (e.auth) return;
    if (!snap) { showLogin('Tidak dapat terhubung ke server. Periksa sinyal internet lalu coba lagi.'); }
    else toast('warning', 'Mode offline', 'Menampilkan data terakhir di HP. Isian baru akan dikirim saat online.');
  }
}
function sessionStorageGet() { try { return sessionStorage.getItem(LS_TOKEN); } catch (e) { return null; } }

function loadSnapshot(s) {
  S.user = s.user; S.cfg = s.cfg || {}; S.master = s.master || S.master; S.pegawai = s.pegawai || [];
  S.stats = s.stats; S.loadedFrom = s.loadedFrom; S.lastSync = s.lastSync || ''; S.ver = S.outbox.length ? '' : (s.ver || '');
  S.hapusHariIni = s.hapusDay === todayStr() ? (s.hapusHariIni || 0) : 0;
  S.keg = new Map((s.keg || []).map(r => [r.ID_Kegiatan, r]));
  S.outbox.forEach(applyLocal); // pastikan perubahan yang belum terkirim tetap tampil
}

function applyBootstrap(d) {
  applyServerClock(d);
  S.user = d.user; S.cfg = d.config || {}; S.master = d.master; S.pegawai = d.pegawai || [];
  S.stats = d.stats || null; S.loadedFrom = d.loadedFrom; S.hapusHariIni = d.hapusHariIni || 0; S.lastSync = d.serverNow; S.ver = d.ver || '';
  // Baris lama di luar rentang muat dipertahankan (riwayat yang sudah pernah dibuka)
  const keep = Array.from(S.keg.values()).filter(r => r.Tanggal < d.loadedFrom && !r._pending);
  S.keg = new Map(keep.map(r => [r.ID_Kegiatan, r]));
  d.kegiatan.forEach(r => S.keg.set(r.ID_Kegiatan, r));
  S.outbox.forEach(applyLocal);
  saveSnapshot();
}

function showLogin(msg) {
  $('#boot').classList.add('out');
  $('#app').hidden = true;
  PUB.hideAll();
  if (!/^#\/masuk/.test(location.hash)) history.replaceState(null, '', '#/masuk');
  setTimeout(() => { try { $('#lgUser').focus(); } catch (e) {} }, 60);
  $('#screen-login').hidden = false;
  if (msg) { const e = $('#lgError'); e.hidden = false; $('span', e).textContent = msg; }
  if (S.cfg && (S.cfg.logoPemda || S.cfg.logoPuskesmas)) renderLoginLogos();
}
function renderLoginLogos() {
  const a = S.cfg.logoPemda ? `<img src="${S.cfg.logoPemda}" alt="Logo Pemda">` : ic('bank');
  const b = S.cfg.logoPuskesmas ? `<img src="${S.cfg.logoPuskesmas}" alt="Logo Puskesmas">` : ic('hospital');
  $('#loginLogos').innerHTML = `<div class="lg">${a}</div><div class="lg">${b}</div>`;
}

async function doLogin(e) {
  e.preventDefault();
  const u = $('#lgUser').value.trim(), p = $('#lgPass').value, btn = $('#lgBtn'), err = $('#lgError');
  err.hidden = true;
  if (!u || !p) { err.hidden = false; $('span', err).textContent = 'Isi username dan kata sandi.'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Memeriksa…';
  try {
    const r = await api('login', u, p, navigator.userAgent.slice(0, 140));
    if (!r.success) { err.hidden = false; $('span', err).textContent = r.message; return; }
    await masukDenganToken(r.data, $('#lgRemember').checked);
    $('#lgPass').value = '';
    toast('success', r.message);
  } catch (x) {
    err.hidden = false; $('span', err).textContent = x.message && !/^Server/.test(x.message) ? x.message : 'Tidak dapat terhubung ke server.';
  } finally { btn.disabled = false; btn.innerHTML = 'Masuk ' + ic('arrow-right'); }
}

/** Login mengembalikan token + data boot dalam SATU respons (hemat 1 RTT). */
async function masukDenganToken(d, ingat) {
  S.token = d.token;
  if (ingat) safeLS(LS_TOKEN, S.token); else { try { sessionStorage.setItem(LS_TOKEN, S.token); } catch (x) {} }
  await DB.clear('kv');
  S.keg = new Map();
  let boot = d.boot;
  if (!boot) { const b = await api('bootstrap', S.token); if (!b.success) throw new Error(b.message); boot = b.data; }
  applyBootstrap(boot);
  history.replaceState(null, '', '#/app');
  enterApp();
  if (d.mustChange || boot.mustChange) forceChangePassword();
}

async function doLogout() {
  if (S.outbox.length) {
    const ok = await confirmDialog({ title: 'Masih ada data belum terkirim', message: `${S.outbox.length} data di antrean akan <b>hilang</b> jika Anda keluar sekarang. Tetap keluar?`, okText: 'Tetap Keluar', danger: true, icon: 'exclamation-triangle' });
    if (!ok) return;
  }
  const t = S.token;
  clearSession();
  api('logout', t).catch(() => {});
  history.replaceState(null, '', '#/');
  PUB.showLanding();
}
function clearSession() {
  S.token = null; S.user = null; S.keg = new Map(); S.outbox = []; S.history = []; S.route = null; S.ver = ''; S.arsip = null; S.adm = {};
  safeLS(LS_TOKEN, null); try { sessionStorage.removeItem(LS_TOKEN); } catch (e) {}
  DB.clear('kv'); DB.clear('outbox');
  stopPageWork();
  Object.values(S.charts).forEach(c => c.destroy && c.destroy()); S.charts = {};
  Object.values(S.maps).forEach(m => m.remove && m.remove()); S.maps = {};
}
function sessionLost(msg) {
  if (!S.token) return;
  clearSession();
  showLogin(msg || 'Sesi berakhir. Silakan masuk kembali.');
}

function forceChangePassword() {
  const m = openModal({
    title: 'Ganti Kata Sandi', dismissable: false,
    body: `<div class="alert info mb-16">${ic('info-circle-fill')}<span>Demi keamanan, silakan ganti kata sandi awal Anda sebelum menggunakan aplikasi.</span></div>${pwFormHtml()}`,
    foot: `<button class="btn btn-primary btn-block" id="pwSave">Simpan &amp; Lanjutkan ${ic('check2')}</button>`,
    onOpen: mm => bindPwForm(mm, true)
  });
  return m;
}
function pwFormHtml() {
  return `<div class="stack-16">
    <div class="field"><label for="pwOld">Kata Sandi Lama</label><input class="input" type="password" id="pwOld" autocomplete="current-password"></div>
    <div class="field"><label for="pwNew">Kata Sandi Baru</label><input class="input" type="password" id="pwNew" autocomplete="new-password">
      <div class="progress" id="pwMeter"><i style="width:0"></i></div><span class="help" id="pwHint">Minimal 8 karakter, kombinasi huruf &amp; angka.</span></div>
    <div class="field"><label for="pwNew2">Ulangi Kata Sandi Baru</label><input class="input" type="password" id="pwNew2" autocomplete="new-password"></div>
    <div class="field-error" id="pwErr" hidden></div></div>`;
}
function bindPwForm(m, forced) {
  const meter = m.$('#pwMeter'), hint = m.$('#pwHint');
  m.$('#pwNew').addEventListener('input', e => {
    const v = e.target.value; let s = 0;
    if (v.length >= 8) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) s++;
    meter.firstElementChild.style.width = (s * 25) + '%';
    meter.className = 'progress' + (s <= 1 ? ' bad' : s === 2 ? ' warn' : '');
    hint.textContent = ['Terlalu pendek', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'][s];
  });
  m.$('#pwSave').addEventListener('click', async ev => {
    const a = m.$('#pwOld').value, b = m.$('#pwNew').value, c = m.$('#pwNew2').value, err = m.$('#pwErr');
    err.hidden = true;
    const fail = t => { err.hidden = false; err.innerHTML = ic('exclamation-circle') + ' ' + esc(t); };
    if (!a || !b) return fail('Lengkapi semua kolom.');
    if (b.length < 8) return fail('Kata sandi baru minimal 8 karakter.');
    if (b !== c) return fail('Ulangi kata sandi baru tidak sama.');
    btnLoading(ev.currentTarget, true, 'Menyimpan…');
    try {
      const r = await api('gantiSandi', S.token, a, b);
      if (!r.success) return fail(r.message);
      m.close(); toast('success', 'Kata sandi diganti', 'Gunakan kata sandi baru saat masuk berikutnya.');
    } catch (x) { fail(x.message || 'Gagal terhubung.'); }
    finally { btnLoading(ev.currentTarget, false); }
  });
}

// ─── SHELL APLIKASI: sidebar, bottom nav, header ────────────────────────────
function enterApp() {
  PUB.hideAll();
  $('#screen-login').hidden = true;
  $('#app').hidden = false;
  $('#boot').classList.add('out');
  buildChrome();
  const def = S.user.peran === 'Pegawai' ? 'beranda' : 'dashboard';
  go(S.route && canAccess(S.route) ? S.route : def, S.route ? S.params : {}, { replace: true });
  // Pra-muat pustaka saat idle agar peta tetap jalan meski nanti offline
  const idle = window.requestIdleCallback || (f => setTimeout(f, 1200));
  idle(() => { loadLib('leaflet').catch(() => {}); if (isStaff()) loadLib('chart').catch(() => {}); });
}

function buildChrome() {
  const u = S.user, app = $('#app');
  app.dataset.role = u.peran;
  $('#topAvatar').textContent = initials(u.nama);
  $('#topSub').textContent = S.cfg.namaInstansi ? titleCase(S.cfg.namaInstansi) : 'UPTD Puskesmas Kota';
  $('#sideInstansi').textContent = $('#topSub').textContent;
  if (S.cfg.logoPuskesmas) { $('#topLogo').innerHTML = `<img src="${S.cfg.logoPuskesmas}" alt="">`; $('#sideLogo').innerHTML = `<img src="${S.cfg.logoPuskesmas}" alt="">`; }
  $('#menuBtn').hidden = u.peran === 'Pegawai';
  $('#sideUser').innerHTML = `<div class="avatar sm">${esc(initials(u.nama))}</div><div class="grow"><div class="fw-6 text-sm ellipsis">${esc(u.nama)}</div><div class="text-xs" style="opacity:.7">${esc(u.peran)}</div></div>`;
  renderNavState();
  syncThemeIcons();
  updateStatusBar();
}
function titleCase(s) { return String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bUptd\b/, 'UPTD'); }

const ROUTES = {
  beranda: { title: 'Beranda', roles: ['Pegawai', 'Admin'] },
  mulai: { title: 'Form Mulai', roles: ['Pegawai', 'Admin'], back: true, form: true },
  selesai: { title: 'Form Selesai', roles: ['Pegawai', 'Admin'], back: true, form: true },
  riwayat: { title: 'Riwayat', roles: ['Pegawai', 'Admin'] },
  detail: { title: 'Detail Kegiatan', back: true },
  antrean: { title: 'Antrean Pengiriman', back: true },
  laporan: { title: 'Laporan' },
  akun: { title: 'Akun Saya' },
  dashboard: { title: 'Dashboard', roles: ['Kapus', 'Admin'] },
  data: { title: 'Data Kegiatan', roles: ['Kapus', 'Admin'] },
  verifikasi: { title: 'Verifikasi', roles: ['Kapus', 'Admin'] },
  peta: { title: 'Peta Sebaran', roles: ['Kapus', 'Admin'] },
  pegawai: { title: 'Kelola Pegawai', roles: ['Admin'] },
  master: { title: 'Data Master', roles: ['Admin'] },
  pengaturan: { title: 'Pengaturan Instansi', roles: ['Admin'] },
  log: { title: 'Log Aktivitas', roles: ['Admin'] },
  // v2 (admin.js)
  notifikasi: { title: 'WA & Notifikasi', roles: ['Admin'] },
  crm: { title: 'CRM Kontak', roles: ['Admin'] },
  dokumen: { title: 'Dokumen & Verifikasi', roles: ['Kapus', 'Admin'] },
  migrasi: { title: 'Migrasi Data', roles: ['Admin'] },
  keamanan: { title: 'Keamanan', roles: ['Admin'] }
};
const RENDER = {};
function canAccess(name) { const r = ROUTES[name]; return r && (!r.roles || r.roles.includes(S.user.peran)); }

function go(name, params = {}, opts = {}) {
  if (!ROUTES[name]) return;
  if (!canAccess(name)) { toast('warning', 'Akses ditolak', 'Menu ini tidak tersedia untuk peran Anda.'); return; }
  if (S.route && !opts.replace && !opts.noHistory && S.route !== name) S.history.push({ name: S.route, params: S.params });
  if (opts.clearHistory) S.history = [];
  stopPageWork();
  S.route = name; S.params = params || {};
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'pg-' + name));
  const R = ROUTES[name];
  $('#topbar').classList.toggle('has-back', !!R.back);
  $('#topBrand').querySelector('#topTitle').textContent = R.back ? R.title : 'SIMONIK-LG';
  $('#topSub').textContent = R.back ? 'SIMONIK-LG' : (S.cfg.namaInstansi ? titleCase(S.cfg.namaInstansi) : 'UPTD Puskesmas Kota');
  $('#pageTitle').textContent = R.title;
  $('#statusPage').textContent = R.title;
  $('#app').classList.toggle('form-mode', !!R.form);
  setSticky(null);
  closeSidebar();
  renderNavState();
  renderCurrent();
  window.scrollTo(0, 0);
}
function back() {
  const prev = S.history.pop();
  if (prev) go(prev.name, prev.params, { noHistory: true });
  else go(S.user.peran === 'Pegawai' ? 'beranda' : 'dashboard', {}, { noHistory: true });
}
function renderCurrent(soft) {
  if (!S.route || !S.user) return;
  const fn = RENDER[S.route];
  if (!fn) return;
  // Halaman formulir tidak di-render ulang otomatis agar isian tidak terganggu
  if (soft && ROUTES[S.route].form) return;
  try { fn(S.params, soft); } catch (e) { console.error(e); $('#pg-' + S.route).innerHTML = emptyState('bug', 'Terjadi kesalahan tampilan', e.message); }
}
function stopPageWork() {
  Object.keys(S.timers).forEach(k => { clearInterval(S.timers[k]); delete S.timers[k]; });
  stopGps();
}
function setSticky(html) {
  const el = $('#stickyActions');
  if (!html) { el.hidden = true; $('#stickyInner').innerHTML = ''; return; }
  $('#stickyInner').innerHTML = html; el.hidden = false;
}

function navItemsBottom() {
  const u = S.user, act = (u.peran !== 'Kapus') && activeKeg();
  if (u.peran === 'Pegawai') {
    return [
      { go: 'beranda', icon: 'house-door', label: 'Beranda' },
      { go: 'riwayat', icon: 'clock-history', label: 'Riwayat' },
      { fab: true, go: act ? 'selesai' : 'mulai', icon: act ? 'stop-fill' : 'play-fill', label: act ? 'Selesai' : 'Kegiatan', stop: !!act },
      { go: 'laporan', icon: 'file-earmark-text', label: 'Laporan' },
      { go: 'akun', icon: 'person', label: 'Akun', badge: 'antrean' }
    ];
  }
  return [
    { go: 'dashboard', icon: 'grid-1x2', label: 'Dashboard' },
    { go: 'data', icon: 'table', label: 'Data' },
    { go: 'verifikasi', icon: 'patch-check', label: 'Verifikasi', count: verifQueue().length },
    { go: 'peta', icon: 'map', label: 'Peta' },
    { action: 'menu', icon: 'list', label: 'Menu' }
  ];
}
function renderNavState() {
  if (!S.user) return;
  const r = S.route;
  $('#bottomnavInner').innerHTML = navItemsBottom().map(n => {
    if (n.fab) return `<button class="nav-fab ${n.stop ? 'stop' : ''}" data-go="${n.go}" aria-label="${n.label}"><span class="fab">${ic(n.icon)}</span>${n.label}</button>`;
    const active = r === n.go || (n.go === 'riwayat' && r === 'detail' && S.user.peran === 'Pegawai') || (n.go === 'data' && r === 'detail');
    const attr = n.action ? `data-action="${n.action}"` : `data-go="${n.go}"`;
    const b = n.badge ? `<span class="badge" data-badge="${n.badge}" hidden>0</span>` : n.count ? `<span class="badge accent">${n.count > 99 ? '99+' : n.count}</span>` : '';
    return `<button class="nav-item ${active ? 'active' : ''}" ${attr}>${ic(n.icon)}<span>${n.label}</span>${b}</button>`;
  }).join('');
  if (S.user.peran !== 'Pegawai') {
    const vq = verifQueue().length;
    const L = (go, icon, label, extra) => `<button class="side-link ${r === go ? 'active' : ''}" data-go="${go}">${ic(icon)}<span>${label}</span>${extra || ''}</button>`;
    let h = `<div class="grp">MONITORING</div>` + L('dashboard', 'grid-1x2', 'Dashboard') + L('data', 'table', 'Data Kegiatan') +
      L('verifikasi', 'patch-check', 'Verifikasi', vq ? `<span class="badge">${vq}</span>` : '') + L('peta', 'map', 'Peta Sebaran') + L('laporan', 'file-earmark-pdf', 'Laporan PDF') + L('dokumen', 'qr-code', 'Dokumen Terbit');
    if (isAdmin()) {
      h += `<div class="grp">KEGIATAN SAYA</div>` + L('beranda', 'person-walking', 'Input Lapangan') + L('riwayat', 'clock-history', 'Riwayat Saya');
      h += `<div class="grp">ADMIN</div>` + L('pegawai', 'people', 'Kelola Pegawai') + L('master', 'database', 'Data Master') + L('pengaturan', 'gear', 'Pengaturan') + L('log', 'journal-text', 'Log Aktivitas');
      h += `<div class="grp">INTEGRASI</div>` + L('notifikasi', 'whatsapp', 'WA & Notifikasi') + L('crm', 'person-lines-fill', 'CRM Kontak') + L('migrasi', 'database-up', 'Migrasi Data') + L('keamanan', 'shield-lock', 'Keamanan');
    }
    h += `<div class="grp">AKUN</div>` + L('akun', 'person-circle', 'Akun Saya', `<span class="badge" data-badge="antrean" hidden>0</span>`);
    $('#sideNav').innerHTML = h;
  }
  updateStatusBar();
}
function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

function bindGlobal() {
  $('#formLogin').addEventListener('submit', doLogin);
  $('#lgEye').addEventListener('click', () => { const i = $('#lgPass'); i.type = i.type === 'password' ? 'text' : 'password'; $('#lgEye i').className = 'bi bi-' + (i.type === 'password' ? 'eye' : 'eye-slash'); });
  $('#scrim').addEventListener('click', closeSidebar);
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g && !g.disabled) {
      e.preventDefault();
      const name = g.dataset.go;
      if (name === 'mulai' && activeKeg()) { toast('info', 'Masih ada kegiatan berlangsung', 'Selesaikan kegiatan aktif terlebih dahulu.'); go('selesai'); return; }
      if (name === 'selesai' && !activeKeg()) { go('mulai'); return; }
      go(name, g.dataset.id ? { id: g.dataset.id } : {});
      return;
    }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'theme') toggleTheme();
    else if (act === 'logout') doLogout();
    else if (act === 'back') back();
    else if (act === 'menu') openSidebar();
    else if (act === 'sync') syncNow(true);
  });
  let lastW = window.innerWidth;
  window.addEventListener('resize', debounce(() => {
    const w = window.innerWidth;
    if ((lastW < 1024) !== (w < 1024) && ['data', 'detail', 'dashboard'].includes(S.route)) renderCurrent(true);
    lastW = w;
    Object.values(S.maps).forEach(m => { try { m.invalidateSize(); } catch (x) {} });
  }, 200));
  window.addEventListener('beforeunload', e => { if (S.outbox.length) { e.preventDefault(); e.returnValue = ''; } });
}

// ─── GPS ────────────────────────────────────────────────────────────────────
function startGps(onUpdate) {
  stopGps();
  S.gps = { state: 'searching', pos: null, error: '', watch: null };
  if (!('geolocation' in navigator)) { S.gps.state = 'error'; S.gps.error = 'Perangkat tidak mendukung GPS.'; onUpdate && onUpdate(); return; }
  S.gps.watch = navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    const pos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() };
    if (!S.gps.pos || pos.acc <= S.gps.pos.acc || Date.now() - S.gps.pos.t > 30000) S.gps.pos = pos;
    S.gps.state = 'ok'; S.gps.error = '';
    onUpdate && onUpdate(); updateStatusBar();
  }, err => {
    if (S.gps.pos) return; // tetap gunakan posisi terakhir yang baik
    S.gps.state = 'error';
    S.gps.error = err.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lokasi untuk aplikasi ini di pengaturan browser.'
      : err.code === 3 ? 'Sinyal GPS lemah. Pindah ke area terbuka lalu coba lagi.' : 'Lokasi tidak aktif. Nyalakan GPS untuk melanjutkan.';
    onUpdate && onUpdate();
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 25000 });
}
function stopGps() {
  if (S.gps && S.gps.watch != null) { try { navigator.geolocation.clearWatch(S.gps.watch); } catch (e) {} S.gps.watch = null; }
}

// ─── PETA KECIL ─────────────────────────────────────────────────────────────
async function miniMap(elId, points, opts = {}) {
  const el = document.getElementById(elId); if (!el) return;
  try { await loadLib('leaflet'); } catch (e) { el.insertAdjacentHTML('beforeend', `<div class="map-empty">${ic('wifi-off')} Peta tidak dapat dimuat saat offline</div>`); return; }
  if (!document.getElementById(elId)) return;
  if (S.maps[elId]) { try { S.maps[elId].remove(); } catch (e) {} }
  const pts = points.filter(p => p && !isNaN(+p.lat) && p.lat !== '' && p.lat != null);
  const center = pts.length ? [+pts[0].lat, +pts[0].lng] : [S.cfg.mapLat || -8.5412, S.cfg.mapLng || 121.3204];
  const map = L.map(el, { zoomControl: !!opts.interactive, dragging: !!opts.interactive, scrollWheelZoom: false, doubleClickZoom: !!opts.interactive, touchZoom: !!opts.interactive, attributionControl: false, keyboard: false }).setView(center, pts.length ? 16 : 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  const latlngs = [];
  pts.forEach(p => {
    const ll = [+p.lat, +p.lng]; latlngs.push(ll);
    L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: p.color || '#15803D', fillOpacity: 1 }).addTo(map).bindTooltip(p.label || '', { direction: 'top' });
    if (p.acc) L.circle(ll, { radius: Math.min(+p.acc, 500), color: p.color || '#15803D', weight: 1, fillOpacity: .08 }).addTo(map);
  });
  if (latlngs.length > 1) { L.polyline(latlngs, { color: '#0EA5E9', weight: 3, dashArray: '6 6' }).addTo(map); map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 17 }); }
  S.maps[elId] = map;
  setTimeout(() => map.invalidateSize(), 80);
}

'use strict';
/* ============================================================================
   HALAMAN PEGAWAI: Beranda, Mulai, Selesai, Riwayat, Detail, Antrean, Laporan, Akun
   ============================================================================ */

// ─── Komponen kecil ─────────────────────────────────────────────────────────
function statusPill(r) {
  if (r.Dihapus === 'TRUE') return `<span class="pill pill-tidak">${ic('trash3')} Terhapus</span>`;
  const s = r.Status_Kegiatan;
  if (s === 'Berlangsung') return `<span class="pill pill-berlangsung pill-dot pulse mono">BERLANGSUNG</span>`;
  if (s === 'Tidak Diselesaikan') return `<span class="pill pill-tidak">${ic('x-circle')} Tidak Diselesaikan</span>`;
  return `<span class="pill pill-selesai">Selesai</span>`;
}
function verifPill(r) {
  if (r.Status_Kegiatan === 'Berlangsung' || r.Dihapus === 'TRUE') return '';
  return r.Status_Verifikasi === 'Diverifikasi' ? `<span class="pill pill-diverifikasi">${ic('check-circle-fill')} Diverifikasi</span>` : `<span class="pill pill-tercatat">Tercatat</span>`;
}
function pendingPill(r) { return r._pending ? `<span class="pill pill-pending">${ic('cloud-arrow-up')} Menunggu dikirim</span>` : ''; }
function catPill(r) {
  const j = jenisInfo(r.Jenis_Kegiatan);
  return `<span class="cat-pill" style="--kc:${j.warna}">${ic(j.ikon)} ${esc(jenisLabel(r))}</span>`;
}

function kcard(r, opts = {}) {
  const j = jenisInfo(r.Jenis_Kegiatan);
  const files = +r.Jumlah_Berkas || (r.Berkas || []).length;
  const lat = r.Lat_Selesai || r.Lat_Mulai, lng = r.Lng_Selesai || r.Lng_Mulai;
  const showName = opts.showName;
  return `<article class="kcard" style="--kc:${j.warna}" data-go="detail" data-id="${esc(r.ID_Kegiatan)}" tabindex="0" role="button" aria-label="Detail kegiatan ${esc(jenisLabel(r))}">
    <span class="chev">${ic('chevron-right')}</span>
    <div class="row wrap gap-4" style="padding-right:36px">${catPill(r)} ${statusPill(r)} ${verifPill(r)} ${pendingPill(r)}</div>
    <div class="ttl">${esc(r.Tempat_Spesifik || jenisLabel(r))}</div>
    ${showName ? `<div class="loc">${ic('person')} ${esc(r.Nama)}</div>` : ''}
    <div class="loc">${ic('geo-alt')} ${esc(lokasiFull(r))}</div>
    <div class="time">${ic('clock')} ${showName ? esc(tglIndo(r.Tanggal, true)) + ' · ' : ''}${hhmm(r.Jam_Mulai)} – ${r.Jam_Selesai ? hhmm(r.Jam_Selesai) + ' WITA (' + durasi(r.Jam_Mulai, r.Jam_Selesai) + ')' : 'berlangsung'}</div>
    ${r.Catatan_Kapus ? `<div class="note"><b>${ic('patch-check')} Catatan Kapus:</b><div class="mt-4" style="font-style:italic">“${esc(r.Catatan_Kapus)}”</div></div>` : ''}
    <div class="foot">
      <span>${ic('paperclip')} ${files} Berkas</span>
      ${lat ? `<span class="hide-sm">${ic('geo')} ${(+lat).toFixed(4)}, ${(+lng).toFixed(4)}</span>` : ''}
      ${r.Mode_Input === 'Offline' ? `<span>${ic('cloud-check')} Sync offline</span>` : ''}
      ${flagsOf(r).length ? `<span style="color:var(--flag-text)">${ic('exclamation-triangle')} ${flagsOf(r).length}</span>` : ''}
      <span style="margin-left:auto;color:var(--primary-text)">Detail ${ic('arrow-right')}</span>
    </div></article>`;
}

// ─── W-03 BERANDA ───────────────────────────────────────────────────────────
RENDER.beranda = function () {
  const u = S.user, act = activeKeg(), today = todayStr(), month = today.slice(0, 7);
  const mine = myRows();
  const hari = mine.filter(r => r.Tanggal === today).length;
  const bulan = mine.filter(r => r.Tanggal.startsWith(month));
  const ver = bulan.filter(r => r.Status_Verifikasi === 'Diverifikasi').length;
  const recent = mine.filter(r => r !== act).sort(byNewest).slice(0, 3);
  const pend = S.outbox.length;

  let actHtml;
  if (act) {
    const flags = flagsOf(act);
    actHtml = `<div class="card stack" style="padding:16px">
      <div class="row-between wrap">${statusPill(act)}<span class="text-xs muted mono">${ic('clock')} Mulai ${hhmm(act.Jam_Mulai)} WITA (otomatis)</span></div>
      <div><div class="card-title" style="font-size:21px;line-height:1.25">${esc(act.Tempat_Spesifik)}</div>
        <div class="row text-sm mt-4" style="color:var(--text-2)">${ic('geo-alt')} ${esc(lokasiFull(act))} · ${esc(jenisLabel(act))}</div></div>
      <div class="timer-box"><div class="overline">Durasi kegiatan lapangan</div><div class="timer tnum" id="timerVal">00:00:00</div>
        <div class="gps-state ok" style="justify-content:center;margin-top:4px">${ic('patch-check')} Akurasi GPS ±${Math.round(act.Akurasi_Mulai || 0)} m · Terkunci ✓</div></div>
      <div class="mini-map" id="mmBeranda"><div class="map-tag"><span>● ${esc(act.Tempat_Spesifik)} · ${(+act.Lat_Mulai).toFixed(4)}, ${(+act.Lng_Mulai).toFixed(4)}</span></div></div>
      ${flags.length ? `<div class="row wrap gap-4">${flags.map(f => `<span class="pill pill-flag">${ic('exclamation-triangle')} ${esc(f)}</span>`).join('')}</div>` : ''}
      <div class="notice">${ic('info-circle')}<span>Jangan lupa menyelesaikan kegiatan sebelum pukul <b>23:59 WITA</b>. Kegiatan yang belum diselesaikan akan ditutup otomatis.</span></div>
      <button class="big-action stop" data-go="selesai"><div><div class="t">SELESAI KEGIATAN ${ic('arrow-right')}</div><div class="s">Isi uraian &amp; unggah 1–3 bukti foto bertimemark</div></div><span class="ic">${ic('check2-circle')}</span></button>
    </div>`;
  } else {
    actHtml = `<button class="big-action start" data-go="mulai"><span class="ic" style="margin:0;background:rgba(255,255,255,.22)">${ic('play-fill')}</span>
      <div><div class="t">MULAI KEGIATAN</div><div class="s">Tekan saat tiba di lokasi tugas — jam &amp; GPS tercatat otomatis</div></div></button>`;
  }

  $('#pg-beranda').innerHTML = `<div class="stack-16">
    <div class="greet">
      <span class="role">${ic('shield-check')} ${u.peran === 'Admin' ? 'Admin Lapangan' : 'Pegawai Lapangan'}</span>
      <div class="hi">${greetWord()}</div>
      <div class="nm">${esc(u.nama)}</div>
      <div class="jb">${esc(u.jabatan)}${u.unit ? ' / ' + esc(u.unit) : ''}</div>
      <div class="meta"><div>${ic('person-vcard')} NIP ${esc(u.nip)}</div><div>${ic('calendar3')} ${hariOf(today)}, ${tglIndo(today, true)}</div></div>
    </div>
    ${actHtml}
    <div><div class="row-between mb-8"><h3 class="section-title">Ringkasan Kinerja</h3><span class="mono text-xs muted">${BULAN[+month.slice(5) - 1]} ${month.slice(0, 4)}</span></div>
      <div class="grid-3">
        <div class="stat"><div class="k">Hari Ini ${ic('calendar-check')}</div><div class="v tnum">${hari}</div><div class="s">${act ? 'Aktif berjalan' : 'kegiatan'}</div></div>
        <div class="stat"><div class="k">Bulan Ini ${ic('flag')}</div><div class="v tnum">${bulan.length}</div><div class="s">Luar gedung</div></div>
        <div class="stat green"><div class="k">Verifikasi ${ic('shield-check')}</div><div class="v tnum">${ver}</div><div class="s">Diverifikasi</div></div>
      </div></div>
    <div><div class="row-between mb-8"><h3 class="section-title">Kegiatan Terakhir</h3><button class="btn btn-ghost btn-sm" data-go="riwayat">Lihat Semua ${ic('chevron-right')}</button></div>
      <div class="stack">${recent.length ? recent.map(r => kcard(r)).join('') : emptyState('person-walking', 'Belum ada kegiatan', 'Tekan "Mulai Kegiatan" saat tiba di lokasi tugas.')}</div></div>
    <div class="sync-card">${ic(pend ? 'cloud-arrow-up' : 'cloud-check')}
      <div class="grow"><div class="fw-6 text-sm">${pend ? pend + ' data menunggu dikirim' : 'Data tersimpan aman'}</div>
      <div class="mono text-xs muted">${pend ? (S.online ? 'Sedang mengirim…' : 'Terkirim otomatis saat sinyal kembali') : 'Sinkron terakhir ' + (S.lastSync ? S.lastSync.slice(11, 16) + ' WITA' : '-')}</div></div>
      <button class="btn btn-accent btn-sm" ${pend ? 'data-go="antrean"' : 'data-action="sync"'}>${pend ? 'Lihat Antrean' : 'Cek Server'}</button></div>
  </div>`;

  if (act) {
    const start = kegStartMs(act);
    const tick = () => {
      const el = $('#timerVal'); if (!el) return;
      let s = Math.max(0, Math.floor((nowMs() - start) / 1000));
      el.textContent = [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':');
    };
    tick(); S.timers.beranda = setInterval(tick, 1000);
    miniMap('mmBeranda', [{ lat: act.Lat_Mulai, lng: act.Lng_Mulai, acc: act.Akurasi_Mulai, label: 'Titik mulai' }]);
  }
};

// ─── W-04 MULAI KEGIATAN ────────────────────────────────────────────────────
function lokasiOptions(sel) {
  const L = S.master.lokasi.filter(x => x.aktif || x.nama === sel);
  const grp = t => L.filter(x => x.tipe === t).map(x => `<option value="${esc(x.nama)}" ${x.nama === sel ? 'selected' : ''}>${esc(x.nama)}</option>`).join('');
  return `<option value="">— Pilih desa / kelurahan —</option><optgroup label="Desa">${grp('Desa')}</optgroup><optgroup label="Kelurahan">${grp('Kelurahan')}</optgroup>
    <option value="Lainnya" ${sel === 'Lainnya' ? 'selected' : ''}>Lainnya (ketik sendiri)</option>`;
}
function jenisChoices(sel) {
  return S.master.jenis.filter(x => x.aktif || x.nama === sel).map(j =>
    `<button type="button" class="choice ${j.nama === 'Lainnya' ? 'full' : ''} ${j.nama === sel ? 'active' : ''}" data-jenis="${esc(j.nama)}" aria-pressed="${j.nama === sel}">
      ${ic(j.ikon, 'ci')}<span>${esc(j.nama === 'Lainnya' ? 'Kegiatan Lainnya' : j.nama)}</span>${ic('check-circle-fill', 'chk')}</button>`).join('');
}

RENDER.mulai = async function () {
  if (activeKeg()) { go('selesai', {}, { replace: true }); return; }
  const u = S.user, d = (await DB.get('kv', 'draft_mulai')) || {};
  const nDesa = S.master.lokasi.filter(x => x.tipe === 'Desa' && x.aktif).length, nKel = S.master.lokasi.filter(x => x.tipe === 'Kelurahan' && x.aktif).length;
  $('#pg-mulai').innerHTML = `<div class="stack-16">
    <div class="row-between"><span class="step-pill">${ic('flag')} Inisiasi Tugas Lapangan</span><span class="step-pill accent">Langkah 1 dari 2</span></div>
    <div class="card">
      <div class="row-between mb-12"><div class="row"><span class="logo-tile" style="width:34px;height:34px;border-radius:10px;background:var(--surface-3);color:var(--muted)">${ic('lock')}</span><b class="text-sm" style="letter-spacing:.04em">IDENTITAS TENAGA KESEHATAN</b></div><span class="lock-tag">${ic('shield-lock')} TERKUNCI</span></div>
      <div class="row gap-12"><div class="avatar md">${esc(initials(u.nama))}</div><div class="grow"><div class="fw-7 text-lg">${esc(u.nama)}</div><div class="text-sm" style="color:var(--primary-text)">${esc(u.jabatan)} · Wilayah Kerja ${esc(S.cfg.kecamatan || 'Aesesa')}</div><div class="mono text-xs muted">NIP. ${esc(u.nip)}</div></div></div>
      <div class="mono text-xs subtle mt-12">DATA DARI SISTEM (TIDAK DAPAT DIUBAH)</div>
    </div>
    <div class="card-green stack">
      <div class="row-between"><b class="row" style="color:var(--primary-text);font-size:17px"><span class="statusbar dot" style="background:var(--primary);width:10px;height:10px;border-radius:50%;padding:0;border:0"></span> Deteksi Otomatis Sistem</b><span class="pill pill-solid" id="gpsLockPill">${ic('hourglass-split')} Mencari…</span></div>
      <div class="grid-2 keep">
        <div class="auto-tile"><div class="k">${ic('calendar3')} Tanggal Server</div><div class="v">${tglIndo(todayStr(), true)}</div><div class="s">${hariOf(todayStr())} (WITA, GMT+8)</div></div>
        <div class="auto-tile"><div class="k">${ic('clock')} Jam Datang</div><div class="v tnum" id="liveClock">${hhmm(timeStr(nowMs()))} <small>WITA</small></div><div class="s">${S.offset || S.lastSync ? ic('cloud-check') + ' Sinkron server' : 'Jam perangkat'}</div></div>
      </div>
      <div class="mini-map" id="mmMulai" style="height:150px"><div class="map-empty" id="mmMulaiEmpty">${ic('broadcast')} Mencari sinyal GPS…</div><div class="map-tag" id="gpsTag" hidden></div></div>
      <div class="gps-state" id="gpsState">${ic('broadcast')} Menunggu GPS…</div>
      <div id="gpsErr"></div>
    </div>
    <div class="card stack-16">
      <div class="row-between"><h3 class="section-title">Wilayah &amp; Tempat Tugas</h3><span class="text-sm" style="color:var(--primary-text)">Wajib Diisi *</span></div>
      <div class="field"><label for="mLokasi">Desa / Kelurahan <span class="req">*</span></label>
        <select class="select" id="mLokasi">${lokasiOptions(d.lokasi)}</select>
        <span class="help">${ic('info-circle')} Tersedia ${nDesa} desa &amp; ${nKel} kelurahan di wilayah kerja ${esc(titleCase(S.cfg.namaInstansi || 'Puskesmas Kota'))}</span></div>
      <div class="field" id="fLokasiLain" ${d.lokasi === 'Lainnya' ? '' : 'hidden'}><label for="mLokasiLain">Nama Lokasi Lainnya <span class="req">*</span></label><input class="input" id="mLokasiLain" maxlength="120" value="${esc(d.lokasiLainnya || '')}" placeholder="Mis. Kecamatan tetangga, kantor dinas…"></div>
      <div class="field"><label for="mTempat">Tempat Spesifik Pelaksanaan <span class="req">*</span></label>
        <div class="input-icon">${ic('geo-alt')}<input class="input" id="mTempat" maxlength="200" value="${esc(d.tempat || '')}" placeholder="Nama Posyandu / sekolah / dusun"></div></div>
    </div>
    <div class="card stack">
      <div class="row-between"><div><h3 class="section-title">Jenis Kegiatan Lapangan</h3><p class="text-sm muted">Pilih satu kegiatan utama yang akan dilakukan</p></div><span class="step-pill accent" id="jenisCount">${d.jenis ? '1 Dipilih' : 'Belum'}</span></div>
      <div class="choice-grid" id="jenisGrid">${jenisChoices(d.jenis)}</div>
      <div class="field" id="fJenisLain" ${d.jenis === 'Lainnya' ? '' : 'hidden'}><label for="mJenisLain">Jenis Kegiatan Lainnya <span class="req">*</span></label><input class="input" id="mJenisLain" maxlength="120" value="${esc(d.jenisLainnya || '')}" placeholder="Tuliskan jenis kegiatan"></div>
    </div>
    <div class="notice">${ic('sun')}<span>Tampilan dibuat kontras untuk dibaca di bawah sinar matahari. Pastikan Anda berada tepat di titik pos sebelum memulai.</span></div>
  </div>`;
  setSticky(`<button class="btn btn-soft btn-lg" data-action="back">Batal</button><button class="btn btn-primary btn-lg grow" id="btnMulai">Mulai Sekarang ${ic('arrow-right')}</button>`);

  let jenis = d.jenis || '';
  const saveDraft = debounce(() => DB.put('kv', { lokasi: $('#mLokasi').value, lokasiLainnya: $('#mLokasiLain').value, tempat: $('#mTempat').value, jenis, jenisLainnya: $('#mJenisLain').value }, 'draft_mulai'), 300);
  $('#mLokasi').addEventListener('change', e => { $('#fLokasiLain').hidden = e.target.value !== 'Lainnya'; e.target.classList.remove('is-invalid'); saveDraft(); });
  ['#mLokasiLain', '#mTempat', '#mJenisLain'].forEach(s => $(s).addEventListener('input', e => { e.target.classList.remove('is-invalid'); saveDraft(); }));
  $('#jenisGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-jenis]'); if (!b) return;
    jenis = b.dataset.jenis;
    $$('#jenisGrid .choice').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
    $('#fJenisLain').hidden = jenis !== 'Lainnya';
    $('#jenisCount').textContent = '1 Dipilih';
    saveDraft();
  });
  S.timers.clock = setInterval(() => { const c = $('#liveClock'); if (c) c.innerHTML = `${hhmm(timeStr(nowMs()))} <small>WITA</small>`; }, 1000);

  let mapDrawn = false;
  const onGps = () => {
    const g = S.gps, st = $('#gpsState'), pill = $('#gpsLockPill'); if (!st) return;
    if (g.state === 'ok') {
      const p = g.pos;
      st.className = 'gps-state ok';
      st.innerHTML = `${ic('satellite')} ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ±${Math.round(p.acc)} m ${p.acc > 100 ? '<span style="color:var(--warn-text)">(akurasi rendah)</span>' : '· Valid'}`;
      pill.innerHTML = `${ic('check-circle')} Terkunci ✓`;
      $('#gpsErr').innerHTML = '';
      const tag = $('#gpsTag'); tag.hidden = false;
      tag.innerHTML = `<span>${ic('crosshair')} ${esc(lokasiLabel({ Lokasi: $('#mLokasi').value || '', Lokasi_Lainnya: '' }) || 'Posisi Anda')} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>`;
      $('#mmMulaiEmpty') && $('#mmMulaiEmpty').remove();
      if (!mapDrawn || (S.maps.mmMulai && p.acc < 50)) { mapDrawn = true; miniMap('mmMulai', [{ lat: p.lat, lng: p.lng, acc: p.acc, label: 'Posisi Anda' }]); }
    } else if (g.state === 'error') {
      st.className = 'gps-state bad'; st.innerHTML = `${ic('geo-alt')} GPS belum terkunci`;
      pill.innerHTML = `${ic('exclamation-triangle')} Belum`;
      $('#gpsErr').innerHTML = `<div class="notice danger">${ic('geo')}<div class="grow"><b>Lokasi tidak aktif.</b><div>${esc(g.error)}</div><button class="btn btn-outline btn-sm mt-8" id="gpsRetry">${ic('arrow-clockwise')} Coba Lagi</button></div></div>`;
      $('#gpsRetry').addEventListener('click', () => { $('#gpsErr').innerHTML = ''; startGps(onGps); });
    }
  };
  startGps(onGps);

  $('#btnMulai').addEventListener('click', async () => {
    const lok = $('#mLokasi').value, lokL = $('#mLokasiLain').value.trim(), tempat = $('#mTempat').value.trim(), jl = $('#mJenisLain').value.trim();
    const bad = [];
    if (!lok) bad.push(['#mLokasi', 'Pilih desa/kelurahan.']);
    if (lok === 'Lainnya' && !lokL) bad.push(['#mLokasiLain', 'Isi nama lokasi lainnya.']);
    if (!tempat) bad.push(['#mTempat', 'Isi tempat spesifik.']);
    if (!jenis) bad.push(['#jenisGrid', 'Pilih jenis kegiatan.']);
    if (jenis === 'Lainnya' && !jl) bad.push(['#mJenisLain', 'Isi jenis kegiatan lainnya.']);
    if (bad.length) { bad.forEach(([s]) => { const el = $(s); el.classList && el.classList.add('is-invalid'); }); $(bad[0][0]).scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('warning', 'Lengkapi formulir', bad[0][1]); return; }
    if (S.gps.state !== 'ok') { toast('error', 'GPS belum terkunci', 'Kegiatan tidak dapat dimulai tanpa titik lokasi. Nyalakan GPS lalu tunggu sebentar.'); $('#gpsState').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const p = S.gps.pos, t = nowMs();
    const data = { id: genId(), lokasi: lok, lokasiLainnya: lok === 'Lainnya' ? lokL : '', tempat, jenis, jenisLainnya: jenis === 'Lainnya' ? jl : '', lat: p.lat, lng: p.lng, acc: p.acc, t, deviceTime: new Date().toISOString() };
    await enqueue('mulai', data);
    DB.del('kv', 'draft_mulai');
    toast('success', 'Kegiatan dimulai', `Jam datang ${timeStr(t).slice(0, 5)} WITA tercatat${S.online ? '' : ' (offline, akan dikirim otomatis)'}.`);
    go('beranda', {}, { clearHistory: true, noHistory: true });
  });
};

// ─── W-05 SELESAI KEGIATAN ──────────────────────────────────────────────────
RENDER.selesai = async function () {
  const act = activeKeg();
  if (!act) { go('beranda', {}, { replace: true }); return; }
  const draftKey = 'draft_selesai_' + act.ID_Kegiatan;
  const d = (await DB.get('kv', draftKey)) || { uraian: '', keterangan: '', files: [] };
  let files = d.files || [];

  $('#pg-selesai').innerHTML = `<div class="stack-16">
    <div class="row-between"><h1 class="row" style="font-size:22px;font-weight:800"><span style="width:10px;height:10px;border-radius:50%;background:var(--primary);display:inline-block"></span> Selesai Kegiatan</h1><span class="step-pill">Langkah 2 dari 2</span></div>
    <div class="card stack">
      <div class="row-between wrap"><span class="mono text-xs" style="color:var(--primary-text);letter-spacing:.06em">${esc(jenisLabel(act).toUpperCase())}</span><span class="pill pill-accent">${ic('geo-alt')} ${esc(lokasiFull(act))}</span></div>
      <div class="card-title">${esc(act.Tempat_Spesifik)}</div>
      <div class="card-tint">
        <div class="grid-2 keep">
          <div class="row"><span class="kpi ic ic-green" style="width:36px;height:36px;padding:0;border:0;box-shadow:none;border-radius:50%">${ic('play-fill')}</span><div><div class="text-xs muted">Mulai Dinas</div><div class="fw-7 tnum">${hhmm(act.Jam_Mulai)} <span class="text-xs muted">WITA</span></div></div></div>
          <div class="row"><span class="kpi ic ic-sky" style="width:36px;height:36px;padding:0;border:0;box-shadow:none;border-radius:50%">${ic('lock')}</span><div><div class="text-xs muted">Selesai (Kunci)</div><div class="fw-7 tnum" style="color:var(--accent-text)" id="endClock">${hhmm(timeStr(nowMs()))} <span class="text-xs muted">WITA</span></div></div></div>
        </div>
        <div class="row-between mt-12" style="background:var(--surface);border-radius:10px;padding:8px 10px"><span class="text-sm">Total Durasi Lapangan</span><span class="pill" style="background:var(--accent-strong);color:#fff" id="durPill">${ic('stopwatch')} –</span></div>
      </div>
      <div class="mini-map" id="mmSelesai" style="height:160px"><div class="map-tag"><span>● Mulai (titik 1)</span></div><div class="map-tag right" id="endTag"><span>${ic('broadcast')} Mencari GPS…</span></div></div>
      <div class="gps-state" id="gpsState2">${ic('broadcast')} Mengunci titik selesai…</div>
      <div id="gpsErr2"></div>
    </div>
    <div class="card stack-16">
      <div class="field"><div class="row-between"><label for="sUraian">Uraian Kegiatan <span class="req">*</span></label><span class="mono text-xs" style="color:var(--primary-text)">Wajib Terisi</span></div>
        <textarea class="textarea" id="sUraian" maxlength="1500" placeholder="Contoh: Pelayanan Posyandu Balita meliputi penimbangan BB (38 anak), pengukuran TB/PB, penyuluhan gizi seimbang…">${esc(d.uraian)}</textarea>
        <div class="counter" id="sCount">0 / 1500 karakter</div></div>
      <div class="field"><label for="sKet">Keterangan Tambahan <span class="muted mono text-xs">(Opsional)</span></label>
        <textarea class="textarea" id="sKet" style="min-height:84px" maxlength="800" placeholder="Mis. kader hadir lengkap, 1 balita dirujuk…">${esc(d.keterangan)}</textarea></div>
    </div>
    <div class="card stack" id="buktiCard"></div>
    <div class="notice green">${ic('info-circle')}<span>Setelah <b>Selesaikan &amp; Kirim</b> ditekan, koordinat akhir dan laporan langsung dikunci lalu diteruskan ke Admin &amp; Kepala Puskesmas.</span></div>
  </div>`;
  setSticky(`<button class="btn btn-soft btn-lg" id="btnDraft">${ic('bookmark')} Draf</button><button class="btn btn-primary btn-lg grow" id="btnSelesai">Selesaikan &amp; Kirim ${ic('send')}</button>`);

  const tick = () => {
    const ms = nowMs(), c = $('#endClock'); if (!c) return;
    c.innerHTML = `${hhmm(timeStr(ms))} <span class="text-xs muted">WITA</span>`;
    const mins = Math.max(0, Math.floor((ms - kegStartMs(act)) / 60000));
    $('#durPill').innerHTML = `${ic('stopwatch')} ${Math.floor(mins / 60)} Jam ${mins % 60} Menit`;
  };
  tick(); S.timers.end = setInterval(tick, 15000);

  const saveDraft = debounce(() => DB.put('kv', { uraian: $('#sUraian').value, keterangan: $('#sKet').value, files }, draftKey), 400);
  const cnt = () => { $('#sCount').textContent = `${$('#sUraian').value.length} / 1500 karakter`; };
  cnt();
  $('#sUraian').addEventListener('input', e => { cnt(); e.target.classList.remove('is-invalid'); saveDraft(); });
  $('#sKet').addEventListener('input', saveDraft);

  const renderBukti = () => {
    const total = files.reduce((a, f) => a + f.size, 0), pct = Math.min(100, total / MAX_TOTAL * 100);
    $('#buktiCard').innerHTML = `
      <div class="row-between"><h3 class="section-title row">${ic('paperclip')} Bukti Dukung <span class="req">*</span></h3><span class="step-pill accent">${files.length} / maks. ${MAX_FILES} berkas</span></div>
      <div class="upload-tiles">
        <button class="upload-tile" id="btnCam" ${files.length >= MAX_FILES ? 'disabled style="opacity:.5"' : ''}><span class="c">${ic('camera')}</span><b>Ambil Foto</b><span>Cap timemark, GPS &amp; NIP otomatis</span></button>
        <button class="upload-tile blue" id="btnPick" ${files.length >= MAX_FILES ? 'disabled style="opacity:.5"' : ''}><span class="c">${ic('upload')}</span><b>Pilih Berkas</b><span>Foto, PDF, Word, Excel (total maks. 5 MB)</span></button>
      </div>
      <div class="cap-bar"><div class="row-between mono text-xs"><span>Kapasitas lampiran</span><span>${fmtSize(total)} dari 5,0 MB ${pct < 80 ? '(Aman)' : pct <= 100 ? '(Hampir penuh)' : '(Melebihi)'}</span></div>
        <div class="progress ${pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div></div>
      ${files.length ? `<div class="overline mt-4">Berkas terlampir</div>` + files.map((f, i) => `
        <div class="file-row">
          <div class="thumb" data-prev="${i}">${f.preview ? `<img src="${f.preview}" alt="">${f.source === 'Kamera' ? '<span class="tm">TIMEMARK ✓</span>' : ''}` : ic(fileIcon(f.mime, f.name))}</div>
          <div class="grow"><div class="fn ellipsis">${esc(f.name)}</div><div class="fm">${fmtSize(f.size)}${f.exif ? ' · Foto ' + esc(f.exif.slice(0, 16)) : ''}</div>
            <div class="row wrap gap-4 mt-4">${f.source === 'Kamera' ? `<span class="pill pill-green">${ic('camera')} Kamera (Timemark ✓)</span>` : f.source === 'Galeri' ? `<span class="pill pill-flag">${ic('images')} Galeri</span>` : `<span class="pill pill-accent">${ic('file-earmark')} Berkas</span>`}${f.flag ? `<span class="pill pill-flag">${ic('exclamation-triangle')} ${esc(f.flag)}</span>` : ''}</div></div>
          <button class="icon-btn" data-rm="${i}" aria-label="Hapus berkas" style="color:var(--danger)">${ic('trash3')}</button>
        </div>`).join('') : `<p class="help">${ic('info-circle')} Unggah minimal 1 dan maksimal 3 berkas. Foto dari kamera dikompres otomatis &amp; diberi cap tanggal, jam, nama, dan koordinat.</p>`}`;
    $('#btnCam').onclick = () => { $('#inCamera').value = ''; $('#inCamera').click(); };
    $('#btnPick').onclick = () => { $('#inFile').value = ''; $('#inFile').click(); };
    $$('[data-rm]', $('#buktiCard')).forEach(b => b.onclick = () => { files.splice(+b.dataset.rm, 1); renderBukti(); saveDraft(); });
    $$('[data-prev]', $('#buktiCard')).forEach(b => b.onclick = () => { const f = files[+b.dataset.prev]; if (f.preview) previewModal(f.name, f.preview, 'image/jpeg'); });
  };
  renderBukti();

  const addFiles = async (list, fromCamera) => {
    const arr = Array.from(list || []);
    if (!arr.length) return;
    if (arr.length > 1 || arr[0].size > 1500000) toast('info', 'Memproses berkas…', arr.length + ' berkas', 1500);
    for (const file of arr) {
      if (files.length >= MAX_FILES) { toast('warning', 'Maksimal 3 berkas', 'Hapus salah satu berkas untuk menambah yang baru.'); break; }
      try {
        const item = await processFile(file, fromCamera, act);
        const total = files.reduce((a, f) => a + f.size, 0) + item.size;
        if (total > MAX_TOTAL) { toast('error', 'Melebihi 5 MB', `${file.name} (${fmtSize(item.size)}) tidak dapat ditambahkan karena total lampiran melebihi 5 MB.`); continue; }
        files.push(item);
      } catch (e) { toast('error', 'Berkas gagal diproses', e.message || file.name); }
    }
    renderBukti(); saveDraft();
  };
  $('#inCamera').onchange = e => addFiles(e.target.files, true);
  $('#inFile').onchange = e => addFiles(e.target.files, false);

  const onGps = () => {
    const g = S.gps, st = $('#gpsState2'); if (!st) return;
    if (g.state === 'ok') {
      const p = g.pos, dist = haversine(+act.Lat_Mulai, +act.Lng_Mulai, p.lat, p.lng);
      st.className = 'gps-state ok';
      st.innerHTML = `${ic('patch-check')} Jarak pergeseran: ${fmtJarak(dist)} · ±${Math.round(p.acc)} m ${dist > 2000 ? '<span style="color:var(--flag-text)">(jauh dari titik mulai)</span>' : '· Akurat ✓'}`;
      $('#endTag').innerHTML = `<span>● Selesai · ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</span>`;
      $('#gpsErr2').innerHTML = '';
      if (!S.maps.mmSelesai || p.acc < 60) miniMap('mmSelesai', [{ lat: act.Lat_Mulai, lng: act.Lng_Mulai, label: 'Mulai', color: '#15803D' }, { lat: p.lat, lng: p.lng, label: 'Selesai', color: '#0EA5E9' }]);
    } else if (g.state === 'error') {
      st.className = 'gps-state bad'; st.innerHTML = `${ic('geo-alt')} Titik selesai belum terkunci`;
      $('#gpsErr2').innerHTML = `<div class="notice danger">${ic('geo')}<div class="grow">${esc(g.error)}<br><button class="btn btn-outline btn-sm mt-8" id="gpsRetry2">${ic('arrow-clockwise')} Coba Lagi</button></div></div>`;
      $('#gpsRetry2').onclick = () => { $('#gpsErr2').innerHTML = ''; startGps(onGps); };
    }
  };
  miniMap('mmSelesai', [{ lat: act.Lat_Mulai, lng: act.Lng_Mulai, label: 'Mulai' }]);
  startGps(onGps);

  $('#btnDraft').onclick = async () => { await DB.put('kv', { uraian: $('#sUraian').value, keterangan: $('#sKet').value, files }, draftKey); toast('success', 'Draf tersimpan di HP', 'Anda bisa melanjutkan nanti, walau aplikasi ditutup.'); };
  $('#btnSelesai').onclick = async () => {
    const uraian = $('#sUraian').value.trim();
    if (!uraian) { $('#sUraian').classList.add('is-invalid'); $('#sUraian').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('warning', 'Uraian wajib diisi', 'Jelaskan kegiatan yang telah dilaksanakan.'); return; }
    if (!files.length) { $('#buktiCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('warning', 'Bukti dukung wajib', 'Unggah minimal 1 berkas (foto/dokumen).'); return; }
    if (files.reduce((a, f) => a + f.size, 0) > MAX_TOTAL) { toast('error', 'Total berkas melebihi 5 MB'); return; }
    if (S.gps.state !== 'ok') { toast('error', 'GPS belum terkunci', 'Titik selesai wajib tercatat. Nyalakan GPS lalu tunggu sebentar.'); return; }
    const ok = await confirmDialog({ title: 'Kirim laporan kegiatan?', message: `Jam selesai <b>${timeStr(nowMs()).slice(0, 5)} WITA</b> dan titik GPS akan dikunci. ${files.length} berkas akan dikirim ke server.`, okText: 'Selesaikan & Kirim', icon: 'send-check' });
    if (!ok) return;
    const p = S.gps.pos, t = nowMs();
    await enqueue('selesai', {
      id: act.ID_Kegiatan, lat: p.lat, lng: p.lng, acc: p.acc, t, deviceTime: new Date().toISOString(),
      uraian, keterangan: $('#sKet').value.trim(),
      files: files.map(f => ({ name: f.name, mime: f.mime, size: f.size, data: f.data, thumb: f.thumb || '', source: f.source, exif: f.exif || '', flag: f.flag || '', preview: f.preview || '' }))
    });
    DB.del('kv', draftKey);
    toast('success', 'Kegiatan selesai', S.online ? 'Laporan sedang dikirim ke server…' : 'Tersimpan di HP — akan dikirim otomatis saat sinyal kembali.');
    go('beranda', {}, { clearHistory: true, noHistory: true });
  };
};

function fileIcon(mime, name) {
  const n = String(name).toLowerCase();
  if (/pdf/.test(mime) || n.endsWith('.pdf')) return 'file-earmark-pdf';
  if (/word|document/.test(mime) || /\.docx?$/.test(n)) return 'file-earmark-word';
  if (/sheet|excel/.test(mime) || /\.(xlsx?|csv)$/.test(n)) return 'file-earmark-excel';
  if (/image/.test(mime)) return 'file-earmark-image';
  return 'file-earmark';
}

// ─── Pemrosesan berkas: kompres, timemark, thumbnail, EXIF ─────────────────
function readAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Gagal membaca berkas')); r.readAsDataURL(file); }); }
function readAsBuffer(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Gagal membaca berkas')); r.readAsArrayBuffer(file.slice(0, 131072)); }); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Format gambar tidak didukung')); i.src = src; }); }
function canvasToDataURL(c, q) { return c.toDataURL('image/jpeg', q); }
function dataUrlBytes(u) { const b = u.split(',')[1] || ''; return Math.floor(b.length * 3 / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0); }

async function readExifDate(file) {
  try {
    const v = new DataView(await readAsBuffer(file));
    if (v.getUint16(0) !== 0xFFD8) return '';
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off);
      if (marker === 0xFFE1) {
        const start = off + 4;
        if (v.getUint32(start) !== 0x45786966) return '';
        const tiff = start + 6, le = v.getUint16(tiff) === 0x4949;
        const g16 = o => v.getUint16(o, le), g32 = o => v.getUint32(o, le);
        const readTag = (ifd, tag) => { const n = g16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (g16(e) === tag) return e; } return 0; };
        const ifd0 = tiff + g32(tiff + 4);
        const exifPtr = readTag(ifd0, 0x8769);
        const str = e => { const cnt = g32(e + 4), o = tiff + g32(e + 8); let s = ''; for (let i = 0; i < cnt - 1; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
        if (exifPtr) { const sub = tiff + g32(exifPtr + 8); const e = readTag(sub, 0x9003); if (e) return str(e); }
        const e0 = readTag(ifd0, 0x0132); if (e0) return str(e0);
        return '';
      }
      off += 2 + v.getUint16(off + 2);
    }
  } catch (e) { /* abaikan */ }
  return '';
}

async function processFile(file, fromCamera, act) {
  const isImg = /^image\/(jpeg|png|webp|gif|bmp|heic|heif)/i.test(file.type) || (/\.(jpe?g|png|webp)$/i.test(file.name) && !file.type);
  if (!isImg) {
    if (file.size > MAX_TOTAL) throw new Error(`${file.name} melebihi 5 MB.`);
    const url = await readAsDataURL(file);
    return { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: url.split(',')[1], source: 'Berkas' };
  }
  let exif = '', flag = '';
  if (!fromCamera) {
    exif = await readExifDate(file);
    if (exif) { const dExif = exif.slice(0, 10).replace(/:/g, '-'); if (dExif !== act.Tanggal) flag = 'Tanggal foto berbeda'; }
    else flag = '';
  }
  let img;
  try { img = await loadImg(await readAsDataURL(file)); }
  catch (e) {
    if (file.size > MAX_TOTAL) throw e;
    const url = await readAsDataURL(file);
    return { name: file.name, mime: file.type || 'image/jpeg', size: file.size, data: url.split(',')[1], source: fromCamera ? 'Kamera' : 'Galeri', exif, flag };
  }
  const maxW = 1600, scale = Math.min(1, maxW / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
  if (fromCamera) drawTimemark(x, w, h, act);
  let q = 0.82, url = canvasToDataURL(c, q);
  while (dataUrlBytes(url) > 1.6 * 1024 * 1024 && q > 0.5) { q -= 0.1; url = canvasToDataURL(c, q); }
  const ts = Math.min(1, 360 / Math.max(w, h));
  const tc = document.createElement('canvas'); tc.width = Math.round(w * ts); tc.height = Math.round(h * ts);
  tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
  const thumbUrl = canvasToDataURL(tc, 0.7);
  const baseName = (fromCamera ? 'FOTO_KEG_' + (jenisLabel(act).toUpperCase().replace(/[^A-Z0-9]+/g, '_')) + '_' + timeStr(nowMs()).replace(/:/g, '') : file.name.replace(/\.[^.]+$/, '')) + '.jpg';
  return { name: baseName, mime: 'image/jpeg', size: dataUrlBytes(url), data: url.split(',')[1], thumb: thumbUrl.split(',')[1], preview: thumbUrl, source: fromCamera ? 'Kamera' : 'Galeri', exif, flag };
}

function drawTimemark(x, w, h, act) {
  const g = S.gps.pos, ms = nowMs(), u = S.user;
  const lines = [
    `${dateStr(ms).split('-').reverse().join('-')}  ${timeStr(ms)} WITA`,
    `${u.nama} — NIP ${u.nip}`,
    `${lokasiFull(act)} · ${act.Tempat_Spesifik}`.slice(0, 70),
    g ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}  (±${Math.round(g.acc)} m)` : 'GPS: tidak tersedia'
  ];
  const fs = Math.max(14, Math.round(w * 0.024)), lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.7);
  x.font = `600 ${fs}px "JetBrains Mono", monospace`;
  const tw = Math.min(w - pad * 2, Math.max(...lines.map(l => x.measureText(l).width)) + pad * 2);
  const bh = lines.length * lh + pad * 1.4, bx = pad, by = h - bh - pad;
  x.fillStyle = 'rgba(0,0,0,.62)';
  if (x.roundRect) { x.beginPath(); x.roundRect(bx, by, tw, bh, fs * 0.5); x.fill(); } else x.fillRect(bx, by, tw, bh);
  x.fillStyle = '#4ADE80'; x.fillRect(bx, by, Math.max(4, fs * 0.25), bh);
  x.fillStyle = '#fff'; x.textBaseline = 'top';
  lines.forEach((l, i) => x.fillText(l, bx + pad, by + pad * 0.7 + i * lh, tw - pad * 1.5));
  const tag = 'SIMONIK-LG ✓', tfs = Math.round(fs * 0.85);
  x.font = `700 ${tfs}px "Plus Jakarta Sans", sans-serif`;
  const tgw = x.measureText(tag).width + tfs;
  x.fillStyle = 'rgba(21,128,61,.85)'; x.fillRect(w - tgw - pad, pad, tgw, tfs * 1.8);
  x.fillStyle = '#fff'; x.fillText(tag, w - tgw - pad + tfs / 2, pad + tfs * 0.4);
}

function previewModal(name, url, mime) {
  const isImg = /image/.test(mime), isPdf = /pdf/.test(mime);
  openModal({
    title: name, size: 'lg',
    body: isImg ? `<img class="preview-img" src="${url}" alt="${esc(name)}">` : isPdf ? `<iframe class="preview-frame" src="${url}" title="${esc(name)}"></iframe>` : emptyState('file-earmark', 'Pratinjau tidak tersedia', 'Unduh berkas untuk membukanya.'),
    foot: `<button class="btn btn-outline" data-close>Tutup</button><button class="btn btn-primary" id="pvDl">${ic('download')} Unduh</button>`,
    onOpen: m => m.$('#pvDl').onclick = () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  });
}

// ─── W-08 RIWAYAT ───────────────────────────────────────────────────────────
RENDER.riwayat = function (p, soft) {
  const st = S.ui.riwayat, today = todayStr(), month = today.slice(0, 7);
  const weekAgo = addDays(today, -6);
  const base = myRows().sort(byNewest);
  const chips = [
    ['semua', 'Semua', base.length], ['hari', 'Hari Ini', base.filter(r => r.Tanggal === today).length],
    ['minggu', '7 Hari', base.filter(r => r.Tanggal >= weekAgo).length], ['bulan', 'Bulan Ini', base.filter(r => r.Tanggal.startsWith(month)).length],
    ['verif', 'Diverifikasi', base.filter(r => r.Status_Verifikasi === 'Diverifikasi').length]
  ];
  let rows = base;
  if (st.chip === 'hari') rows = rows.filter(r => r.Tanggal === today);
  if (st.chip === 'minggu') rows = rows.filter(r => r.Tanggal >= weekAgo);
  if (st.chip === 'bulan') rows = rows.filter(r => r.Tanggal.startsWith(month));
  if (st.chip === 'verif') rows = rows.filter(r => r.Status_Verifikasi === 'Diverifikasi');
  if (st.lokasi) rows = rows.filter(r => r.Lokasi === st.lokasi);
  if (st.jenis) rows = rows.filter(r => r.Jenis_Kegiatan === st.jenis);
  if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter(r => [r.Uraian_Kegiatan, r.Tempat_Spesifik, lokasiLabel(r), jenisLabel(r), r.Keterangan].join(' ').toLowerCase().includes(q)); }
  const shown = rows.slice(0, st.limit);
  let lastDate = '', list = '';
  shown.forEach(r => {
    if (r.Tanggal !== lastDate) {
      lastDate = r.Tanggal;
      const n = rows.filter(x => x.Tanggal === r.Tanggal).length;
      const label = r.Tanggal === today ? `<span class="today">● Hari ini — ${tglIndo(r.Tanggal)}</span>` : r.Tanggal === addDays(today, -1) ? `Kemarin — ${tglIndo(r.Tanggal)}` : `${hariOf(r.Tanggal)} — ${tglIndo(r.Tanggal)}`;
      list += `<div class="date-group">${label}<span>${n} tugas</span></div>`;
    }
    list += kcard(r);
  });

  const html = `
    <div class="row-between mb-12"><div><h1 style="font-size:26px;font-weight:800;line-height:1.15">Riwayat Kegiatan Lapangan</h1><p class="text-sm muted mt-4">Daftar penugasan dinas luar gedung ${esc(titleCase(S.cfg.namaInstansi || 'UPTD Puskesmas Kota'))}</p></div>
      <span class="pill pill-accent" style="height:30px">${ic('shield-check')} ${base.length} Arsip</span></div>
    <div class="input-icon mb-12">${ic('search')}<input class="input" id="rwQ" placeholder="Cari uraian, desa, atau jenis…" value="${esc(st.q)}" style="padding-right:48px">${st.q ? `<button class="icon-btn suffix" id="rwClear" aria-label="Hapus pencarian">${ic('x-lg')}</button>` : ''}</div>
    <div class="chips-scroll" id="rwChips">${chips.map(c => `<button class="chip ${st.chip === c[0] ? 'active' : ''}" data-chip="${c[0]}">${c[1]} <span class="count">(${c[2]})</span></button>`).join('')}
      <select class="chip select" id="rwLok" style="width:auto;padding-right:34px;background-position:right 10px center">${['<option value="">Semua desa</option>'].concat(S.master.lokasi.map(l => `<option ${st.lokasi === l.nama ? 'selected' : ''}>${esc(l.nama)}</option>`)).join('')}</select>
      <select class="chip select" id="rwJen" style="width:auto;padding-right:34px;background-position:right 10px center">${['<option value="">Semua jenis</option>'].concat(S.master.jenis.map(l => `<option ${st.jenis === l.nama ? 'selected' : ''}>${esc(l.nama)}</option>`)).join('')}</select>
    </div>
    <div class="stack" id="rwList">${list || emptyState('clock-history', 'Tidak ada kegiatan', st.q || st.chip !== 'semua' || st.lokasi || st.jenis ? 'Tidak ada data pada filter ini.' : 'Kegiatan yang Anda catat akan tampil di sini.', st.q || st.chip !== 'semua' || st.lokasi || st.jenis ? '<button class="btn btn-outline btn-sm mt-12" id="rwReset">Reset filter</button>' : '')}</div>
    ${rows.length > st.limit ? `<button class="btn btn-outline btn-block mt-16" id="rwMore">Muat lebih banyak (${rows.length - st.limit} lagi)</button>` : ''}
    <div class="card-tint mt-16" style="text-align:center">
      <div class="em-ic" style="width:44px;height:44px;border-radius:12px;background:var(--surface);display:grid;place-items:center;margin:0 auto 8px;color:var(--primary-text)">${ic('archive')}</div>
      <b>Riwayat sejak ${tglIndo(S.loadedFrom || today)} ditampilkan</b>
      <p class="text-xs muted mt-4">Data tersimpan di perangkat dan tersinkron dengan server ${esc(titleCase(S.cfg.namaInstansi || 'Puskesmas'))}.</p>
      <div class="row wrap mt-12" style="justify-content:center"><button class="btn btn-outline btn-sm" id="rwOlder">${ic('clock-history')} Muat data lebih lama</button><button class="btn btn-accent btn-sm" data-go="laporan">${ic('file-earmark-pdf')} Rekap Bulanan (PDF)</button></div>
    </div>`;
  const el = $('#pg-riwayat');
  const focused = document.activeElement && document.activeElement.id === 'rwQ';
  el.innerHTML = html;
  if (focused) { const q = $('#rwQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  $('#rwQ').addEventListener('input', debounce(e => { st.q = e.target.value; st.limit = 30; RENDER.riwayat(); }, 250));
  $('#rwClear') && ($('#rwClear').onclick = () => { st.q = ''; RENDER.riwayat(); });
  $$('[data-chip]', el).forEach(b => b.onclick = () => { st.chip = b.dataset.chip; st.limit = 30; RENDER.riwayat(); });
  $('#rwLok').onchange = e => { st.lokasi = e.target.value; RENDER.riwayat(); };
  $('#rwJen').onchange = e => { st.jenis = e.target.value; RENDER.riwayat(); };
  $('#rwReset') && ($('#rwReset').onclick = () => { Object.assign(st, { q: '', chip: 'semua', lokasi: '', jenis: '' }); RENDER.riwayat(); });
  $('#rwMore') && ($('#rwMore').onclick = () => { st.limit += 30; RENDER.riwayat(); });
  $('#rwOlder').onclick = e => loadOlder(e.currentTarget, 90);
};

async function loadOlder(btn, days) {
  if (!S.online) { toast('warning', 'Sedang offline', 'Data lama hanya dapat dimuat saat online.'); return; }
  const to = addDays(S.loadedFrom, -1), from = addDays(S.loadedFrom, -days);
  btnLoading(btn, true, 'Memuat…');
  try {
    const r = await api('muatRentang', S.token, from, to);
    if (!r.success) { toast('error', 'Gagal memuat', r.message); return; }
    mergeRows(r.data.rows, { force: true });
    S.loadedFrom = from; saveSnapshot();
    toast('success', 'Data lama dimuat', `${r.data.rows.length} kegiatan (${tglIndo(from, true)} – ${tglIndo(to, true)}).`);
    renderCurrent();
  } catch (e) { toast('error', 'Tidak dapat terhubung', e.message); }
  finally { btnLoading(btn, false); }
}
async function ensureRange(from) {
  if (!S.loadedFrom || from >= S.loadedFrom || !S.online) return false;
  const r = await api('muatRentang', S.token, from, addDays(S.loadedFrom, -1));
  if (r.success) { mergeRows(r.data.rows, { force: true }); S.loadedFrom = from; saveSnapshot(); return true; }
  return false;
}

// ─── W-09 / W-15 DETAIL & VERIFIKASI ────────────────────────────────────────
RENDER.detail = function (p) {
  const r = S.keg.get(p.id);
  const el = $('#pg-detail');
  if (!r) { el.innerHTML = emptyState('search', 'Kegiatan tidak ditemukan', 'Data mungkin sudah dihapus atau belum dimuat.', '<button class="btn btn-outline btn-sm mt-12" data-action="back">Kembali</button>'); return; }
  const own = r.ID_Pegawai === S.user.id, staff = isStaff(), today = todayStr();
  const canEdit = (own && S.user.peran === 'Pegawai' && r.Tanggal === today && r.Dihapus !== 'TRUE' && !r._pending) || (isAdmin() && r.Dihapus !== 'TRUE');
  const canDel = (own && S.user.peran === 'Pegawai' && r.Tanggal === today && r.Dihapus !== 'TRUE' && S.hapusHariIni < 1 && !r._pending && r.Status_Kegiatan !== 'Berlangsung') || (isAdmin() && r.Dihapus !== 'TRUE');
  const canVerify = staff && r.Status_Kegiatan !== 'Berlangsung' && r.Status_Verifikasi !== 'Diverifikasi' && r.Dihapus !== 'TRUE';
  const flags = flagsOf(r);
  const dist = haversine(+r.Lat_Mulai, +r.Lng_Mulai, +r.Lat_Selesai, +r.Lng_Selesai);
  const files = r.Berkas || [];
  const local = S.localFiles[r.ID_Kegiatan];

  const info = `<dl class="kv">
    <dt>Pegawai</dt><dd>${esc(r.Nama)}</dd>
    <dt>NIP / Jabatan</dt><dd><span class="mono">${esc(r.NIP)}</span> · ${esc(r.Jabatan)}</dd>
    <dt>Waktu</dt><dd class="mono">${esc(hariOf(r.Tanggal))}, ${esc(tglIndo(r.Tanggal))} · ${hhmm(r.Jam_Mulai)} – ${r.Jam_Selesai ? hhmm(r.Jam_Selesai) + ' (' + durasi(r.Jam_Mulai, r.Jam_Selesai) + ')' : '…'}</dd>
    <dt>Lokasi</dt><dd>${esc(lokasiFull(r))} · ${esc(r.Tempat_Spesifik)}</dd>
    <dt>Jenis Kegiatan</dt><dd>${esc(jenisLabel(r))}</dd>
    <dt>Uraian</dt><dd>${r.Uraian_Kegiatan ? esc(r.Uraian_Kegiatan).replace(/\n/g, '<br>') : '<span class="muted">Belum diisi</span>'}</dd>
    ${r.Keterangan ? `<dt>Keterangan</dt><dd>${esc(r.Keterangan)}</dd>` : ''}
    ${staff ? `<dt>Mode input</dt><dd>${esc(r.Mode_Input || '-')}${r.Waktu_Sinkron ? ` · <span class="mono text-xs">tiba di server ${esc(r.Waktu_Sinkron)}</span>` : ''}</dd>` : ''}
    ${r.Dihapus === 'TRUE' ? `<dt>Alasan hapus</dt><dd style="color:var(--danger-text)">${esc(r.Alasan_Hapus || '-')}</dd>` : ''}
  </dl>`;

  const filesHtml = files.length ? `<div class="thumbs" id="dtThumbs">${files.map((b, i) => {
    const isImg = /image/.test(b.mime);
    const src = local && local[i] && local[i].url ? local[i].url : (S.thumbs[b.id] || '');
    return `<div class="col gap-4" style="width:84px"><div class="thumb" data-file="${i}" title="${esc(b.name)}">${src ? `<img src="${src}" alt="">` : ic(isImg ? 'image' : fileIcon(b.mime, b.name))}${b.source === 'Kamera' ? '<span class="tm">TIMEMARK</span>' : ''}</div>
      <span class="text-xs ellipsis" title="${esc(b.name)}">${esc(b.name)}</span><span class="text-xs muted">${b.source || ''}</span></div>`;
  }).join('')}</div>` : `<p class="text-sm muted">${r.Status_Kegiatan === 'Berlangsung' ? 'Bukti dukung diunggah saat kegiatan diselesaikan.' : 'Tidak ada berkas.'}</p>`;

  const mapCard = `<div class="card stack"><div class="row-between"><b>Peta Titik Mulai &amp; Selesai</b>${dist != null ? `<span class="mono text-xs muted">Jarak: ${fmtJarak(dist)}</span>` : ''}</div>
    <div class="mini-map" id="mmDetail" style="height:${staff && isDesktop() ? 260 : 180}px"></div>
    <div class="row wrap gap-4"><span class="gps-pill">${ic('geo-alt-fill')} Mulai ${(+r.Lat_Mulai || 0).toFixed(5)}, ${(+r.Lng_Mulai || 0).toFixed(5)} · ±${Math.round(r.Akurasi_Mulai || 0)} m</span>
      ${r.Lat_Selesai ? `<span class="gps-pill">${ic('geo-alt-fill')} Selesai ${(+r.Lat_Selesai).toFixed(5)}, ${(+r.Lng_Selesai).toFixed(5)}</span>` : ''}
      <a class="btn btn-accent btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${r.Lat_Selesai || r.Lat_Mulai},${r.Lng_Selesai || r.Lng_Mulai}">${ic('box-arrow-up-right')} Google Maps</a></div></div>`;

  const verifyBlock = r.Status_Verifikasi === 'Diverifikasi'
    ? `<div class="verify-stamp">${ic('patch-check-fill')}<div><b style="color:var(--primary-text)">Diverifikasi</b><div class="text-sm">${esc(r.Diverifikasi_Oleh)} · <span class="mono text-xs">${esc(r.Tgl_Verifikasi)}</span></div>${r.Catatan_Kapus ? `<div class="text-sm mt-4" style="font-style:italic">“${esc(r.Catatan_Kapus)}”</div>` : ''}</div></div>` : '';

  const left = `<div class="stack-16">
    <div class="card stack">
      <div class="row wrap gap-4">${catPill(r)} ${statusPill(r)} ${verifPill(r)} ${pendingPill(r)}</div>
      <h1 style="font-size:22px;font-weight:800;line-height:1.25">${esc(r.Tempat_Spesifik)}</h1>
      ${flags.length ? `<div class="row wrap gap-4">${flags.map(f => `<span class="pill pill-flag">${ic('exclamation-triangle')} ${esc(f)}</span>`).join('')}</div>` : ''}
      ${info}
    </div>
    <div class="card stack"><div class="row-between"><b>Bukti Dukung (${files.length})</b>${files.length ? '<span class="text-xs muted">Ketuk untuk pratinjau</span>' : ''}</div>${filesHtml}</div>
    ${mapCard}
  </div>`;

  const right = staff ? `<div class="stack-16">
    <div class="card stack">
      <div class="row gap-12"><div class="avatar md">${esc(initials(r.Nama))}</div><div class="grow"><b>${esc(r.Nama)}</b><div class="mono text-xs muted">NIP ${esc(r.NIP)}</div><div class="text-sm muted">${esc(r.Jabatan)}</div></div></div>
      ${verifyBlock}
      ${canVerify ? `<div class="field"><label for="dvNote">Catatan Kapus (opsional)</label><textarea class="textarea" id="dvNote" style="min-height:80px" maxlength="500" placeholder="Mis. Kegiatan sesuai rencana."></textarea></div>
        <button class="btn btn-primary btn-lg btn-block" id="dvVerify">${ic('check2-circle')} Tandai Diverifikasi</button>` : ''}
      ${isAdmin() ? `<div class="row">${r.Dihapus === 'TRUE' ? `<button class="btn btn-outline grow" id="dvRestore">${ic('arrow-counterclockwise')} Pulihkan</button>` : `<button class="btn btn-outline grow" id="dvEdit">${ic('pencil')} Ubah Data</button><button class="btn btn-danger grow" id="dvDel">${ic('trash3')} Hapus</button>`}</div>` : ''}
    </div>
    <div class="card"><b class="text-sm">Riwayat Kegiatan</b><div class="timeline mt-12">
      <div><span class="mono text-xs">${hhmm(r.Jam_Mulai)}</span> Mulai kegiatan (GPS ±${Math.round(r.Akurasi_Mulai || 0)} m)</div>
      ${r.Jam_Selesai ? `<div><span class="mono text-xs">${hhmm(r.Jam_Selesai)}</span> Selesai · ${files.length} berkas</div>` : ''}
      ${r.Waktu_Sinkron ? `<div><span class="mono text-xs">${esc(String(r.Waktu_Sinkron).slice(11, 16))}</span> Tiba di server (${esc(r.Mode_Input || 'Online')})</div>` : ''}
      ${r.Tgl_Verifikasi ? `<div><span class="mono text-xs">${esc(String(r.Tgl_Verifikasi).slice(5, 16))}</span> Diverifikasi</div>` : ''}
      ${+r.Jumlah_Ubah ? `<div>Diubah ${esc(r.Jumlah_Ubah)} kali</div>` : ''}
    </div></div></div>` : (verifyBlock ? `<div class="card">${verifyBlock}</div>` : '');

  el.innerHTML = staff ? `<div class="split">${left}${right}</div>` : `<div class="stack-16">${left}${right}
    ${own && r.Dihapus !== 'TRUE' ? `<div class="card stack"><div class="row">${canEdit ? `<button class="btn btn-outline grow" id="dvEdit">${ic('pencil')} Ubah Catatan</button>` : ''}${S.user.peran === 'Pegawai' ? `<button class="btn btn-danger grow" id="dvDel" ${canDel ? '' : 'disabled'}>${ic('trash3')} Hapus (1x/hari)</button>` : ''}</div>
      <p class="help">${ic('info-circle')} Ubah/hapus hanya berlaku pada hari yang sama · Sisa hapus hari ini: ${Math.max(0, 1 - S.hapusHariIni)}. Jam &amp; GPS tidak dapat diubah.</p></div>` : ''}</div>`;

  miniMap('mmDetail', [{ lat: r.Lat_Mulai, lng: r.Lng_Mulai, label: 'Mulai', color: '#15803D', acc: r.Akurasi_Mulai }, r.Lat_Selesai ? { lat: r.Lat_Selesai, lng: r.Lng_Selesai, label: 'Selesai', color: '#0EA5E9' } : null], { interactive: staff });

  // Thumbnail dari server (sekali, lalu di-cache di memori)
  const needThumbs = files.some(b => !b.local && b.thumbId !== '' && !S.thumbs[b.id]) && S.online && !local;
  if (needThumbs) api('getThumbs', S.token, r.ID_Kegiatan).then(x => {
    if (!x.success) return;
    Object.assign(S.thumbs, x.data);
    if (S.route === 'detail' && S.params.id === r.ID_Kegiatan) {
      files.forEach((b, i) => { const t = x.data[b.id]; const th = $(`[data-file="${i}"]`); if (t && th) th.innerHTML = `<img src="${t}" alt="">` + (b.source === 'Kamera' ? '<span class="tm">TIMEMARK</span>' : ''); });
    }
  }).catch(() => {});

  $$('[data-file]', el).forEach(t => t.onclick = () => openBerkas(r, +t.dataset.file));
  const v = $('#dvVerify');
  if (v) v.onclick = async () => {
    await enqueue('verifikasi', { ids: [r.ID_Kegiatan], catatan: $('#dvNote').value.trim() }, 'Verifikasi 1 kegiatan');
    toast('success', 'Kegiatan diverifikasi', r.Nama + ' · ' + jenisLabel(r));
    RENDER.detail(p); renderNavState();
  };
  $('#dvEdit') && ($('#dvEdit').onclick = () => editKegModal(r));
  $('#dvDel') && ($('#dvDel').onclick = () => deleteKegModal(r));
  $('#dvRestore') && ($('#dvRestore').onclick = async () => { await enqueue('ubah', { id: r.ID_Kegiatan, fields: { restore: true } }, 'Pulihkan kegiatan'); toast('success', 'Kegiatan dipulihkan'); RENDER.detail(p); });
};

async function openBerkas(r, i) {
  const b = (r.Berkas || [])[i]; if (!b) return;
  const local = S.localFiles[r.ID_Kegiatan];
  if (b.local || (local && local[i])) { if (local && local[i] && local[i].url) previewModal(b.name, local[i].url, 'image/jpeg'); else toast('info', 'Berkas belum terkirim', 'Pratinjau tersedia setelah berkas sampai di server.'); return; }
  if (!S.online) { toast('warning', 'Sedang offline', 'Berkas asli hanya dapat dibuka saat online.'); return; }
  const m = openModal({ title: b.name, size: 'lg', body: `<div class="skel" style="height:320px"></div><p class="text-sm muted mt-8" style="text-align:center">Memuat berkas…</p>` });
  try {
    const x = await api('getBerkas', S.token, r.ID_Kegiatan, b.id);
    m.close();
    if (!x.success) { toast('error', 'Gagal membuka berkas', x.message); return; }
    previewModal(x.data.name, b64ToUrl(x.data.base64, x.data.mime), x.data.mime);
  } catch (e) { m.close(); toast('error', 'Tidak dapat terhubung', e.message); }
}

function editKegModal(r) {
  let jenis = r.Jenis_Kegiatan;
  openModal({
    title: 'Ubah Catatan Kegiatan',
    body: `<div class="stack-16">
      <div class="notice">${ic('lock')}<span>Jam (${hhmm(r.Jam_Mulai)}–${hhmm(r.Jam_Selesai)}) dan titik GPS terkunci dan tidak dapat diubah.</span></div>
      <div class="field"><label>Desa / Kelurahan <span class="req">*</span></label><select class="select" id="eLok">${lokasiOptions(r.Lokasi)}</select></div>
      <div class="field" id="eLokLW" ${r.Lokasi === 'Lainnya' ? '' : 'hidden'}><label>Lokasi Lainnya</label><input class="input" id="eLokL" value="${esc(r.Lokasi_Lainnya || '')}"></div>
      <div class="field"><label>Tempat Spesifik <span class="req">*</span></label><input class="input" id="eTempat" value="${esc(r.Tempat_Spesifik)}" maxlength="200"></div>
      <div class="field"><label>Jenis Kegiatan <span class="req">*</span></label><div class="choice-grid" id="eJenis">${jenisChoices(r.Jenis_Kegiatan)}</div></div>
      <div class="field" id="eJenLW" ${r.Jenis_Kegiatan === 'Lainnya' ? '' : 'hidden'}><label>Jenis Lainnya</label><input class="input" id="eJenL" value="${esc(r.Jenis_Lainnya || '')}"></div>
      ${r.Status_Kegiatan !== 'Berlangsung' ? `<div class="field"><label>Uraian Kegiatan <span class="req">*</span></label><textarea class="textarea" id="eUraian" maxlength="1500">${esc(r.Uraian_Kegiatan)}</textarea></div>
      <div class="field"><label>Keterangan</label><textarea class="textarea" id="eKet" style="min-height:70px" maxlength="800">${esc(r.Keterangan)}</textarea></div>` : ''}
    </div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="eSave">${ic('check2')} Simpan Perubahan</button>`,
    onOpen: m => {
      m.$('#eLok').onchange = e => m.$('#eLokLW').hidden = e.target.value !== 'Lainnya';
      m.$('#eJenis').onclick = e => { const b = e.target.closest('[data-jenis]'); if (!b) return; jenis = b.dataset.jenis; $$('.choice', m.el).forEach(x => x.classList.toggle('active', x === b)); m.$('#eJenLW').hidden = jenis !== 'Lainnya'; };
      m.$('#eSave').onclick = async () => {
        const f = { lokasi: m.$('#eLok').value, lokasiLainnya: m.$('#eLokL').value.trim(), tempat: m.$('#eTempat').value.trim(), jenis, jenisLainnya: m.$('#eJenL').value.trim() };
        if (m.$('#eUraian')) { f.uraian = m.$('#eUraian').value.trim(); f.keterangan = m.$('#eKet').value.trim(); if (!f.uraian) { toast('warning', 'Uraian wajib diisi'); return; } }
        if (!f.lokasi || !f.tempat || !f.jenis) { toast('warning', 'Lengkapi lokasi, tempat, dan jenis kegiatan'); return; }
        if (f.lokasi !== 'Lainnya') f.lokasiLainnya = ''; if (f.jenis !== 'Lainnya') f.jenisLainnya = '';
        m.close();
        await enqueue('ubah', { id: r.ID_Kegiatan, fields: f });
        toast('success', 'Perubahan disimpan');
        renderCurrent();
      };
    }
  });
}

function deleteKegModal(r) {
  openModal({
    title: 'Hapus kegiatan ini?',
    body: `<div class="stack">
      <div class="notice danger">${ic('exclamation-octagon')}<span>${S.user.peran === 'Pegawai' ? 'Anda hanya dapat menghapus <b>1 kali per hari</b>. Data tetap tersimpan untuk audit Admin.' : 'Data ditandai terhapus (hapus lunak) dan dapat dipulihkan Admin.'}</span></div>
      <p><b>${esc(jenisLabel(r))}</b> · ${esc(r.Tempat_Spesifik)}<br><span class="mono text-xs muted">${esc(tglIndo(r.Tanggal))} ${hhmm(r.Jam_Mulai)}</span></p>
      <div class="field"><label for="delWhy">Alasan penghapusan <span class="req">*</span></label><textarea class="textarea" id="delWhy" style="min-height:80px" maxlength="300" placeholder="Mis. salah memilih jenis kegiatan, tercatat ganda…"></textarea></div></div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-danger-solid" id="delOk">${ic('trash3')} Ya, Hapus</button>`,
    onOpen: m => m.$('#delOk').onclick = async () => {
      const why = m.$('#delWhy').value.trim();
      if (!why) { m.$('#delWhy').classList.add('is-invalid'); toast('warning', 'Alasan wajib diisi'); return; }
      m.close();
      await enqueue('hapus', { id: r.ID_Kegiatan, alasan: why });
      toast('success', 'Kegiatan dihapus');
      if (isAdmin()) RENDER.detail({ id: r.ID_Kegiatan }); else back();
    }
  });
}

// ─── W-10 ANTREAN ───────────────────────────────────────────────────────────
RENDER.antrean = function () {
  const ops = S.outbox, n = ops.length;
  $('#pg-antrean').innerHTML = `<div class="stack-16">
    <div class="card stack" style="background:${n ? (S.online ? 'var(--accent-tint)' : 'var(--warn-tint)') : 'var(--primary-tint-2)'}">
      <div class="row gap-12">${ic(n ? (S.online ? 'cloud-arrow-up' : 'cloud-slash') : 'cloud-check', 'text-lg')}
        <div class="grow"><b>${!n ? 'Semua data sudah terkirim' : S.online ? (S.flushing ? 'Sedang mengirim…' : 'Online — siap dikirim') : 'Offline (tidak ada sinyal)'}</b>
        <div class="text-sm">${n ? n + ' data menunggu dikirim ke server' : 'Tidak ada antrean.'}</div></div></div>
      ${n ? `<button class="btn btn-primary" id="aqSend" ${S.online && !S.flushing ? '' : 'disabled'}>${S.flushing ? '<span class="spin"></span> Mengirim…' : ic('send') + ' Kirim Sekarang'}</button>` : ''}
    </div>
    ${n ? `<div><div class="overline mb-8">Daftar antrean lokal</div><div class="stack">${ops.map((o, i) => {
      const r = S.keg.get(o.data.id) || {};
      return `<div class="card row gap-12"><span class="kpi ic ic-amber" style="width:40px;height:40px;padding:0;border:0;box-shadow:none;flex:none">${ic(o.type === 'selesai' ? 'flag' : o.type === 'mulai' ? 'play' : o.type === 'hapus' ? 'trash3' : 'pencil')}</span>
        <div class="grow"><b class="text-sm">${esc(o.label)}${r.Tempat_Spesifik ? ' — ' + esc(r.Tempat_Spesifik) : ''}</b>
          <div class="mono text-xs muted">${esc(o.createdStr)} (waktu HP)${o.data.files ? ' · ' + o.data.files.length + ' berkas, ' + fmtSize(o.data.files.reduce((a, f) => a + f.size, 0)) : ''}</div>
          ${o.lastError ? `<div class="text-xs" style="color:var(--flag-text)">Percobaan ${o.tries}: ${esc(o.lastError).slice(0, 80)}</div>` : ''}</div>
        <span class="pill pill-pending">${i === 0 && S.flushing ? 'Mengirim' : 'Menunggu'}</span></div>`;
    }).join('')}</div></div>` : ''}
    <div class="notice green">${ic('shield-check')}<span><b>Jaminan keamanan data.</b> Antrean tersimpan di memori HP (IndexedDB) dan tidak hilang walau aplikasi ditutup. Buka kembali aplikasi saat ada sinyal agar data terkirim.</span></div>
  </div>`;
  $('#aqSend') && ($('#aqSend').onclick = () => { flushOutbox(); setTimeout(() => RENDER.antrean(), 50); });
};

// ─── W-11 / W-18 LAPORAN PDF ────────────────────────────────────────────────
RENDER.laporan = function () {
  const st = S.ui.laporan, staff = isStaff(), today = todayStr();
  if (!st.tanggal) st.tanggal = today;
  if (!st.bulan) st.bulan = today.slice(0, 7);
  const peg = S.pegawai.filter(x => x.status === 'Aktif').sort((a, b) => a.nama.localeCompare(b.nama));
  if (staff && !st.pegawai && peg.length) st.pegawai = (peg.find(x => x.peran === 'Pegawai') || peg[0]).id;
  const form = `<div class="card stack-16">
    <div class="segmented" role="tablist"><button class="${st.mode === 'harian' ? 'active' : ''}" data-mode="harian">Harian</button><button class="${st.mode === 'bulanan' ? 'active' : ''}" data-mode="bulanan">Bulanan</button></div>
    ${staff ? `<div class="field"><label for="lpPeg">Pegawai <span class="req">*</span></label><input class="input mb-8" id="lpPegQ" placeholder="Cari nama / NIP…"><select class="select" id="lpPeg" size="1">${peg.map(x => `<option value="${x.id}" ${x.id === st.pegawai ? 'selected' : ''}>${esc(x.nama)} — ${esc(x.nip)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label for="lpDate">${st.mode === 'harian' ? 'Pilih Tanggal' : 'Pilih Bulan &amp; Tahun'}</label>
      ${st.mode === 'harian' ? `<input class="input" type="date" id="lpDate" value="${st.tanggal}" max="${today}">` : `<input class="input" type="month" id="lpDate" value="${st.bulan}" max="${today.slice(0, 7)}">`}</div>
    <label class="check"><input type="checkbox" id="lpFoto" ${st.foto ? 'checked' : ''}> Sertakan foto bukti dukung</label>
    <button class="btn btn-primary btn-lg btn-block" id="lpGo" ${S.online ? '' : 'disabled'}>${ic('file-earmark-pdf')} Buat Laporan PDF</button>
    ${S.online ? '' : `<p class="help">${ic('wifi-off')} Pembuatan PDF memerlukan koneksi internet.</p>`}
  </div>`;
  const cfg = S.cfg;
  const preview = `<div class="a4" aria-hidden="true">
    <div class="kop"><div class="lg">${cfg.logoPemda ? `<img src="${cfg.logoPemda}">` : ''}</div><div class="tx"><b>${esc(cfg.namaPemda || 'PEMERINTAH KABUPATEN')}</b><br><b>${esc(cfg.namaDinas || 'DINAS KESEHATAN')}</b><br><b style="font-size:11px">${esc(cfg.namaInstansi || 'UPTD PUSKESMAS KOTA')}</b><br>${esc(cfg.alamat || '')}</div><div class="lg">${cfg.logoPuskesmas ? `<img src="${cfg.logoPuskesmas}">` : ''}</div></div>
    <p style="text-align:center;margin:10px 0 2px"><b><u>LAPORAN ${st.mode === 'harian' ? 'HARIAN' : 'BULANAN'} KEGIATAN LUAR GEDUNG</u></b></p>
    <p style="text-align:center">Periode: ${st.mode === 'harian' ? tglIndo(st.tanggal) : BULAN[+st.bulan.slice(5) - 1] + ' ' + st.bulan.slice(0, 4)}</p><p style="text-align:center;font-size:7px;color:#555">Nomor: 0000/LAP-LG/PKM-KOTA/… · Kode verifikasi: XXXXX-XXXXX-XXXXX-XXXXX</p>
    ${[1, 2, 3, 4, 5, 6, 7].map(() => '<div class="ln"></div>').join('')}
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:20px;text-align:center"><div>Pegawai ybs,<br><br><br>(………………)</div><div style="font-size:7px;line-height:1.3"><div style="width:34px;height:34px;margin:0 auto 3px;background:repeating-conic-gradient(#111 0 25%,#fff 0 50%) 0 0/8px 8px;border:2px solid #111"></div>Kode verifikasi<br><b style="font-family:monospace">XXXXX-XXXXX-…</b></div><div>Kepala Puskesmas,<br><br><br>${esc(cfg.namaKapus || '(………………)')}</div></div></div>`;
  $('#pg-laporan').innerHTML = `
    <div class="page-head"><div><h1>Laporan Kegiatan</h1><p>Rekap PDF A4 dengan kop surat, foto bukti, tanda tangan, nomor dokumen, dan QR verifikasi keaslian.</p></div></div>
    <div class="split">
      <div class="stack-16">${form}
        <div class="card stack"><div class="row-between"><b>Laporan Terakhir</b><button class="btn btn-ghost btn-sm" id="lpRefresh">${ic('arrow-clockwise')}</button></div><div id="lpArsip">${S.arsip ? arsipHtml() : '<div class="skel" style="height:48px"></div><div class="skel mt-8" style="height:48px"></div>'}</div></div>
      </div>
      <div class="hide-sm">${preview}</div>
    </div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; RENDER.laporan(); });
  $('#lpDate').onchange = e => { if (st.mode === 'harian') st.tanggal = e.target.value; else st.bulan = e.target.value; RENDER.laporan(); };
  $('#lpFoto').onchange = e => st.foto = e.target.checked;
  if (staff) {
    $('#lpPeg').onchange = e => st.pegawai = e.target.value;
    $('#lpPegQ').oninput = debounce(e => {
      const q = e.target.value.toLowerCase();
      const opts = peg.filter(x => (x.nama + ' ' + x.nip).toLowerCase().includes(q));
      $('#lpPeg').innerHTML = opts.map(x => `<option value="${x.id}">${esc(x.nama)} — ${esc(x.nip)}</option>`).join('') || '<option value="">Tidak ditemukan</option>';
      st.pegawai = opts[0] ? opts[0].id : '';
    }, 200);
  }
  $('#lpGo').onclick = async e => {
    const btn = e.currentTarget;
    btnLoading(btn, true, 'Menyusun PDF…');
    try {
      const v = await siapkanVerifikasi();
      const r = await api('buatLaporan', S.token, { idPegawai: staff ? st.pegawai : S.user.id, mode: st.mode, tanggal: st.tanggal, bulan: st.bulan, foto: st.foto, kode: v.kode, qr: v.qr, appUrl: v.appUrl });
      if (!r.success) { toast('error', 'Gagal membuat laporan', r.message); return; }
      const url = b64ToUrl(r.data.base64, 'application/pdf');
      toast('success', 'Laporan siap · ' + r.data.nomor, `${r.data.jumlah} kegiatan · kode verifikasi ${r.data.kode}`);
      previewModal(r.data.name, url, 'application/pdf');
      S.arsip = null; loadArsip();
    } catch (x) { toast('error', 'Tidak dapat terhubung', x.message); }
    finally { btnLoading(btn, false); }
  };
  $('#lpRefresh').onclick = () => { S.arsip = null; loadArsip(); };
  if (!S.arsip) loadArsip();
};
/** Kode verifikasi + QR dibuat di browser (qrcode-generator, lazy) → server mencatatnya di DE_Dokumen. */
async function siapkanVerifikasi() {
  const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', a = crypto.getRandomValues(new Uint8Array(20));
  const kode = Array.from(a, b => huruf[b % 32]).join('').replace(/(.{5})(?=.)/g, '$1-');
  const appUrl = location.origin + location.pathname;
  let qr = '';
  try { await loadLib('qr'); const q = qrcode(0, 'M'); q.addData(appUrl.replace(/\/?$/, '/') + '#/cek/' + kode); q.make(); qr = qrPng(q, 6); } catch (e) { /* server memakai QR cadangan */ }
  return { kode, qr, appUrl };
}
function qrPng(q, cell) {
  const n = q.getModuleCount(), m = 4, c = document.createElement('canvas');
  c.width = c.height = (n + m * 2) * cell;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + m) * cell, (r + m) * cell, cell, cell);
  return c.toDataURL('image/png');
}
function arsipHtml() {
  if (!S.arsip.length) return `<p class="text-sm muted">Belum ada laporan.</p>`;
  return S.arsip.slice(0, 8).map(f => `<div class="row gap-12" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--danger);font-size:22px">${ic('file-earmark-pdf-fill')}</span>
    <div class="grow"><div class="text-sm fw-6 ellipsis">${esc(f.name.replace(/_/g, ' ').replace(/\.pdf$/, ''))}</div><div class="mono text-xs muted">${esc(f.dibuat)} · ${fmtSize(f.size)}</div></div>
    <button class="icon-btn" data-dl="${f.id}" aria-label="Unduh">${ic('download')}</button></div>`).join('');
}
async function loadArsip() {
  if (!S.online) { const el = $('#lpArsip'); if (el) el.innerHTML = '<p class="text-sm muted">Arsip tersedia saat online.</p>'; return; }
  try {
    const r = await api('daftarLaporan', S.token);
    S.arsip = r.success ? r.data : [];
    const el = $('#lpArsip'); if (!el) return;
    el.innerHTML = arsipHtml();
    $$('[data-dl]', el).forEach(b => b.onclick = async () => {
      b.innerHTML = '<span class="spin"></span>';
      try { const x = await api('unduhLaporan', S.token, b.dataset.dl); if (x.success) downloadBase64(x.data.base64, x.data.name, 'application/pdf'); else toast('error', 'Gagal mengunduh', x.message); }
      catch (e) { toast('error', 'Tidak dapat terhubung', e.message); }
      b.innerHTML = ic('download');
    });
  } catch (e) { /* abaikan */ }
}

// ─── W-12 AKUN ──────────────────────────────────────────────────────────────
RENDER.akun = function () {
  const u = S.user, dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const row = (icon, label, right, attrs) => `<button class="row gap-12" style="width:100%;padding:14px 4px;border-bottom:1px solid var(--border);text-align:left" ${attrs || ''}>${ic(icon, 'text-lg')}<span class="grow fw-6">${label}</span>${right || ic('chevron-right', 'muted')}</button>`;
  $('#pg-akun').innerHTML = `<div class="stack-16" style="max-width:560px;margin:auto">
    <div class="card row gap-12"><div class="avatar lg">${esc(initials(u.nama))}</div><div class="grow"><div class="fw-7 text-lg">${esc(u.nama)}</div><div class="mono text-xs muted">NIP ${esc(u.nip)}</div><div class="row gap-4 mt-4"><span class="pill pill-role-${u.peran.toLowerCase()}">${esc(u.peran)}</span><span class="text-sm muted ellipsis">${esc(u.jabatan)}</span></div></div></div>
    <div class="card" style="padding:4px 16px">
      ${row('key', 'Ganti Kata Sandi', null, 'id="akPw"')}
      ${u.darurat ? '' : row('whatsapp', 'Nomor WhatsApp', `<span class="mono text-sm muted">${esc(u.noHp || 'Belum diisi')}</span>${ic('chevron-right', 'muted')}`, 'id="akHp"')}
      ${row('moon-stars', 'Mode Gelap', `<label class="switch" onclick="event.stopPropagation()"><input type="checkbox" id="akDark" ${dark ? 'checked' : ''}><span></span></label>`, 'id="akDarkRow"')}
      ${row('cloud-arrow-up', 'Antrean Offline', `<span class="badge" ${S.outbox.length ? '' : 'hidden'}>${S.outbox.length}</span>${ic('chevron-right', 'muted')}`, 'data-go="antrean"')}
      ${row('question-circle', 'Panduan Penggunaan', null, 'id="akGuide"')}
      ${row('arrow-repeat', 'Sinkronkan Sekarang', `<span class="mono text-xs muted">${S.lastSync ? S.lastSync.slice(11, 16) : ''}</span>`, 'data-action="sync"')}
    </div>
    <button class="btn btn-danger btn-lg btn-block" data-action="logout">${ic('box-arrow-right')} Keluar dari Akun</button>
    <p class="text-xs muted" style="text-align:center">SIMONIK-LG v2.0 · ${esc(titleCase(S.cfg.namaInstansi || 'UPTD Puskesmas Kota'))}</p>
  </div>`;
  $('#akPw').onclick = () => openModal({ title: 'Ganti Kata Sandi', body: pwFormHtml(), foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="pwSave">Simpan</button>`, onOpen: m => bindPwForm(m) });
  $('#akDark').onchange = () => toggleTheme();
  $('#akDarkRow').onclick = () => { $('#akDark').checked = !$('#akDark').checked; toggleTheme(); };
  $('#akGuide').onclick = showGuide;
  if ($('#akHp')) $('#akHp').onclick = () => openModal({
    title: 'Nomor WhatsApp', body: `<div class="stack-16"><p class="text-sm muted">Dipakai untuk pengingat & notifikasi kegiatan lewat WhatsApp. Tidak ditampilkan di halaman publik.</p>
      <div class="field"><label for="akHpIn">No. WhatsApp</label><input class="input mono" id="akHpIn" type="tel" inputmode="tel" value="${esc(u.noHp || '')}" placeholder="08xxxxxxxxxx"></div></div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="akHpSave">${ic('check2')} Simpan</button>`,
    onOpen: m => m.$('#akHpSave').onclick = async ev => {
      btnLoading(ev.currentTarget, true, 'Menyimpan…');
      try { const r = await api('simpanProfil', S.token, { noHp: m.$('#akHpIn').value.trim() }); if (!r.success) return toast('error', 'Gagal', r.message); S.user = Object.assign(S.user, (r.data && r.data.user) || {}); saveSnapshot(); m.close(); toast('success', r.message); RENDER.akun(); }
      catch (x) { toast('error', 'Tidak dapat terhubung', x.message); } finally { btnLoading(ev.currentTarget, false); }
    }
  });
};

function showGuide() {
  const staff = isStaff();
  const steps = staff ? [
    ['grid-1x2', 'Dashboard', 'Pantau jumlah kegiatan, pegawai yang sedang bertugas, dan kegiatan yang belum diverifikasi. Grafik diperbarui otomatis.'],
    ['patch-check', 'Verifikasi', 'Buka menu Verifikasi, periksa foto & titik GPS, lalu centang beberapa kegiatan sekaligus dan tekan "Verifikasi Terpilih".'],
    ['map', 'Peta Sebaran', 'Lihat titik lokasi kegiatan. Penanda bercincin oranye berarti perlu ditinjau (GPS kurang akurat / jarak jauh).'],
    ['file-earmark-pdf', 'Laporan PDF', 'Pilih pegawai dan periode, lalu buat PDF lengkap dengan kop surat dan kolom tanda tangan.']
  ] : [
    ['geo-alt', 'Aktifkan GPS', 'Nyalakan lokasi di HP dan izinkan browser mengakses lokasi.'],
    ['play-fill', 'Mulai Kegiatan', 'Saat tiba di lokasi, tekan MULAI KEGIATAN, pilih desa, tempat, dan jenis kegiatan, lalu Mulai Sekarang. Jam & GPS tercatat otomatis.'],
    ['camera', 'Ambil Foto Bukti', 'Saat selesai, tekan SELESAI KEGIATAN, isi uraian, ambil 1–3 foto (cap timemark otomatis), lalu Selesaikan & Kirim.'],
    ['cloud-slash', 'Tidak Ada Sinyal?', 'Tetap isi seperti biasa. Data tersimpan di HP dan terkirim otomatis saat sinyal kembali. Buka aplikasi sekali saat ada sinyal sebelum berangkat.'],
    ['pencil', 'Salah Isi?', 'Buka Riwayat → Detail. Ubah hanya bisa di hari yang sama; hapus maksimal 1 kali per hari.']
  ];
  openModal({ title: 'Panduan Penggunaan', body: `<div class="stack">${steps.map((s, i) => `<div class="row gap-12" style="align-items:flex-start"><span class="kpi ic ic-green" style="width:40px;height:40px;padding:0;border:0;box-shadow:none;flex:none">${ic(s[0])}</span><div><b>${i + 1}. ${s[1]}</b><p class="text-sm muted">${s[2]}</p></div></div>`).join('')}</div>`, foot: `<button class="btn btn-primary" data-close>Mengerti</button>` });
}

'use strict';
/* ============================================================================
   HALAMAN KAPUS & ADMIN: Dashboard, Data, Verifikasi, Peta, Pegawai, Master, Pengaturan, Log
   ============================================================================ */
function verifQueue() {
  if (!S.user || S.user.peran === 'Pegawai') return [];
  return liveRows().filter(r => r.Status_Verifikasi !== 'Diverifikasi' && r.Status_Kegiatan !== 'Berlangsung');
}
function pegawaiOptions(sel, all = 'Semua pegawai') {
  return `<option value="">${all}</option>` + S.pegawai.filter(p => p.peran !== 'Kapus').sort((a, b) => a.nama.localeCompare(b.nama))
    .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nama)}</option>`).join('');
}
function countBy(rows, fn) { const m = {}; rows.forEach(r => { const k = fn(r); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function kpi(icon, cls, v, k, t, attrs) {
  return `<div class="kpi ${attrs ? 'click' : ''}" ${attrs || ''}><div class="row-between"><span class="ic ${cls}">${ic(icon)}</span>${attrs ? ic('arrow-right', 'muted') : ''}</div><div class="v tnum">${v}</div><div><div class="k">${k}</div>${t ? `<div class="t">${t}</div>` : ''}</div></div>`;
}

// ─── W-13 DASHBOARD ─────────────────────────────────────────────────────────
RENDER.dashboard = async function () {
  const st = S.ui.dash, today = todayStr(), month = today.slice(0, 7);
  if (!st.from) { st.from = month + '-01'; st.to = today; }
  let from, to, label;
  if (st.mode === 'hari') { from = to = today; label = 'Hari ini'; }
  else if (st.mode === 'bulan') { from = month + '-01'; to = today; label = 'Bulan ini'; }
  else { from = st.from; to = st.to; label = `${tglIndo(from, true)} – ${tglIndo(to, true)}`; }

  const live = liveRows();
  const period = live.filter(r => r.Tanggal >= from && r.Tanggal <= to);
  const todayRows = live.filter(r => r.Tanggal === today);
  const monthRows = live.filter(r => r.Tanggal.startsWith(month));
  const prevMonth = addDays(month + '-01', -1).slice(0, 7);
  const prevCount = S.stats ? S.stats.perBulan[+prevMonth.slice(5) - 1] : 0;
  const bertugas = new Set(todayRows.filter(r => r.Status_Kegiatan === 'Berlangsung').map(r => r.ID_Pegawai)).size;
  const vq = verifQueue();
  const tidak = live.filter(r => r.Status_Kegiatan === 'Tidak Diselesaikan' && r.Tanggal >= addDays(today, -7) && r.Status_Verifikasi !== 'Diverifikasi');
  const trend = prevCount ? Math.round((monthRows.length - prevCount) / prevCount * 100) : null;

  const perDesa = countBy(period, lokasiLabel);
  const perJenis = countBy(period, r => r.Jenis_Kegiatan);
  const perPeg = countBy(period, r => r.ID_Pegawai + '|' + r.Nama).slice(0, 5);
  const verified = period.filter(r => r.Status_Verifikasi === 'Diverifikasi').length;
  const flagged = period.filter(r => flagsOf(r).length).length;
  const offline = period.filter(r => r.Mode_Input === 'Offline').length;
  const desaNol = S.master.lokasi.filter(l => l.aktif && l.tipe !== 'Lainnya' && !perDesa.find(d => d[0] === l.nama)).map(l => l.nama);

  const insight = [];
  if (period.length) {
    insight.push(`<b>${period.length}</b> kegiatan tercatat (${label.toLowerCase()}) oleh <b>${new Set(period.map(r => r.ID_Pegawai)).size}</b> pegawai.`);
    if (perDesa[0]) insight.push(`Wilayah paling banyak dikunjungi: <b>${esc(perDesa[0][0])}</b> (${perDesa[0][1]} kegiatan).`);
    if (perJenis[0]) insight.push(`Jenis kegiatan terbanyak: <b>${esc(perJenis[0][0])}</b> (${Math.round(perJenis[0][1] / period.length * 100)}%).`);
    insight.push(`Tingkat verifikasi <b>${Math.round(verified / period.length * 100)}%</b>${vq.length ? ` — ${vq.length} kegiatan menunggu verifikasi` : ''}.`);
    if (flagged) insight.push(`<span style="color:var(--flag-text)"><b>${flagged}</b> kegiatan memiliki penanda yang perlu ditinjau (GPS/foto/jam).</span>`);
    if (offline) insight.push(`${offline} kegiatan diinput dalam mode offline (area sinyal lemah).`);
    if (desaNol.length && st.mode !== 'hari') insight.push(`Belum ada kegiatan di: ${desaNol.slice(0, 6).map(esc).join(', ')}${desaNol.length > 6 ? ` dan ${desaNol.length - 6} lainnya` : ''}.`);
  } else insight.push('Belum ada kegiatan pada periode ini.');

  const recent = live.slice().sort((a, b) => (b.Tanggal + (b.Jam_Selesai || b.Jam_Mulai)).localeCompare(a.Tanggal + (a.Jam_Selesai || a.Jam_Mulai))).slice(0, 6);

  $('#pg-dashboard').innerHTML = `
    <div class="page-head"><div><h1>Dashboard Ringkasan</h1><p>Monitoring kegiatan luar gedung · ${esc(titleCase(S.cfg.namaInstansi || 'UPTD Puskesmas Kota'))} · ${hariOf(today)}, ${tglIndo(today)}</p></div>
      <div class="row wrap"><div class="segmented" style="width:auto">${[['hari', 'Hari Ini'], ['bulan', 'Bulan Ini'], ['rentang', 'Rentang']].map(m => `<button class="${st.mode === m[0] ? 'active' : ''}" data-dm="${m[0]}" style="padding:0 14px">${m[1]}</button>`).join('')}</div>
      ${st.mode === 'rentang' ? `<input type="date" class="input" id="dFrom" value="${st.from}" style="width:auto;min-height:44px"><input type="date" class="input" id="dTo" value="${st.to}" max="${today}" style="width:auto;min-height:44px">` : ''}</div></div>
    ${tidak.length ? `<div class="notice danger mb-16">${ic('exclamation-octagon')}<div class="grow row-between wrap"><span><b>${tidak.length} kegiatan Tidak Diselesaikan</b> dalam 7 hari terakhir — perlu ditinjau.</span><button class="btn btn-danger btn-sm" id="dTinjau">Tinjau</button></div></div>` : ''}
    <div class="grid-4 mb-16">
      ${kpi('calendar-check', 'ic-green', todayRows.length, 'Kegiatan Hari Ini', `${todayRows.filter(r => r.Status_Kegiatan === 'Selesai').length} selesai`)}
      ${kpi('bar-chart', 'ic-sky', monthRows.length, 'Kegiatan Bulan Ini', trend == null ? 'Bulan ' + BULAN[+month.slice(5) - 1] : `${trend >= 0 ? '▲ +' : '▼ '}${trend}% vs bulan lalu`)}
      ${kpi('person-walking', 'ic-amber', bertugas, 'Sedang Bertugas', 'pegawai di lapangan saat ini')}
      ${kpi('hourglass-split', 'ic-orange', vq.length, 'Belum Diverifikasi', 'Ketuk untuk verifikasi', 'data-go="verifikasi"')}
    </div>
    <div class="dash-grid two mb-16">
      <div class="card"><div class="row-between mb-12"><b>Jumlah Kegiatan per Bulan</b><span class="mono text-xs muted">${S.stats ? S.stats.year : ''}</span></div><div class="chart-box"><canvas id="chBulan" aria-label="Grafik kegiatan per bulan"></canvas></div></div>
      <div class="card"><div class="row-between mb-12"><b>Per Jenis Kegiatan</b><span class="text-xs muted">${esc(label)}</span></div><div class="chart-box"><canvas id="chJenis" aria-label="Grafik per jenis kegiatan"></canvas></div></div>
    </div>
    <div class="dash-grid two mb-16">
      <div class="card"><div class="row-between mb-12"><b>Kegiatan per Desa/Kelurahan</b><span class="text-xs muted">${esc(label)}</span></div><div class="chart-box tall"><canvas id="chDesa" aria-label="Grafik per desa"></canvas></div></div>
      <div class="stack-16">
        <div class="card"><b>Pegawai Paling Aktif</b><div class="mt-8">${perPeg.length ? perPeg.map((p, i) => { const [id, nm] = p[0].split('|'); return `<div class="rank"><span class="no ${i < 3 ? 'g' + (i + 1) : ''}">${i + 1}</span><div class="avatar sm">${esc(initials(nm))}</div><span class="grow ellipsis fw-6 text-sm">${esc(nm)}</span><span class="pill pill-green mono">${p[1]}</span></div>`; }).join('') : '<p class="text-sm muted mt-8">Belum ada data.</p>'}</div></div>
        <div class="insight"><b class="row">${ic('stars')} Insight Otomatis</b><ul>${insight.map(i => `<li>${i}</li>`).join('')}</ul></div>
      </div>
    </div>
    <div class="card"><div class="row-between mb-12"><b>Kegiatan Terbaru</b><button class="btn btn-ghost btn-sm" data-go="data">Lihat semua ${ic('chevron-right')}</button></div>
      ${recent.length ? `<div class="table-wrap" style="border:0"><table class="tbl" style="min-width:640px"><thead><tr><th>Waktu</th><th>Pegawai</th><th>Jenis</th><th>Desa · Tempat</th><th>Status</th><th></th></tr></thead><tbody>
      ${recent.map(r => `<tr data-go="detail" data-id="${esc(r.ID_Kegiatan)}"><td class="mono text-xs">${tglIndo(r.Tanggal, true)}<br>${hhmm(r.Jam_Mulai)}–${hhmm(r.Jam_Selesai)}</td><td class="fw-6">${esc(r.Nama)}</td><td><span class="row"><span class="cat-dot" style="--kc:${jenisInfo(r.Jenis_Kegiatan).warna}"></span>${esc(jenisLabel(r))}</span></td><td>${esc(lokasiLabel(r))}<div class="text-xs muted">${esc(r.Tempat_Spesifik)}</div></td><td>${statusPill(r)} ${verifPill(r)}</td><td>${ic('chevron-right', 'muted')}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('inbox', 'Belum ada kegiatan')}</div>`;

  $$('[data-dm]').forEach(b => b.onclick = () => { st.mode = b.dataset.dm; RENDER.dashboard(); });
  const rangeChange = async () => { st.from = $('#dFrom').value; st.to = $('#dTo').value; if (st.from > st.to) [st.from, st.to] = [st.to, st.from]; if (await ensureRange(st.from).catch(() => false)) {} RENDER.dashboard(); };
  $('#dFrom') && ($('#dFrom').onchange = rangeChange);
  $('#dTo') && ($('#dTo').onchange = rangeChange);
  $('#dTinjau') && ($('#dTinjau').onclick = () => { Object.assign(S.ui.data, { tab: 'tidak', from: addDays(today, -7), to: today, page: 1 }); go('data'); });

  try { await loadLib('chart'); } catch (e) { $$('#pg-dashboard .chart-box').forEach(b => b.innerHTML = `<div class="map-empty">${ic('wifi-off')} Grafik tidak dapat dimuat</div>`); return; }
  if (S.route !== 'dashboard') return;
  drawCharts(perJenis, perDesa);
};

function drawCharts(perJenis, perDesa) {
  Object.values(S.charts).forEach(c => c.destroy()); S.charts = {};
  const text = cssVar('--muted'), grid = cssVar('--border'), primary = cssVar('--primary'), accent = cssVar('--accent');
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  Chart.defaults.color = text;
  const base = { responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: { padding: 10, cornerRadius: 10 } } };
  const el1 = $('#chBulan');
  if (el1 && S.stats) {
    const g = el1.getContext('2d').createLinearGradient(0, 0, 0, 240);
    g.addColorStop(0, primary + '55'); g.addColorStop(1, primary + '00');
    S.charts.bulan = new Chart(el1, { type: 'line', data: { labels: BLN, datasets: [
      { label: String(S.stats.year), data: S.stats.perBulan, borderColor: primary, backgroundColor: g, fill: true, tension: .35, pointRadius: 3, borderWidth: 2.5 },
      { label: String(S.stats.year - 1), data: S.stats.perBulanLalu, borderColor: accent, borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5, tension: .35 }
    ] }, options: { ...base, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 } } } } });
  }
  const el2 = $('#chJenis');
  if (el2) {
    const total = perJenis.reduce((a, b) => a + b[1], 0);
    S.charts.jenis = new Chart(el2, { type: 'doughnut', data: { labels: perJenis.map(x => x[0]), datasets: [{ data: perJenis.map(x => x[1]), backgroundColor: perJenis.map(x => jenisInfo(x[0]).warna), borderColor: cssVar('--surface'), borderWidth: 3 }] },
      options: { ...base, cutout: '64%', plugins: { ...base.plugins, legend: { position: 'right', labels: { boxWidth: 10, usePointStyle: true, font: { size: 11.5 } } } } },
      plugins: [{ id: 'center', afterDraw(c) { const { ctx, chartArea: a } = c; ctx.save(); ctx.fillStyle = cssVar('--text'); ctx.textAlign = 'center'; ctx.font = "800 26px 'Plus Jakarta Sans'"; ctx.fillText(total, (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 4); ctx.font = "600 11px 'Plus Jakarta Sans'"; ctx.fillStyle = text; ctx.fillText('kegiatan', (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 22); ctx.restore(); } }] });
  }
  const el3 = $('#chDesa');
  if (el3) {
    const all = S.master.lokasi.filter(l => l.tipe !== 'Lainnya' && l.aktif).map(l => [l.nama, (perDesa.find(d => d[0] === l.nama) || [0, 0])[1]]);
    perDesa.forEach(d => { if (!all.find(a => a[0] === d[0])) all.push(d); });
    all.sort((a, b) => b[1] - a[1]);
    S.charts.desa = new Chart(el3, { type: 'bar', data: { labels: all.map(x => x[0]), datasets: [{ label: 'Kegiatan', data: all.map(x => x[1]), backgroundColor: all.map((x, i) => i === 0 && x[1] ? primary : accent), borderRadius: 6, barThickness: 14 }] },
      options: { ...base, indexAxis: 'y', plugins: { ...base.plugins, legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 11.5 } } } } } });
  }
}

// ─── W-14 DATA KEGIATAN ─────────────────────────────────────────────────────
function filterData(st, ignoreTab) {
  let rows = allRows();
  if (!isAdmin() || st.tab !== 'hapus') rows = rows.filter(r => r.Dihapus !== 'TRUE');
  if (st.from) rows = rows.filter(r => r.Tanggal >= st.from);
  if (st.to) rows = rows.filter(r => r.Tanggal <= st.to);
  if (st.pegawai) rows = rows.filter(r => r.ID_Pegawai === st.pegawai);
  if (st.lokasi) rows = rows.filter(r => r.Lokasi === st.lokasi);
  if (st.jenis) rows = rows.filter(r => r.Jenis_Kegiatan === st.jenis);
  if (st.verif) rows = rows.filter(r => r.Status_Verifikasi === st.verif && r.Status_Kegiatan !== 'Berlangsung');
  if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter(r => [r.Nama, r.NIP, r.Uraian_Kegiatan, r.Tempat_Spesifik, lokasiLabel(r), jenisLabel(r)].join(' ').toLowerCase().includes(q)); }
  if (!ignoreTab) {
    if (st.tab === 'berlangsung') rows = rows.filter(r => r.Status_Kegiatan === 'Berlangsung');
    if (st.tab === 'selesai') rows = rows.filter(r => r.Status_Kegiatan === 'Selesai');
    if (st.tab === 'tidak') rows = rows.filter(r => r.Status_Kegiatan === 'Tidak Diselesaikan');
    if (st.tab === 'hapus') rows = rows.filter(r => r.Dihapus === 'TRUE');
  }
  return rows.sort(byNewest);
}

RENDER.data = async function (p, soft) {
  const st = S.ui.data, today = todayStr();
  if (!st.from) { st.from = today.slice(0, 8) + '01'; st.to = today; }
  const base = filterData(st, true);
  const rows = filterData(st);
  const tabs = [['semua', 'Semua', base.length], ['berlangsung', 'Berlangsung', base.filter(r => r.Status_Kegiatan === 'Berlangsung').length], ['selesai', 'Selesai', base.filter(r => r.Status_Kegiatan === 'Selesai').length], ['tidak', 'Tidak Diselesaikan', base.filter(r => r.Status_Kegiatan === 'Tidak Diselesaikan').length]];
  if (isAdmin()) tabs.push(['hapus', 'Terhapus', allRows().filter(r => r.Dihapus === 'TRUE').length]);
  const size = 20, pages = Math.max(1, Math.ceil(rows.length / size));
  if (st.page > pages) st.page = pages;
  const pageRows = rows.slice((st.page - 1) * size, st.page * size);
  [...st.sel].forEach(id => { if (!S.keg.has(id)) st.sel.delete(id); });
  const desk = isDesktop();

  const table = `<div class="table-wrap"><table class="tbl"><thead><tr>
      <th style="width:40px"><label class="check"><input type="checkbox" id="selAll" aria-label="Pilih semua di halaman ini"></label></th><th>Tanggal</th><th>Nama / NIP</th><th>Jenis Kegiatan</th><th>Desa · Tempat</th><th>Jam</th><th>Berkas</th><th>Mode</th><th>Status</th><th>Verifikasi</th><th></th></tr></thead><tbody>
    ${pageRows.map(r => `<tr class="${st.sel.has(r.ID_Kegiatan) ? 'selected' : ''}" data-row="${esc(r.ID_Kegiatan)}">
      <td onclick="event.stopPropagation()"><label class="check"><input type="checkbox" data-sel="${esc(r.ID_Kegiatan)}" ${st.sel.has(r.ID_Kegiatan) ? 'checked' : ''} ${r.Status_Kegiatan === 'Berlangsung' || r.Status_Verifikasi === 'Diverifikasi' || r.Dihapus === 'TRUE' ? 'disabled' : ''} aria-label="Pilih"></label></td>
      <td class="mono text-xs">${esc(r.Hari || hariOf(r.Tanggal))}<br>${tglIndo(r.Tanggal, true)}</td>
      <td><div class="row"><div class="avatar sm">${esc(initials(r.Nama))}</div><div><div class="fw-6">${esc(r.Nama)}</div><div class="mono text-xs muted">${esc(r.NIP)}</div></div></div></td>
      <td><span class="row"><span class="cat-dot" style="--kc:${jenisInfo(r.Jenis_Kegiatan).warna}"></span>${esc(jenisLabel(r))}</span></td>
      <td><div class="fw-6">${esc(lokasiLabel(r))}</div><div class="text-xs muted ellipsis" style="max-width:200px">${esc(r.Tempat_Spesifik)}</div></td>
      <td class="mono text-xs">${hhmm(r.Jam_Mulai)}–${hhmm(r.Jam_Selesai)}</td>
      <td class="mono">${ic('paperclip')} ${+r.Jumlah_Berkas || 0}</td>
      <td>${r.Mode_Input === 'Offline' ? `<span title="Input offline">${ic('cloud-slash', 'muted')}</span>` : `<span title="Online">${ic('wifi', 'muted')}</span>`}${flagsOf(r).length ? ` <span title="${esc(flagsOf(r).join(', '))}" style="color:var(--flag-text)">${ic('exclamation-triangle-fill')}</span>` : ''}</td>
      <td>${statusPill(r)}</td><td>${verifPill(r) || '<span class="muted">–</span>'}</td>
      <td class="act">${ic('chevron-right')}</td></tr>`).join('') || `<tr><td colspan="11">${emptyState('inbox', 'Tidak ada data', 'Ubah filter atau rentang tanggal.')}</td></tr>`}
    </tbody></table></div>`;
  const cards = `<div class="stack">${pageRows.map(r => kcard(r, { showName: true })).join('') || emptyState('inbox', 'Tidak ada data', 'Ubah filter atau rentang tanggal.')}</div>`;

  $('#pg-data').innerHTML = `
    <div class="page-head"><div><h1>Data Kegiatan Pegawai</h1><p>Telusuri, saring, dan verifikasi kegiatan luar gedung seluruh pegawai.</p></div>
      <div class="row wrap"><button class="btn btn-outline" id="dExport">${ic('file-earmark-spreadsheet')} Ekspor Excel</button><button class="btn btn-primary" data-go="laporan">${ic('file-earmark-pdf')} Buat Laporan PDF</button></div></div>
    <div class="card mb-16"><div class="filter-bar">
      <div class="input-icon">${ic('search')}<input class="input" id="fQ" placeholder="Cari nama, NIP, uraian, tempat…" value="${esc(st.q)}"></div>
      <select class="select" id="fPeg">${pegawaiOptions(st.pegawai)}</select>
      <input type="date" class="input" id="fFrom" value="${st.from}" aria-label="Dari tanggal" style="flex:0 1 160px"><input type="date" class="input" id="fTo" value="${st.to}" max="${today}" aria-label="Sampai tanggal" style="flex:0 1 160px">
      <select class="select" id="fLok"><option value="">Semua desa/kel.</option>${S.master.lokasi.map(l => `<option ${st.lokasi === l.nama ? 'selected' : ''}>${esc(l.nama)}</option>`).join('')}</select>
      <select class="select" id="fJen"><option value="">Semua jenis</option>${S.master.jenis.map(l => `<option ${st.jenis === l.nama ? 'selected' : ''}>${esc(l.nama)}</option>`).join('')}</select>
      <select class="select" id="fVer"><option value="">Semua verifikasi</option><option ${st.verif === 'Tercatat' ? 'selected' : ''} value="Tercatat">Belum diverifikasi</option><option ${st.verif === 'Diverifikasi' ? 'selected' : ''}>Diverifikasi</option></select>
      <button class="btn btn-ghost" id="fReset">Reset</button>
    </div></div>
    <div class="tabs mb-12">${tabs.map(t => `<button class="tab ${st.tab === t[0] ? 'active' : ''}" data-tab="${t[0]}">${t[1]}<span class="count">${t[2]}</span></button>`).join('')}</div>
    <div id="dLoading"></div>
    ${desk ? table : cards}
    <div class="pager"><span>Menampilkan ${rows.length ? (st.page - 1) * size + 1 : 0}–${Math.min(st.page * size, rows.length)} dari ${rows.length} data</span>
      <div class="pages"><button data-pg="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">${ic('chevron-left')}</button>${pageButtons(st.page, pages)}<button data-pg="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''} aria-label="Berikutnya">${ic('chevron-right')}</button></div></div>
    ${st.sel.size ? `<div class="bulk-bar"><b>${st.sel.size} dipilih</b><input class="input" id="bNote" placeholder="Catatan untuk semua (opsional)" maxlength="300"><button class="btn btn-primary" id="bVerify">${ic('check2-all')} Verifikasi Terpilih</button><button class="btn btn-ghost" style="color:#fff" id="bClear">Batal</button></div>` : ''}`;

  const el = $('#pg-data');
  const rerender = () => RENDER.data();
  $('#fQ').oninput = debounce(e => { st.q = e.target.value; st.page = 1; rerender(); setTimeout(() => { const q = $('#fQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 0); }, 300);
  const sel = (id, key) => $(id).onchange = async e => {
    st[key] = e.target.value; st.page = 1;
    if (key === 'from' && st.from && S.loadedFrom && st.from < S.loadedFrom) {
      $('#dLoading').innerHTML = `<div class="notice mb-12"><span class="spin"></span><span>Memuat data sejak ${tglIndo(st.from)}…</span></div>`;
      try { await ensureRange(st.from); } catch (x) { toast('warning', 'Data lama tidak dapat dimuat', x.message); }
    }
    rerender();
  };
  sel('#fPeg', 'pegawai'); sel('#fFrom', 'from'); sel('#fTo', 'to'); sel('#fLok', 'lokasi'); sel('#fJen', 'jenis'); sel('#fVer', 'verif');
  $('#fReset').onclick = () => { Object.assign(st, { q: '', pegawai: '', from: today.slice(0, 8) + '01', to: today, lokasi: '', jenis: '', verif: '', tab: 'semua', page: 1 }); st.sel.clear(); rerender(); };
  $$('[data-tab]', el).forEach(b => b.onclick = () => { st.tab = b.dataset.tab; st.page = 1; rerender(); });
  $$('[data-pg]', el).forEach(b => b.onclick = () => { st.page = +b.dataset.pg; rerender(); window.scrollTo(0, 0); });
  $$('[data-row]', el).forEach(tr => tr.onclick = () => go('detail', { id: tr.dataset.row }));
  $$('[data-sel]', el).forEach(c => c.onchange = () => { c.checked ? st.sel.add(c.dataset.sel) : st.sel.delete(c.dataset.sel); rerender(); });
  const all = $('#selAll');
  if (all) {
    const eligible = pageRows.filter(r => r.Status_Kegiatan !== 'Berlangsung' && r.Status_Verifikasi !== 'Diverifikasi' && r.Dihapus !== 'TRUE');
    all.checked = eligible.length && eligible.every(r => st.sel.has(r.ID_Kegiatan));
    all.onchange = () => { eligible.forEach(r => all.checked ? st.sel.add(r.ID_Kegiatan) : st.sel.delete(r.ID_Kegiatan)); rerender(); };
  }
  $('#bClear') && ($('#bClear').onclick = () => { st.sel.clear(); rerender(); });
  $('#bVerify') && ($('#bVerify').onclick = async () => {
    const ids = [...st.sel], note = $('#bNote').value.trim();
    await enqueue('verifikasi', { ids, catatan: note }, `Verifikasi ${ids.length} kegiatan`);
    st.sel.clear(); toast('success', `${ids.length} kegiatan diverifikasi`); rerender();
  });
  $('#dExport').onclick = () => exportCsv(rows);
};
function pageButtons(cur, n) {
  const out = []; const add = i => out.push(`<button data-pg="${i}" class="${i === cur ? 'active' : ''}">${i}</button>`);
  for (let i = 1; i <= n; i++) { if (i === 1 || i === n || Math.abs(i - cur) <= 1) add(i); else if (out[out.length - 1] !== '…') out.push('…'); }
  return out.map(x => x === '…' ? '<span style="padding:0 4px">…</span>' : x).join('');
}
function exportCsv(rows) {
  const cols = ['ID_Kegiatan', 'Tanggal', 'Hari', 'Nama', 'NIP', 'Jabatan', 'Jam_Mulai', 'Jam_Selesai', 'Lokasi', 'Lokasi_Lainnya', 'Tempat_Spesifik', 'Jenis_Kegiatan', 'Jenis_Lainnya', 'Uraian_Kegiatan', 'Keterangan', 'Lat_Mulai', 'Lng_Mulai', 'Lat_Selesai', 'Lng_Selesai', 'Jumlah_Berkas', 'Status_Kegiatan', 'Status_Verifikasi', 'Diverifikasi_Oleh', 'Catatan_Kapus', 'Mode_Input', 'Peringatan'];
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const csv = '﻿' + cols.join(';') + '\n' + rows.map(r => cols.map(c => q(c === 'Tanggal' || c === 'NIP' ? '\t' + r[c] : r[c])).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `Data_Kegiatan_${todayStr()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('success', 'Ekspor selesai', `${rows.length} baris · buka dengan Microsoft Excel.`);
}

// ─── W-16 VERIFIKASI ────────────────────────────────────────────────────────
RENDER.verifikasi = function () {
  const st = S.ui.verif;
  let rows = verifQueue().sort(byNewest);
  if (st.pegawai) rows = rows.filter(r => r.ID_Pegawai === st.pegawai);
  if (st.flagged) rows = rows.filter(r => flagsOf(r).length);
  [...st.sel].forEach(id => { if (!rows.find(r => r.ID_Kegiatan === id)) st.sel.delete(id); });
  const el = $('#pg-verifikasi');
  el.innerHTML = `
    <div class="page-head"><div><h1 class="row">Menunggu Verifikasi <span class="badge" style="background:var(--flag-text);height:26px;min-width:26px;font-size:13px">${verifQueue().length}</span></h1><p>Periksa bukti dan titik GPS, lalu verifikasi satu per satu atau sekaligus.</p></div>
      <div class="row wrap"><select class="select" id="vPeg" style="width:auto;min-height:44px">${pegawaiOptions(st.pegawai)}</select>
      <label class="check card" style="padding:8px 12px;box-shadow:none"><input type="checkbox" id="vFlag" ${st.flagged ? 'checked' : ''}> Hanya yang ditandai ${ic('exclamation-triangle', 'muted')}</label>
      ${rows.length ? `<button class="btn btn-outline" id="vAll">${st.sel.size === rows.length ? 'Batal pilih' : 'Pilih semua'}</button>` : ''}</div></div>
    ${rows.length ? `<div class="dash-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${rows.slice(0, 120).map(r => {
      const fl = flagsOf(r);
      return `<div class="card stack ${st.sel.has(r.ID_Kegiatan) ? 'card-green' : ''}" style="padding:14px">
        <div class="row gap-12"><label class="check"><input type="checkbox" data-vsel="${esc(r.ID_Kegiatan)}" ${st.sel.has(r.ID_Kegiatan) ? 'checked' : ''} aria-label="Pilih"></label>
          <div class="avatar sm">${esc(initials(r.Nama))}</div><div class="grow"><div class="fw-6 ellipsis">${esc(r.Nama)}</div><div class="mono text-xs muted">${tglIndo(r.Tanggal, true)} · ${hhmm(r.Jam_Mulai)}–${hhmm(r.Jam_Selesai)}</div></div>${statusPill(r)}</div>
        <div><div class="row">${catPill(r)}</div><div class="fw-7 mt-8">${esc(r.Tempat_Spesifik)}</div><div class="text-sm muted">${ic('geo-alt')} ${esc(lokasiFull(r))} · ${ic('paperclip')} ${+r.Jumlah_Berkas || 0} berkas</div>
          ${r.Uraian_Kegiatan ? `<p class="text-sm clamp2 mt-4">${esc(r.Uraian_Kegiatan)}</p>` : ''}</div>
        ${fl.length ? `<div class="row wrap gap-4">${fl.map(f => `<span class="pill pill-flag">${ic('exclamation-triangle')} ${esc(f)}</span>`).join('')}</div>` : ''}
        <div class="row"><button class="btn btn-outline btn-sm grow" data-go="detail" data-id="${esc(r.ID_Kegiatan)}">${ic('eye')} Lihat Detail</button><button class="btn btn-primary btn-sm grow" data-v1="${esc(r.ID_Kegiatan)}">${ic('check2')} Verifikasi</button></div>
      </div>`;
    }).join('')}</div>${rows.length > 120 ? `<p class="text-sm muted mt-12">Menampilkan 120 dari ${rows.length}. Gunakan filter pegawai untuk mempersempit.</p>` : ''}`
      : `<div class="card">${emptyState('clipboard2-check', 'Semua kegiatan sudah diverifikasi 🎉', 'Kegiatan baru yang selesai akan muncul di sini.')}</div>`}
    ${st.sel.size ? `<div class="bulk-bar"><b>${st.sel.size} dipilih</b><input class="input" id="vNote" placeholder="Catatan untuk semua (opsional)" maxlength="300"><button class="btn btn-primary" id="vBulk">${ic('check2-all')} Verifikasi Terpilih</button></div>` : ''}`;
  $('#vPeg').onchange = e => { st.pegawai = e.target.value; RENDER.verifikasi(); };
  $('#vFlag').onchange = e => { st.flagged = e.target.checked; RENDER.verifikasi(); };
  $('#vAll') && ($('#vAll').onclick = () => { if (st.sel.size === rows.length) st.sel.clear(); else rows.forEach(r => st.sel.add(r.ID_Kegiatan)); RENDER.verifikasi(); });
  $$('[data-vsel]', el).forEach(c => c.onchange = () => { c.checked ? st.sel.add(c.dataset.vsel) : st.sel.delete(c.dataset.vsel); RENDER.verifikasi(); });
  $$('[data-v1]', el).forEach(b => b.onclick = async () => { await enqueue('verifikasi', { ids: [b.dataset.v1], catatan: '' }, 'Verifikasi 1 kegiatan'); toast('success', 'Diverifikasi'); RENDER.verifikasi(); renderNavState(); });
  $('#vBulk') && ($('#vBulk').onclick = async () => { const ids = [...st.sel]; await enqueue('verifikasi', { ids, catatan: $('#vNote').value.trim() }, `Verifikasi ${ids.length} kegiatan`); st.sel.clear(); toast('success', `${ids.length} kegiatan diverifikasi`); RENDER.verifikasi(); renderNavState(); });
};

// ─── W-17 PETA SEBARAN ──────────────────────────────────────────────────────
RENDER.peta = async function () {
  const st = S.ui.peta, today = todayStr();
  if (!st.from) { st.from = today.slice(0, 8) + '01'; st.to = today; }
  if (!st.jenis) st.jenis = new Set(S.master.jenis.map(j => j.nama));
  const el = $('#pg-peta');
  el.innerHTML = `
    <div class="page-head"><div><h1>Peta Sebaran Kegiatan</h1><p>Titik GPS kegiatan di Kecamatan ${esc(S.cfg.kecamatan || 'Aesesa')}. Cincin oranye = perlu ditinjau.</p></div></div>
    <div class="map-full">
      <div class="map-panel" id="mpPanel">
        <b class="text-sm">Filter Peta</b>
        <div class="stack mt-8">
          <div class="grid-2 keep"><input type="date" class="input" id="mpFrom" value="${st.from}" style="min-height:40px;font-size:13px"><input type="date" class="input" id="mpTo" value="${st.to}" max="${today}" style="min-height:40px;font-size:13px"></div>
          <select class="select" id="mpPeg" style="min-height:40px;font-size:14px">${pegawaiOptions(st.pegawai)}</select>
          <select class="select" id="mpLok" style="min-height:40px;font-size:14px"><option value="">Semua desa/kel.</option>${S.master.lokasi.map(l => `<option ${st.lokasi === l.nama ? 'selected' : ''}>${esc(l.nama)}</option>`).join('')}</select>
          <div class="overline mt-4">Jenis kegiatan</div>
          <div class="legend">${S.master.jenis.map(j => `<label class="check text-sm"><input type="checkbox" data-mj="${esc(j.nama)}" ${st.jenis.has(j.nama) ? 'checked' : ''}><span class="cat-dot" style="--kc:${j.warna}"></span>${esc(j.nama)}</label>`).join('')}</div>
          <label class="row-between text-sm mt-4"><span>Tampilkan peringatan GPS</span><span class="switch"><input type="checkbox" id="mpWarn" ${st.warn ? 'checked' : ''}><span></span></span></label>
        </div>
      </div>
      <div class="map-area" id="mpMap" style="position:absolute;inset:0"></div>
      <div class="map-counter" id="mpCount">Memuat peta…</div>
    </div>`;
  if (!isDesktop() && window.innerWidth <= 640) $('#mpMap').style.position = 'relative';
  const refresh = () => drawPeta();
  $('#mpFrom').onchange = async e => { st.from = e.target.value; await ensureRange(st.from).catch(() => {}); refresh(); };
  $('#mpTo').onchange = e => { st.to = e.target.value; refresh(); };
  $('#mpPeg').onchange = e => { st.pegawai = e.target.value; refresh(); };
  $('#mpLok').onchange = e => { st.lokasi = e.target.value; refresh(); };
  $('#mpWarn').onchange = e => { st.warn = e.target.checked; refresh(); };
  $$('[data-mj]', el).forEach(c => c.onchange = () => { c.checked ? st.jenis.add(c.dataset.mj) : st.jenis.delete(c.dataset.mj); refresh(); });
  try { await loadLib('leaflet'); } catch (e) { $('#mpCount').textContent = 'Peta tidak dapat dimuat (offline)'; return; }
  if (S.route !== 'peta') return;
  if (S.maps.peta) { try { S.maps.peta.remove(); } catch (x) {} }
  const map = L.map('mpMap', { zoomControl: true, attributionControl: true }).setView([S.cfg.mapLat || -8.5412, S.cfg.mapLng || 121.3204], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  S.maps.peta = map; S.maps.petaLayer = L.layerGroup().addTo(map);
  drawPeta(true);
  setTimeout(() => map.invalidateSize(), 120);
};
function drawPeta(fit) {
  const st = S.ui.peta, map = S.maps.peta, layer = S.maps.petaLayer; if (!map || !layer) return;
  layer.clearLayers();
  const rows = liveRows().filter(r => r.Tanggal >= st.from && r.Tanggal <= st.to && st.jenis.has(r.Jenis_Kegiatan) && (!st.pegawai || r.ID_Pegawai === st.pegawai) && (!st.lokasi || r.Lokasi === st.lokasi));
  const pts = [];
  rows.forEach(r => {
    const lat = +(r.Lat_Selesai || r.Lat_Mulai), lng = +(r.Lng_Selesai || r.Lng_Mulai);
    if (!lat || !lng) return;
    const warn = flagsOf(r).some(f => /GPS|Jarak|Jam|beda/i.test(f));
    const col = jenisInfo(r.Jenis_Kegiatan).warna;
    if (st.warn && warn) L.circleMarker([lat, lng], { radius: 13, color: '#F97316', weight: 3, fill: false }).addTo(layer);
    L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: .95 }).addTo(layer)
      .bindPopup(`<b>${esc(jenisLabel(r))}</b> — ${esc(lokasiLabel(r))}<br>${esc(r.Nama)}<br><span style="font-family:var(--mono);font-size:11px">${tglIndo(r.Tanggal, true)} ${hhmm(r.Jam_Mulai)}–${hhmm(r.Jam_Selesai)}</span><br>${esc(r.Tempat_Spesifik)}${warn ? `<br><span style="color:#C2410C">⚠ ${esc(flagsOf(r).join(', '))}</span>` : ''}<br><button class="btn btn-accent btn-sm mt-8" data-go="detail" data-id="${esc(r.ID_Kegiatan)}">Lihat Detail</button>`);
    pts.push([lat, lng]);
  });
  $('#mpCount') && ($('#mpCount').textContent = `Menampilkan ${pts.length} titik`);
  if (fit && pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}

// ─── W-19/20 KELOLA PEGAWAI (Admin) ────────────────────────────────────────
RENDER.pegawai = function () {
  const q = S.ui.pegawaiQ.toLowerCase(), peran = S.ui.pegawaiPeran;
  let list = S.pegawai.slice().sort((a, b) => a.nama.localeCompare(b.nama));
  if (q) list = list.filter(p => (p.nama + ' ' + p.nip + ' ' + p.jabatan + ' ' + p.username).toLowerCase().includes(q));
  if (peran) list = list.filter(p => p.peran === peran || p.status === peran);
  const el = $('#pg-pegawai');
  el.innerHTML = `
    <div class="page-head"><div><h1>Kelola Pegawai</h1><p>${S.pegawai.length} akun · Pegawai cukup memilih namanya, data diisi sekali oleh Admin.</p></div>
      <div class="row wrap"><button class="btn btn-outline" id="pgImp">${ic('clipboard-plus')} Impor Massal</button><button class="btn btn-primary" id="pgAdd">${ic('person-plus')} Tambah Pegawai</button></div></div>
    <div class="card mb-16"><div class="filter-bar"><div class="input-icon">${ic('search')}<input class="input" id="pgQ" placeholder="Cari nama / NIP / jabatan" value="${esc(S.ui.pegawaiQ)}"></div>
      <select class="select" id="pgPeran"><option value="">Semua peran &amp; status</option>${['Pegawai', 'Kapus', 'Admin', 'Aktif', 'Nonaktif'].map(x => `<option ${peran === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>NIP</th><th>Jabatan</th><th>Username</th><th>Peran</th><th>Status</th><th>Login Terakhir</th><th style="text-align:right">Aksi</th></tr></thead><tbody>
    ${list.map(p => `<tr data-edit="${p.id}"><td><div class="row"><div class="avatar sm">${esc(initials(p.nama))}</div><b>${esc(p.nama)}</b></div></td><td class="mono text-xs">${esc(p.nip)}</td><td>${esc(p.jabatan)}<div class="text-xs muted">${esc(p.unit || '')}</div></td>
      <td class="mono text-xs">${esc(p.username)}</td><td><span class="pill pill-role-${p.peran.toLowerCase()}">${esc(p.peran)}</span></td>
      <td><span class="pill ${p.status === 'Aktif' ? 'pill-diverifikasi' : 'pill-tercatat'}">${esc(p.status)}</span></td><td class="mono text-xs muted">${esc(p.loginTerakhir || '–')}</td>
      <td style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" data-edit2="${p.id}">${ic('pencil')}</button><button class="btn btn-ghost btn-sm" data-reset="${p.id}" title="Reset kata sandi">${ic('key')}</button></td></tr>`).join('') || `<tr><td colspan="8">${emptyState('people', 'Tidak ada pegawai')}</td></tr>`}
    </tbody></table></div>`;
  $('#pgQ').oninput = debounce(e => { S.ui.pegawaiQ = e.target.value; RENDER.pegawai(); const i = $('#pgQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
  $('#pgPeran').onchange = e => { S.ui.pegawaiPeran = e.target.value; RENDER.pegawai(); };
  $('#pgAdd').onclick = () => pegawaiDrawer(null);
  $('#pgImp').onclick = imporModal;
  $$('[data-edit],[data-edit2]', el).forEach(t => t.onclick = () => pegawaiDrawer(S.pegawai.find(p => p.id === (t.dataset.edit || t.dataset.edit2))));
  $$('[data-reset]', el).forEach(b => b.onclick = async () => {
    const p = S.pegawai.find(x => x.id === b.dataset.reset);
    if (!await confirmDialog({ title: 'Reset kata sandi?', message: `Kata sandi <b>${esc(p.nama)}</b> akan diganti dengan kata sandi sementara. Pegawai wajib menggantinya saat login.`, okText: 'Reset', icon: 'key' })) return;
    try { const r = await api('resetSandi', S.token, p.id); if (!r.success) return toast('error', 'Gagal', r.message); credModal('Kata sandi baru', [{ nama: p.nama, username: p.username, password: r.data.password }]); }
    catch (e) { toast('error', 'Tidak dapat terhubung', e.message); }
  });
};

function pegawaiDrawer(p) {
  const e = p || { peran: 'Pegawai', status: 'Aktif' };
  openDrawer({
    title: p ? 'Ubah Data Pegawai' : 'Tambah Pegawai',
    body: `<div class="stack-16">
      <div class="field"><label>Nama Lengkap &amp; Gelar <span class="req">*</span></label><input class="input" id="pNama" value="${esc(e.nama || '')}" maxlength="120"></div>
      <div class="field"><label>NIP <span class="req">*</span></label><input class="input mono" id="pNip" value="${esc(e.nip || '')}" inputmode="numeric" maxlength="30"></div>
      <div class="field"><label>Jabatan <span class="req">*</span></label><input class="input" id="pJab" value="${esc(e.jabatan || '')}" maxlength="120" placeholder="Mis. Bidan Mahir"></div>
      <div class="field"><label>Unit Kerja / Program</label><input class="input" id="pUnit" value="${esc(e.unit || '')}" maxlength="120" placeholder="Mis. KIA, Kesling, P2P"></div>
      <div class="field"><label>Username (NIP / Gmail)</label><input class="input mono" id="pUser" value="${esc(e.username || '')}" placeholder="Kosongkan = NIP"></div>
      <div class="grid-2"><div class="field"><label>Email</label><input class="input" id="pEmail" type="email" value="${esc(e.email || '')}"></div>
        <div class="field"><label>No. WhatsApp</label><input class="input mono" id="pHp" type="tel" inputmode="tel" value="${esc(e.noHp || '')}" placeholder="08xxxxxxxxxx"></div></div>
      <div class="field"><label>Peran <span class="req">*</span></label><div class="grid-3" id="pPeran">${['Pegawai', 'Kapus', 'Admin'].map(r => `<button type="button" class="choice ${e.peran === r ? 'active' : ''}" data-peran="${r}" style="flex-direction:column;justify-content:center;gap:4px;min-height:72px">${ic(r === 'Admin' ? 'shield-lock' : r === 'Kapus' ? 'person-badge' : 'person-walking', 'ci')}<span>${r}</span></button>`).join('')}</div></div>
      ${p ? `<label class="row-between card" style="box-shadow:none"><span class="fw-6">Status Aktif</span><span class="switch"><input type="checkbox" id="pStatus" ${e.status === 'Aktif' ? 'checked' : ''}><span></span></span></label>` : `<div class="notice">${ic('key')}<span>Kata sandi sementara dibuat otomatis dan ditampilkan setelah disimpan. Pegawai wajib menggantinya saat login pertama.</span></div>`}
    </div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="pSave">${ic('check2')} Simpan</button>`,
    onOpen: m => {
      let peran = e.peran;
      m.$('#pPeran').onclick = ev => { const b = ev.target.closest('[data-peran]'); if (!b) return; peran = b.dataset.peran; $$('[data-peran]', m.el).forEach(x => x.classList.toggle('active', x === b)); };
      m.$('#pSave').onclick = async ev => {
        const data = { id: p ? p.id : '', nama: m.$('#pNama').value.trim(), nip: m.$('#pNip').value.trim(), jabatan: m.$('#pJab').value.trim(), unit: m.$('#pUnit').value.trim(), username: m.$('#pUser').value.trim(), email: m.$('#pEmail').value.trim(), noHp: m.$('#pHp').value.trim(), peran, status: p ? (m.$('#pStatus').checked ? 'Aktif' : 'Nonaktif') : 'Aktif' };
        if (!data.nama || !data.nip || !data.jabatan) { toast('warning', 'Lengkapi nama, NIP, dan jabatan'); return; }
        btnLoading(ev.currentTarget, true, 'Menyimpan…');
        try {
          const r = await api('simpanPegawai', S.token, data);
          if (!r.success) { toast('error', 'Gagal menyimpan', r.message); return; }
          const i = S.pegawai.findIndex(x => x.id === r.data.pegawai.id);
          if (i >= 0) S.pegawai[i] = r.data.pegawai; else S.pegawai.push(r.data.pegawai);
          saveSnapshot(); m.close(); toast('success', r.message); RENDER.pegawai();
          if (r.data.password) credModal('Akun berhasil dibuat', [{ nama: data.nama, username: r.data.pegawai.username, password: r.data.password }]);
        } catch (x) { toast('error', 'Tidak dapat terhubung', x.message); }
        finally { btnLoading(ev.currentTarget, false); }
      };
    }
  });
}

function credModal(title, list) {
  const text = list.map(c => `${c.nama}\nUsername: ${c.username}\nKata sandi: ${c.password}`).join('\n\n');
  openModal({
    title, size: list.length > 3 ? 'lg' : '',
    body: `<div class="notice warn mb-12">${ic('exclamation-triangle')}<span>Catat atau salin sekarang. Kata sandi tidak dapat ditampilkan lagi.</span></div>
      <div class="stack">${list.map(c => `<div class="cred-box"><div><b style="font-family:var(--font)">${esc(c.nama)}</b><div class="text-sm">Username: ${esc(c.username)}</div><div class="text-sm">Sandi: <b>${esc(c.password)}</b></div></div></div>`).join('')}</div>`,
    foot: `<button class="btn btn-outline" id="cpy">${ic('clipboard')} Salin Semua</button><button class="btn btn-primary" data-close>Selesai</button>`,
    onOpen: m => m.$('#cpy').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('success', 'Tersalin ke papan klip'); } catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('success', 'Tersalin'); } }
  });
}

function imporModal() {
  openModal({
    title: 'Impor Pegawai Massal', size: 'lg',
    body: `<div class="stack">
      <p class="text-sm">Salin kolom dari Excel/Google Sheets lalu tempel di bawah. Urutan kolom: <b class="mono">Nama | NIP | Jabatan | Unit (opsional) | Email (opsional) | Peran (opsional) | No. WhatsApp (opsional)</b>. Baris judul akan dilewati otomatis.</p>
      <textarea class="textarea mono" id="impTxt" style="min-height:200px;font-size:13px" placeholder="Siti Aisyah, S.Tr.Keb&#9;199208142019032008&#9;Bidan Mahir&#9;KIA"></textarea>
      <div id="impPrev" class="help">${ic('info-circle')} Belum ada data.</div></div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="impGo" disabled>${ic('upload')} Impor</button>`,
    onOpen: m => {
      let rows = [];
      m.$('#impTxt').oninput = debounce(() => {
        const lines = m.$('#impTxt').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        rows = lines.map(l => l.split(/\t|;|\|/).map(x => x.trim())).filter(c => c.length >= 3 && !/^nama$/i.test(c[0]))
          .map(c => ({ nama: c[0], nip: c[1].replace(/\s/g, ''), jabatan: c[2], unit: c[3] || '', email: c[4] || '', peran: ['Admin', 'Kapus', 'Pegawai'].includes(c[5]) ? c[5] : 'Pegawai', noHp: c[6] || '' }));
        m.$('#impPrev').innerHTML = rows.length ? `${ic('check-circle')} ${rows.length} baris siap diimpor. Contoh: <b>${esc(rows[0].nama)}</b> — ${esc(rows[0].nip)} — ${esc(rows[0].jabatan)}` : `${ic('info-circle')} Format belum dikenali (minimal 3 kolom: Nama, NIP, Jabatan).`;
        m.$('#impGo').disabled = !rows.length;
      }, 250);
      m.$('#impGo').onclick = async ev => {
        btnLoading(ev.currentTarget, true, 'Mengimpor…');
        try {
          const r = await api('imporPegawai', S.token, rows);
          if (!r.success) { toast('error', 'Impor gagal', r.message); return; }
          S.pegawai = r.data.pegawai; saveSnapshot(); m.close(); RENDER.pegawai();
          toast('success', r.message);
          if (r.data.hasil.length) credModal(`${r.data.hasil.length} akun dibuat`, r.data.hasil);
          if (r.data.dilewati.length) toast('warning', `${r.data.dilewati.length} baris dilewati`, r.data.dilewati.slice(0, 3).join('; '));
        } catch (x) { toast('error', 'Tidak dapat terhubung', x.message); }
        finally { btnLoading(ev.currentTarget, false); }
      };
    }
  });
}

// ─── W-21 DATA MASTER (Admin) ───────────────────────────────────────────────
RENDER.master = function () {
  const tab = S.ui.masterTab, el = $('#pg-master');
  const list = tab === 'lokasi' ? S.master.lokasi : S.master.jenis;
  el.innerHTML = `
    <div class="page-head"><div><h1>Data Master</h1><p>Pilihan yang muncul pada formulir pegawai. "Lainnya" selalu tersedia dan terkunci.</p></div></div>
    <div class="tabs mb-16"><button class="tab ${tab === 'lokasi' ? 'active' : ''}" data-mt="lokasi">Desa / Kelurahan<span class="count">${S.master.lokasi.length}</span></button><button class="tab ${tab === 'jenis' ? 'active' : ''}" data-mt="jenis">Jenis Kegiatan<span class="count">${S.master.jenis.length}</span></button></div>
    <div class="card mb-16"><div class="filter-bar"><input class="input" id="msNew" placeholder="${tab === 'lokasi' ? 'Nama desa/kelurahan baru' : 'Nama jenis kegiatan baru'}" maxlength="80">
      ${tab === 'lokasi' ? `<select class="select" id="msTipe" style="flex:0 1 160px"><option>Desa</option><option>Kelurahan</option></select>` : `<input type="color" id="msWarna" value="#64748B" class="input" style="flex:0 0 64px;padding:4px" aria-label="Warna">`}
      <button class="btn btn-primary" id="msAdd">${ic('plus-lg')} Tambah</button></div></div>
    <div class="table-wrap"><table class="tbl" style="min-width:560px"><thead><tr><th>Nama</th><th>${tab === 'lokasi' ? 'Tipe' : 'Warna &amp; Ikon'}</th><th>Aktif</th><th style="text-align:right">Aksi</th></tr></thead><tbody>
    ${list.map(x => `<tr style="cursor:default"><td class="fw-6">${x.terkunci ? ic('lock', 'muted') + ' ' : ''}${esc(x.nama)}${x.terkunci ? '<div class="text-xs muted">Tidak dapat dihapus</div>' : ''}</td>
      <td>${tab === 'lokasi' ? `<span class="pill ${x.tipe === 'Kelurahan' ? 'pill-accent' : x.tipe === 'Desa' ? 'pill-green' : 'pill-tercatat'}">${esc(x.tipe)}</span>` : `<span class="row"><span class="cat-dot" style="--kc:${x.warna};width:14px;height:14px"></span>${ic(x.ikon)} <span class="mono text-xs muted">${esc(x.ikon)}</span></span>`}</td>
      <td><label class="switch"><input type="checkbox" data-tog="${x.id}" ${x.aktif ? 'checked' : ''} ${x.terkunci ? 'disabled' : ''}><span></span></label></td>
      <td style="text-align:right">${x.terkunci ? '' : `<button class="btn btn-ghost btn-sm" data-ren="${x.id}">${ic('pencil')} Ubah</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
  $$('[data-mt]', el).forEach(b => b.onclick = () => { S.ui.masterTab = b.dataset.mt; RENDER.master(); });
  const save = async (item, optimistic) => {
    const prev = JSON.parse(JSON.stringify(S.master));
    if (optimistic) { optimistic(); RENDER.master(); }
    try {
      const r = await api('simpanMaster', S.token, tab, item);
      if (!r.success) { S.master = prev; RENDER.master(); toast('error', 'Gagal menyimpan', r.message); return; }
      S.master = r.data; saveSnapshot(); RENDER.master(); toast('success', 'Data master tersimpan');
    } catch (e) { S.master = prev; RENDER.master(); toast('error', 'Tidak dapat terhubung', e.message); }
  };
  $('#msAdd').onclick = () => {
    const nama = $('#msNew').value.trim(); if (!nama) { toast('warning', 'Isi nama terlebih dahulu'); return; }
    save(tab === 'lokasi' ? { nama, tipe: $('#msTipe').value } : { nama, warna: $('#msWarna').value, ikon: 'activity' });
  };
  $$('[data-tog]', el).forEach(c => c.onchange = () => {
    const x = list.find(i => i.id === c.dataset.tog);
    save({ id: x.id, nama: x.nama, tipe: x.tipe, warna: x.warna, ikon: x.ikon, aktif: c.checked, urutan: x.urutan }, () => { x.aktif = c.checked; });
  });
  $$('[data-ren]', el).forEach(b => b.onclick = () => {
    const x = list.find(i => i.id === b.dataset.ren);
    openModal({ title: 'Ubah ' + (tab === 'lokasi' ? 'Desa/Kelurahan' : 'Jenis Kegiatan'),
      body: `<div class="stack-16"><div class="field"><label>Nama</label><input class="input" id="rnNama" value="${esc(x.nama)}"></div>
        ${tab === 'lokasi' ? `<div class="field"><label>Tipe</label><select class="select" id="rnTipe"><option ${x.tipe === 'Desa' ? 'selected' : ''}>Desa</option><option ${x.tipe === 'Kelurahan' ? 'selected' : ''}>Kelurahan</option></select></div>`
          : `<div class="grid-2"><div class="field"><label>Warna</label><input type="color" class="input" id="rnWarna" value="${esc(x.warna)}" style="padding:4px"></div><div class="field"><label>Ikon (Bootstrap Icons)</label><input class="input mono" id="rnIkon" value="${esc(x.ikon)}"></div></div><p class="help">${ic('info-circle')} Nama ikon dari icons.getbootstrap.com, mis. heart-pulse.</p>`}</div>`,
      foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="rnOk">Simpan</button>`,
      onOpen: m => m.$('#rnOk').onclick = () => { m.close(); save({ id: x.id, nama: m.$('#rnNama').value.trim(), tipe: m.$('#rnTipe') ? m.$('#rnTipe').value : '', warna: m.$('#rnWarna') ? m.$('#rnWarna').value : '', ikon: m.$('#rnIkon') ? m.$('#rnIkon').value.trim() : '', aktif: x.aktif, urutan: x.urutan }); }
    });
  });
};

// ─── W-22 PENGATURAN INSTANSI (Admin) ───────────────────────────────────────
RENDER.pengaturan = function () {
  const c = S.cfg, el = $('#pg-pengaturan');
  const f = (id, label, val, extra) => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${esc(val || '')}" ${extra || ''}></div>`;
  const logo = (which, src) => `<div class="card-tint row gap-12"><div class="thumb" style="width:72px;height:72px;background:var(--surface)">${src ? `<img src="${src}" alt="" style="object-fit:contain">` : ic('image')}</div><div class="grow"><b class="text-sm">Logo ${which === 'pemda' ? 'Pemda' : 'Puskesmas'}</b><p class="text-xs muted">PNG/JPG, maks. 800 KB</p><button class="btn btn-outline btn-sm mt-8" data-logo="${which}">${ic('upload')} Ganti</button></div></div>`;
  el.innerHTML = `
    <div class="page-head"><div><h1>Pengaturan Instansi</h1><p>Identitas kop surat laporan, penandatangan, dan notifikasi email.</p></div></div>
    <div class="dash-grid two">
      <div class="stack-16">
        <div class="card stack-16"><h3 class="section-title">Kop Surat</h3>
          ${f('cPemda', 'Nama Pemerintah Daerah', c.namaPemda)}${f('cDinas', 'Nama Dinas', c.namaDinas)}${f('cInst', 'Nama Instansi', c.namaInstansi)}${f('cAlamat', 'Alamat', c.alamat)}
          <div class="grid-2">${f('cTelp', 'Telepon', c.telepon)}${f('cEmailI', 'Email Instansi', c.emailInstansi)}</div>
          <div class="grid-2">${logo('pemda', c.logoPemda)}${logo('puskesmas', c.logoPuskesmas)}</div></div>
        <div class="card stack-16"><h3 class="section-title">Penandatangan Laporan</h3>
          ${f('cKapus', 'Nama Kepala Puskesmas', c.namaKapus)}${f('cNipK', 'NIP Kepala Puskesmas', c.nipKapus, 'class="input mono"')}${f('cKota', 'Kota Penandatanganan', c.kotaTtd)}</div>
      </div>
      <div class="stack-16">
        <div class="card stack-16"><h3 class="section-title">Notifikasi Email</h3>
          <label class="row-between"><span class="fw-6">Kirim email setiap kegiatan selesai</span><span class="switch"><input type="checkbox" id="cMail" ${c.kirimEmail !== 'Tidak' ? 'checked' : ''}><span></span></span></label>
          ${f('cEmailA', 'Email Admin', c.emailAdmin, 'type="email"')}${f('cEmailK', 'Email Kapus', c.emailKapus, 'type="email"')}
          <div class="cap-bar"><div class="row-between text-sm"><span>Sisa kuota email hari ini</span><b class="mono">${c.kuotaEmail == null ? '-' : c.kuotaEmail}</b></div><div class="progress"><i style="width:${c.kuotaEmail == null ? 0 : Math.min(100, c.kuotaEmail / 15)}%;background:var(--accent)"></i></div>
            <p class="help mt-8">${ic('info-circle')} Akun Gmail biasa ±100 penerima/hari, Google Workspace ±1.500. Email dikirim lewat antrean (tidak memperlambat aplikasi). WhatsApp diatur di menu <a href="#" data-go="notifikasi">WA &amp; Notifikasi</a>.</p></div></div>
        <div class="card stack-16"><h3 class="section-title">Wilayah, Peta &amp; Halaman Depan</h3>
          <div class="grid-2">${f('cKec', 'Kecamatan', c.kecamatan)}${f('cKab', 'Kabupaten', c.kabupaten)}</div>
          <div class="grid-2">${f('cLat', 'Titik tengah peta (lat)', c.mapLat, 'class="input mono"')}${f('cLng', 'Titik tengah peta (lng)', c.mapLng, 'class="input mono"')}</div>
          <div class="field"><label for="cProfil">Profil singkat (halaman depan)</label><textarea class="textarea" id="cProfil" rows="3" maxlength="300">${esc(c.profilSingkat || '')}</textarea></div>
          ${f('cJam', 'Jam layanan (halaman depan)', c.jamLayanan)}
          <div class="row wrap gap-4"><span class="pill pill-tercatat">Maks. 3 berkas</span><span class="pill pill-tercatat">Total 5 MB</span><span class="pill pill-tercatat">WITA (Asia/Makassar)</span><span class="pill pill-tercatat">Tutup otomatis 23:55</span></div></div>
      </div>
    </div>
    <div class="row mt-16" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" id="cSave">${ic('check2')} Simpan Pengaturan</button></div>`;
  $('#cSave').onclick = async ev => {
    const v = id => $(id).value.trim();
    const data = { namaPemda: v('#cPemda'), namaDinas: v('#cDinas'), namaInstansi: v('#cInst'), alamat: v('#cAlamat'), telepon: v('#cTelp'), emailInstansi: v('#cEmailI'),
      namaKapus: v('#cKapus'), nipKapus: v('#cNipK'), kotaTtd: v('#cKota'), kirimEmail: $('#cMail').checked ? 'Ya' : 'Tidak', emailAdmin: v('#cEmailA'), emailKapus: v('#cEmailK'),
      kecamatan: v('#cKec'), kabupaten: v('#cKab'), mapLat: v('#cLat'), mapLng: v('#cLng'), profilSingkat: v('#cProfil'), jamLayanan: v('#cJam') };
    btnLoading(ev.currentTarget, true, 'Menyimpan…');
    try { const r = await api('simpanPengaturan', S.token, data); if (!r.success) return toast('error', 'Gagal', r.message); S.cfg = r.data; saveSnapshot(); buildChrome(); toast('success', r.message); RENDER.pengaturan(); }
    catch (x) { toast('error', 'Tidak dapat terhubung', x.message); }
    finally { btnLoading(ev.currentTarget, false); }
  };
  $$('[data-logo]', el).forEach(b => b.onclick = () => {
    const inp = $('#inLogo'); inp.value = '';
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      if (file.size > 800 * 1024) { toast('error', 'Logo terlalu besar', 'Maksimal 800 KB.'); return; }
      const url = await readAsDataURL(file);
      btnLoading(b, true, 'Mengunggah…');
      try { const r = await api('unggahLogo', S.token, b.dataset.logo, url.split(',')[1], file.type); if (!r.success) return toast('error', 'Gagal', r.message); S.cfg = r.data; saveSnapshot(); buildChrome(); toast('success', 'Logo diperbarui'); RENDER.pengaturan(); }
      catch (x) { toast('error', 'Tidak dapat terhubung', x.message); }
      finally { btnLoading(b, false); }
    };
    inp.click();
  });
};

// ─── W-23 LOG AKTIVITAS (Admin) ─────────────────────────────────────────────
RENDER.log = async function () {
  const el = $('#pg-log');
  const draw = () => {
    const q = S.ui.logQ.toLowerCase(), a = S.ui.logAksi;
    let rows = S.logs || [];
    if (q) rows = rows.filter(r => (r.nama + ' ' + r.detail + ' ' + r.ref).toLowerCase().includes(q));
    if (a) rows = rows.filter(r => r.aksi === a);
    const cls = { Login: 'pill-tercatat', Tambah: 'pill-green', Ubah: 'pill-accent', Hapus: 'pill-tidak', Verifikasi: 'pill-diverifikasi', Cetak: 'pill-selesai', Sistem: 'pill-flag' };
    $('#logBody').innerHTML = S.logs ? (rows.slice(0, 300).map(r => `<tr style="cursor:default"><td class="mono text-xs">${esc(r.waktu)}</td><td class="fw-6">${esc(r.nama)}</td><td><span class="pill pill-role-${String(r.peran).toLowerCase()}" style="${['Admin', 'Kapus', 'Pegawai'].includes(r.peran) ? '' : 'background:var(--surface-3);color:var(--muted)'}">${esc(r.peran)}</span></td><td><span class="pill ${cls[r.aksi] || 'pill-tercatat'}">${esc(r.aksi)}</span></td><td class="text-sm">${esc(r.detail)}</td><td class="mono text-xs muted">${esc(r.ref)}</td></tr>`).join('') || `<tr><td colspan="6">${emptyState('journal', 'Tidak ada log')}</td></tr>`)
      : Array.from({ length: 6 }, () => `<tr><td colspan="6"><div class="skel" style="height:22px"></div></td></tr>`).join('');
  };
  el.innerHTML = `
    <div class="page-head"><div><h1>Log Aktivitas</h1><p>500 aktivitas terakhir (login, tambah, ubah, hapus, verifikasi, cetak).</p></div><button class="btn btn-outline" id="logRef">${ic('arrow-clockwise')} Muat Ulang</button></div>
    <div class="card mb-16"><div class="filter-bar"><div class="input-icon">${ic('search')}<input class="input" id="logQ" placeholder="Cari nama, detail, ID" value="${esc(S.ui.logQ)}"></div>
      <select class="select" id="logA"><option value="">Semua aksi</option>${['Login', 'Tambah', 'Ubah', 'Hapus', 'Verifikasi', 'Cetak', 'Sistem'].map(x => `<option ${S.ui.logAksi === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Peran</th><th>Aksi</th><th>Detail</th><th>ID</th></tr></thead><tbody id="logBody"></tbody></table></div>`;
  draw();
  $('#logQ').oninput = debounce(e => { S.ui.logQ = e.target.value; draw(); }, 200);
  $('#logA').onchange = e => { S.ui.logAksi = e.target.value; draw(); };
  const load = async () => { try { const r = await api('getLog', S.token, 500); if (r.success) { S.logs = r.data; if (S.route === 'log') draw(); } else toast('error', 'Gagal memuat log', r.message); } catch (e) { toast('warning', 'Tidak dapat terhubung', e.message); } };
  $('#logRef').onclick = () => { S.logs = null; draw(); load(); };
  if (!S.logs) load();
};

// ─── MULAI ──────────────────────────────────────────────────────────────────
// boot() dipanggil di akhir landing.js (setelah admin.js & landing.js termuat)
