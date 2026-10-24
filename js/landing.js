'use strict';
/* ============================================================================
   SIMONIK-LG v2 — landing.js : halaman publik (tanpa login) + router hash
   #/          → landing: profil puskesmas + statistik publik (TANPA nama pegawai)
   #/masuk     → login pegawai/Kapus/Admin
   #/cek/KODE  → verifikasi keaslian dokumen dari QR
   #/darurat   → akses darurat Admin (tidak ditautkan di mana pun)
   #/app       → aplikasi (butuh sesi)
   Kecepatan: statistik publik di-cache di localStorage → tampil 0 ms, lalu disegarkan
   (stale-while-revalidate); grafik memakai CSS murni (tanpa pustaka).
   ============================================================================ */
const PUB = (function () {
  const LS_PUB = 'simonik_pub_v2';
  const fmtN = n => Number(n || 0).toLocaleString('id-ID');
  const screens = ['#screen-landing', '#screen-cek', '#screen-darurat'];

  function hideAll() { screens.forEach(s => { const e = $(s); if (e) e.hidden = true; }); document.body.classList.remove('pub'); }
  function show(sel) {
    $('#boot').classList.add('out');
    $('#app').hidden = true; $('#screen-login').hidden = true;
    screens.forEach(s => { $(s).hidden = s !== sel; });
    document.body.classList.add('pub');
    window.scrollTo(0, 0);
  }

  // ── LANDING ──
  function cacheGet() { try { return JSON.parse(localStorage.getItem(LS_PUB) || 'null'); } catch (e) { return null; } }
  function cacheSet(d) { try { localStorage.setItem(LS_PUB, JSON.stringify(d)); } catch (e) { /* abaikan */ } }

  function showLanding() {
    show('#screen-landing');
    if (location.hash && location.hash !== '#/' && !/^#\/?$/.test(location.hash)) history.replaceState(null, '', '#/');
    const c = cacheGet();
    renderLanding(c);
    if (!API.configured) { $('#lpStatus').innerHTML = `<div class="notice warn">${ic('plug')}<span>Aplikasi belum dihubungkan ke server. Admin: isi <span class="mono">GAS_URL</span> di <span class="mono">js/config.js</span>.</span></div>`; return; }
    API.warmup('pub');
    API.get({ action: 'publik' }).then(r => { if (r && r.success) { cacheSet(r.data); if (!$('#screen-landing').hidden) renderLanding(r.data); } }).catch(() => {});
  }

  function bar(label, n, max, color) {
    return `<div class="lp-bar"><span class="lp-bar-l ellipsis">${esc(label)}</span><span class="lp-bar-t"><i style="width:${max ? Math.max(3, n / max * 100) : 0}%;${color ? 'background:' + color : ''}"></i></span><b class="mono">${fmtN(n)}</b></div>`;
  }

  function renderLanding(d) {
    const ins = (d && d.instansi) || {};
    const nama = titleCase(ins.namaInstansi || 'UPTD Puskesmas Kota');
    const sk = !d;
    const perBulan = d ? d.perBulan : Array(12).fill(0), maxB = Math.max(1, ...perBulan);
    const jenis = d ? Object.entries(d.perJenis).sort((a, b) => b[1] - a[1]) : [], maxJ = jenis.length ? jenis[0][1] : 1;
    const warna = {}; (d ? d.jenis : []).forEach(j => warna[j.nama] = j.warna);
    const desa = d ? Object.entries(d.perDesa).sort((a, b) => b[1] - a[1]) : [], maxD = desa.length ? desa[0][1] : 1;
    const bulanIni = +todayStr().slice(5, 7) - 1;
    const logo = (src, icon) => src ? `<img src="${src}" alt="">` : ic(icon);
    $('#screen-landing').innerHTML = `
      <header class="lp-nav"><div class="lp-wrap row-between">
        <div class="row gap-12"><div class="logo-tile">${logo(ins.logoPuskesmas, 'geo-alt-fill')}</div><div><div class="fw-7">SIMONIK-LG</div><div class="text-xs muted">${esc(nama)}</div></div></div>
        <div class="row gap-8"><button class="icon-btn" data-action="theme" aria-label="Ganti tema">${ic('moon')}</button><a class="btn btn-primary" href="#/masuk">${ic('box-arrow-in-right')} Masuk</a></div>
      </div></header>
      <section class="lp-hero"><div class="lp-wrap">
        <div class="lp-hero-grid">
          <div class="stack-16">
            <span class="pill pill-green">${ic('broadcast')} Monitoring kegiatan luar gedung · Kec. ${esc(ins.kecamatan || 'Aesesa')}</span>
            <h1 class="lp-h1">Pelayanan kesehatan yang <span>hadir di tengah masyarakat</span>, tercatat transparan.</h1>
            <p class="lp-lead">${esc(ins.profilSingkat || 'UPTD Puskesmas Kota mencatat setiap kegiatan Posyandu, kunjungan rumah, penyuluhan, imunisasi, dan skrining secara digital — lengkap dengan waktu, lokasi GPS, dan bukti foto.')}</p>
            <div class="row gap-8 wrap"><a class="btn btn-primary btn-lg" href="#/masuk">${ic('person-badge')} Masuk Pegawai</a><a class="btn btn-outline btn-lg" href="#/cek">${ic('qr-code-scan')} Cek Keaslian Dokumen</a></div>
            <div id="lpStatus"></div>
          </div>
          <div class="lp-hero-card card">
            <div class="row-between mb-8"><b>Kegiatan ${esc(d ? d.tahun : '')}</b><span class="text-xs muted">${d ? 'diperbarui ' + esc(String(d.diperbarui).slice(11, 16)) + ' WITA' : ''}</span></div>
            <div class="lp-months">${perBulan.map((n, i) => `<div class="lp-m ${i === bulanIni ? 'now' : ''}" title="${BULAN[i]}: ${n}"><i style="height:${sk ? 8 + (i * 7) % 50 : Math.max(2, n / maxB * 100)}%"></i><span>${BLN[i].slice(0, 1)}</span></div>`).join('')}</div>
            <div class="grid-2 mt-16">
              <div class="lp-mini"><div class="mono lp-num">${sk ? '—' : fmtN(d.total)}</div><div class="text-xs muted">kegiatan tahun ini</div></div>
              <div class="lp-mini"><div class="mono lp-num">${sk ? '—' : (d.total ? Math.round(d.diverifikasi / d.total * 100) : 0) + '%'}</div><div class="text-xs muted">sudah diverifikasi Kapus</div></div>
            </div>
          </div>
        </div>
      </div></section>
      <section class="lp-wrap lp-kpis">
        ${[['clipboard2-pulse', 'Total kegiatan', d && d.total], ['check2-circle', 'Selesai dilaksanakan', d && d.selesai], ['patch-check', 'Diverifikasi', d && d.diverifikasi], ['geo', 'Desa/kelurahan terjangkau', d && d.wilayah], ['people', 'Petugas lapangan aktif', d && d.pegawaiAktif]]
          .map(k => `<div class="lp-kpi">${ic(k[0])}<div class="mono lp-num">${sk ? '<span class="skel" style="display:inline-block;width:60px;height:26px"></span>' : fmtN(k[2])}</div><div class="text-sm muted">${k[1]}</div></div>`).join('')}
      </section>
      <section class="lp-wrap lp-two">
        <div class="card"><h3 class="section-title mb-12">${ic('bar-chart')} Jenis kegiatan</h3>${sk ? skelRows(5, 22) : jenis.slice(0, 9).map(([k, n]) => bar(k, n, maxJ, warna[k])).join('') || '<p class="text-sm muted">Belum ada data.</p>'}</div>
        <div class="card"><h3 class="section-title mb-12">${ic('pin-map')} Sebaran wilayah</h3>${sk ? skelRows(5, 22) : desa.slice(0, 10).map(([k, n]) => bar(k, n, maxD)).join('') || '<p class="text-sm muted">Belum ada data.</p>'}</div>
      </section>
      <section class="lp-wrap lp-feat">
        ${[['geo-alt', 'Lokasi GPS otomatis', 'Titik mulai & selesai kegiatan tercatat otomatis dari HP petugas.'], ['camera', 'Bukti foto bertanda waktu', 'Foto dokumentasi diberi cap waktu, tanggal, dan koordinat.'], ['wifi-off', 'Tetap jalan tanpa sinyal', 'Data tersimpan di HP dan terkirim otomatis saat sinyal kembali.'], ['qr-code', 'Laporan ber-QR', 'Setiap laporan PDF bernomor dan dapat dicek keasliannya oleh siapa pun.']]
          .map(f => `<div class="lp-f"><span class="kpi ic ic-green" style="width:44px;height:44px;padding:0;border:0;box-shadow:none">${ic(f[0])}</span><b>${f[1]}</b><p class="text-sm muted">${f[2]}</p></div>`).join('')}
      </section>
      <section class="lp-wrap"><div class="card lp-contact">
        <div><h3 class="section-title">${esc(nama)}</h3><p class="text-sm muted">${esc(ins.alamat || '')}${ins.kabupaten ? ' · Kab. ' + esc(ins.kabupaten) : ''}</p></div>
        <div class="stack text-sm">${ins.jamLayanan ? `<div>${ic('clock')} ${esc(ins.jamLayanan)}</div>` : ''}${ins.telepon && ins.telepon !== '-' ? `<div>${ic('telephone')} ${esc(ins.telepon)}</div>` : ''}${ins.email && ins.email !== '-' ? `<div>${ic('envelope')} ${esc(ins.email)}</div>` : ''}</div>
      </div></section>
      <footer class="lp-foot lp-wrap"><span>© ${todayStr().slice(0, 4)} ${esc(nama)} · ${esc(ins.namaPemda ? titleCase(ins.namaPemda) : '')}</span><span>Statistik publik tanpa data pribadi pegawai · SIMONIK-LG v2</span></footer>`;
    syncThemeIcons();
  }

  // ── VERIFIKASI DOKUMEN ──
  function showCek(kode) {
    show('#screen-cek');
    kode = String(kode || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const el = $('#screen-cek');
    el.innerHTML = `<div class="lp-center"><div class="card lp-cek stack-16">
      <div class="row gap-12"><span class="kpi ic ic-green" style="width:48px;height:48px;padding:0;border:0;box-shadow:none;flex:none">${ic('qr-code-scan')}</span><div><h2 style="font-size:20px">Cek Keaslian Dokumen</h2><p class="text-sm muted">Laporan kegiatan SIMONIK-LG</p></div></div>
      <form id="ckF" class="row gap-8"><input class="input mono grow" id="ckK" value="${esc(kode)}" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" style="text-transform:uppercase"><button class="btn btn-primary">${ic('search')} Cek</button></form>
      <div id="ckOut">${kode ? skelRows(3, 30) : `<p class="text-sm muted">Pindai QR pada laporan dengan kamera HP, atau ketik kode verifikasi yang tercetak di bawah QR.</p>`}</div>
      <a class="btn btn-ghost" href="${S.token ? '#/app' : '#/'}">${ic('arrow-left')} ${S.token ? 'Kembali ke aplikasi' : 'Ke halaman utama'}</a>
    </div></div>`;
    $('#ckF').onsubmit = e => { e.preventDefault(); const k = $('#ckK').value.trim().toUpperCase(); if (k) location.hash = '#/cek/' + k; };
    if (!kode) return;
    if (!API.configured) { $('#ckOut').innerHTML = `<div class="notice warn">${ic('plug')}<span>Server belum dikonfigurasi.</span></div>`; return; }
    API.get({ action: 'verifikasi', k: kode }).then(r => {
      const o = $('#ckOut'); if (!o) return;
      if (!r.success) { o.innerHTML = `<div class="lp-verdict bad">${ic('x-octagon-fill')}<div><b>Tidak ditemukan</b><p class="text-sm">${esc(r.message)}</p></div></div>`; return; }
      const d = r.data, sah = d.status === 'TERBIT';
      o.innerHTML = `<div class="lp-verdict ${sah ? 'ok' : 'bad'}">${ic(sah ? 'patch-check-fill' : 'x-octagon-fill')}<div><b>${sah ? 'DOKUMEN SAH' : 'DOKUMEN DITARIK'}</b><p class="text-sm">${sah ? 'Dokumen ini benar diterbitkan oleh SIMONIK-LG dan belum ditarik.' : 'Dokumen ini telah ditarik dan tidak berlaku lagi.'}</p></div></div>
        <div class="kv">${[['Nomor', d.nomor], ['Jenis', d.judul], ['Periode', d.periode], ['Pegawai', d.pegawai], ['Jumlah kegiatan', d.jumlah], ['Instansi', titleCase(d.instansi || '')], ['Penandatangan', d.penandatangan], ['Diterbitkan', d.terbit + ' WITA']].concat(sah ? [] : [['Alasan ditarik', d.alasanTarik]])
          .map(([k, v]) => `<div class="row-between gap-12" style="padding:8px 0;border-bottom:1px solid var(--border)"><span class="text-sm muted">${k}</span><b class="text-sm" style="text-align:right">${esc(v == null ? '-' : v)}</b></div>`).join('')}</div>
        <details class="text-xs"><summary style="cursor:pointer">Sidik jari berkas (SHA-256)</summary><p class="mono mt-4" style="word-break:break-all">${esc(d.hashPdf)}</p></details>`;
    }).catch(() => { const o = $('#ckOut'); if (o) o.innerHTML = `<div class="notice warn">${ic('wifi-off')}<span>Tidak dapat terhubung ke server. Coba lagi.</span></div>`; });
  }

  // ── AKSES DARURAT ──
  function showDarurat() {
    show('#screen-darurat');
    $('#screen-darurat').innerHTML = `<div class="lp-center"><form class="card lp-cek stack-16" id="drF" autocomplete="off">
      <div class="row gap-12"><span class="kpi ic ic-red" style="width:48px;height:48px;padding:0;border:0;box-shadow:none;flex:none">${ic('shield-exclamation')}</span><div><h2 style="font-size:20px">Akses Darurat</h2><p class="text-sm muted">Hanya untuk pemulihan bila semua akun Admin tidak bisa masuk.</p></div></div>
      <input class="input" id="drU" placeholder="Username darurat"><input class="input" id="drP" type="password" placeholder="Kata sandi darurat">
      <div class="alert danger" id="drE" hidden>${ic('shield-exclamation')}<span></span></div>
      <button class="btn btn-danger-solid btn-lg" id="drB">${ic('unlock')} Masuk Darurat</button><a class="btn btn-ghost" href="#/">Batal</a></form></div>`;
    $('#drF').onsubmit = async e => {
      e.preventDefault();
      const err = $('#drE'), b = $('#drB'); err.hidden = true; btnLoading(b, true, 'Memeriksa…');
      try {
        const r = await api('loginDarurat', $('#drU').value.trim(), $('#drP').value);
        if (!r.success) { err.hidden = false; $('span', err).textContent = r.message; return; }
        await masukDenganToken(r.data, false);
        toast('warning', 'Masuk dengan akses darurat', 'Segera pulihkan akun Admin, lalu keluar.');
      } catch (x) { err.hidden = false; $('span', err).textContent = x.message || 'Tidak dapat terhubung.'; }
      finally { btnLoading(b, false); }
    };
  }

  /** Router hash publik. true = sudah ditangani (jangan lanjut ke aplikasi). */
  function handleHash() {
    const h = location.hash || '#/';
    let m = h.match(/^#\/cek\/?([A-Za-z0-9-]*)/);
    if (m) { showCek(m[1]); return true; }
    if (/^#\/darurat/.test(h)) { showDarurat(); return true; }
    return false;
  }
  window.addEventListener('hashchange', () => {
    if (handleHash()) return;
    const h = location.hash;
    if (S.token && S.user) { hideAll(); $('#app').hidden = false; $('#screen-login').hidden = true; if (h !== '#/app') history.replaceState(null, '', '#/app'); return; }
    if (S.token && !S.user) { location.reload(); return; }
    if (/^#\/masuk/.test(h)) showLogin(); else showLanding();
  });

  return { showLanding, showCek, showDarurat, handleHash, hideAll };
})();

// Mulai aplikasi setelah semua skrip termuat
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

// Service worker: app shell & pustaka CDN tersedia offline (HTTPS GitHub Pages)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
