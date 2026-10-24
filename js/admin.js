'use strict';
/* ============================================================================
   SIMONIK-LG v2 — admin.js : modul baru untuk Admin/Kapus
   - WA & Notifikasi (gas-notifikasi-wa-crm): Konfigurasi + matriks event, Antrean, Blast WA
   - CRM Kontak: tabel + facet + detail timeline + impor/ekspor/gabung
   - Dokumen & Verifikasi (gas-doc-engine): template Google Docs, engine, daftar terbit, tarik
   - Migrasi Data (gas-migrasi-database): upgrade skema, impor v1, impor CSV, arsip tahunan
   - Keamanan (gas-rahasia-script-properties): status rahasia (tersamar), akses darurat, sesi
   Data tiap menu di-cache di S.adm → buka ulang menu = 0 ms, lalu disegarkan di latar.
   ============================================================================ */
S.adm = S.adm || {};

function admHead(title, desc, right) {
  return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div>${right || ''}</div>`;
}
function skelRows(n, h) { return Array.from({ length: n }, () => `<div class="skel mt-8" style="height:${h || 44}px"></div>`).join(''); }
function swRow(id, label, help, on) {
  return `<label class="row-between gap-12" style="padding:10px 0"><span><span class="fw-6">${label}</span>${help ? `<span class="help" style="display:block">${help}</span>` : ''}</span><span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span></label>`;
}
async function admLoad(key, action, ...args) {
  try {
    const r = await api(action, S.token, ...args);
    if (r.success) { S.adm[key] = r.data; return r.data; }
    toast('error', 'Gagal memuat', r.message);
  } catch (e) { if (!e.auth) toast('warning', 'Tidak dapat terhubung', e.message); }
  return null;
}
async function admDo(btn, label, action, ...args) {
  if (btn) btnLoading(btn, true, label || 'Memproses…');
  try {
    const r = await api(action, S.token, ...args);
    if (!r.success) { toast('error', 'Gagal', r.message); return null; }
    if (r.message && r.message !== 'OK') toast('success', r.message);
    return r;
  } catch (e) { if (!e.auth) toast('error', 'Tidak dapat terhubung', e.message); return null; }
  finally { if (btn) btnLoading(btn, false); }
}
function onRoute(name) { return S.route === name; }
function statusPill(s) {
  const m = { Terkirim: 'pill-diverifikasi', Antri: 'pill-pending', Gagal: 'pill-tidak', Batal: 'pill-tercatat', Berjalan: 'pill-berlangsung', Selesai: 'pill-selesai', Dihentikan: 'pill-tercatat',
    TERBIT: 'pill-diverifikasi', DITARIK: 'pill-tidak', Terdaftar: 'pill-diverifikasi', 'Tidak Terdaftar': 'pill-tidak' };
  return `<span class="pill ${m[s] || 'pill-tercatat'}">${esc(s || '—')}</span>`;
}

// ═══════════════════════════ WA & NOTIFIKASI ═══════════════════════════════
S.ui.notif = S.ui.notif || { tab: 'konfig', qStatus: '', qKanal: '' };
RENDER.notifikasi = function () {
  const st = S.ui.notif, el = $('#pg-notifikasi');
  const tabs = [['konfig', 'Konfigurasi'], ['antrean', 'Antrean Kirim'], ['blast', 'Blast WhatsApp']];
  el.innerHTML = admHead('WA &amp; Notifikasi', 'WhatsApp (Fonnte) dan email dikirim lewat antrean di latar — aplikasi tetap instan.',
    `<button class="btn btn-outline" id="nfProses">${ic('send')} Proses Antrean</button>`) +
    `<div class="tabs mb-16">${tabs.map(t => `<button class="tab ${st.tab === t[0] ? 'active' : ''}" data-nt="${t[0]}">${t[1]}</button>`).join('')}</div><div id="nfBody"></div>`;
  $$('[data-nt]', el).forEach(b => b.onclick = () => { st.tab = b.dataset.nt; RENDER.notifikasi(); });
  $('#nfProses').onclick = async e => { const r = await admDo(e.currentTarget, 'Memproses…', 'notifProsesSekarang'); if (r) { S.adm.queue = null; if (st.tab !== 'konfig') RENDER.notifikasi(); } };
  ({ konfig: nfKonfig, antrean: nfAntrean, blast: nfBlast })[st.tab]();
};

function nfKonfig() {
  const box = $('#nfBody'), c = S.adm.notif;
  if (!c) { box.innerHTML = skelRows(6, 60); admLoad('notif', 'notifConfig').then(d => d && onRoute('notifikasi') && nfKonfig()); return; }
  const m = c.matriks;
  box.innerHTML = `<div class="dash-grid two">
    <div class="stack-16">
      <div class="card stack-16"><h3 class="section-title">${ic('whatsapp')} WhatsApp (Fonnte)</h3>
        ${swRow('nfWa', 'Aktifkan notifikasi WhatsApp', 'Saklar utama. Bila mati, tidak ada WA yang dikirim.', c.waAktif)}
        <div class="field"><label for="nfTok">Token Fonnte</label>
          <div class="row gap-8"><input class="input mono grow" id="nfTok" type="password" autocomplete="off" placeholder="${c.token.ada ? 'Tersimpan: ' + esc(c.token.samar) + ' — isi untuk mengganti' : 'Tempel token dari fonnte.com → Device'}">
          ${c.token.ada ? `<button class="btn btn-outline btn-sm" id="nfTokDel" title="Hapus token">${ic('trash')}</button>` : ''}</div>
          <span class="help">${ic('shield-lock')} Disimpan di <b>Script Properties</b> server, tidak pernah di Sheets atau di halaman ini.</span></div>
        <div class="grid-2"><div class="field"><label for="nfBatch">Ukuran batch blast</label><select class="select" id="nfBatch">${[10, 20, 50].map(n => `<option ${c.batchDefault === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label for="nfJeda">Jeda antar pesan (detik)</label><input class="input mono" id="nfJeda" value="${esc(c.jeda)}" placeholder="5 atau 3-8"></div></div>
        ${swRow('nfDet', 'Deteksi otomatis nomor terdaftar WA', 'Nomor yang tidak terdaftar dilewati agar kuota tidak terbuang.', c.deteksiOtomatis)}
        <div class="row gap-8 wrap"><input class="input mono" id="nfTesNo" style="max-width:200px" placeholder="08xxxxxxxxxx" inputmode="tel"><button class="btn btn-soft btn-sm" id="nfTes">${ic('send')} Kirim WA uji</button><button class="btn btn-ghost btn-sm" id="nfDev">${ic('phone')} Cek perangkat</button></div>
        <div id="nfDevOut"></div>
      </div>
      <div class="card stack-16"><h3 class="section-title">${ic('envelope')} Email</h3>
        ${swRow('nfEm', 'Aktifkan notifikasi email', '', c.emailAktif)}
        <div class="field"><label for="nfNama">Nama pengirim</label><input class="input" id="nfNama" value="${esc(c.namaPengirim)}"></div>
        <div class="row-between text-sm"><span>Sisa kuota email hari ini</span><b class="mono">${c.kuotaEmail}</b></div>
        <div class="row gap-8"><input class="input" id="nfTesEm" type="email" placeholder="email@contoh.com"><button class="btn btn-soft btn-sm" id="nfTesE">${ic('send')} Uji</button></div>
      </div>
      <div class="card stack-16"><h3 class="section-title">${ic('link-45deg')} Umum</h3>
        <div class="field"><label for="nfUrl">Alamat aplikasi (GitHub Pages)</label><input class="input mono" id="nfUrl" value="${esc(c.appUrl || '')}" placeholder="${esc(location.origin + location.pathname)}"><span class="help">Dipakai untuk tautan di pesan dan QR verifikasi dokumen.</span></div>
        <div class="field"><label for="nfJam">Jam pengingat kegiatan belum selesai (WITA)</label><input class="input mono" id="nfJam" type="number" min="15" max="23" value="${c.pengingatJam}"></div>
        <div class="row wrap gap-4"><span class="pill ${c.trigger ? 'pill-green' : 'pill-tidak'}">${ic(c.trigger ? 'check-circle' : 'x-circle')} Pekerja 1 menit ${c.trigger ? 'aktif' : 'belum aktif'}</span><span class="pill ${c.keepWarm ? 'pill-green' : 'pill-tercatat'}">${ic('fire')} Pemanasan server ${c.keepWarm ? 'aktif' : 'mati'}</span></div>
      </div>
    </div>
    <div class="card stack-16"><h3 class="section-title">${ic('grid-3x3-gap')} Matriks Event × Kanal</h3>
      <p class="text-sm muted">Pilih kejadian yang dikirim lewat WA dan/atau email. Klik <b>Ubah teks</b> untuk menyesuaikan pesan. Variabel: <span class="mono">{nama} {institusi} {link}</span> dan variabel khusus event.</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Kejadian</th><th style="width:60px">WA</th><th style="width:60px">Email</th><th style="width:90px"></th></tr></thead><tbody>
      ${Object.values(m).map(e => `<tr style="cursor:default"><td class="text-sm">${esc(e.label)}</td><td><label class="switch"><input type="checkbox" data-mw="${e.kode}" ${e.wa ? 'checked' : ''}><span></span></label></td><td><label class="switch"><input type="checkbox" data-me="${e.kode}" ${e.email ? 'checked' : ''}><span></span></label></td><td><button class="btn btn-ghost btn-sm" data-mt="${e.kode}">Ubah teks</button></td></tr>`).join('')}
      </tbody></table></div>
    </div>
  </div>
  <div class="row mt-16" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" id="nfSave">${ic('check2')} Simpan Konfigurasi</button></div>`;
  const kumpul = () => {
    const matriks = {};
    Object.values(m).forEach(e => { matriks[e.kode] = { wa: $(`[data-mw="${e.kode}"]`).checked, email: $(`[data-me="${e.kode}"]`).checked, pesan: e.pesan, subjek: e.subjek }; });
    return { waAktif: $('#nfWa').checked, emailAktif: $('#nfEm').checked, token: $('#nfTok').value.trim(), batchDefault: +$('#nfBatch').value, jeda: $('#nfJeda').value.trim(),
      deteksiOtomatis: $('#nfDet').checked, namaPengirim: $('#nfNama').value.trim(), appUrl: $('#nfUrl').value.trim(), pengingatJam: +$('#nfJam').value, matriks };
  };
  $('#nfSave').onclick = async e => { const r = await admDo(e.currentTarget, 'Menyimpan…', 'notifSimpanConfig', kumpul()); if (r) { S.adm.notif = r.data; nfKonfig(); } };
  if ($('#nfTokDel')) $('#nfTokDel').onclick = async e => {
    if (!await confirmDialog({ title: 'Hapus token Fonnte?', message: 'WhatsApp otomatis berhenti sampai token baru diisi.', danger: true, okText: 'Hapus' })) return;
    const r = await admDo(e.currentTarget, '…', 'simpanRahasia', 'FONNTE_TOKEN', '__HAPUS__'); if (r) { S.adm.notif = null; nfKonfig(); }
  };
  $('#nfTes').onclick = e => admDo(e.currentTarget, 'Mengirim…', 'waTest', $('#nfTesNo').value.trim());
  $('#nfTesE').onclick = e => admDo(e.currentTarget, 'Mengirim…', 'emailTest', $('#nfTesEm').value.trim());
  $('#nfDev').onclick = async e => {
    const r = await admDo(e.currentTarget, 'Memeriksa…', 'waDevice');
    if (r) $('#nfDevOut').innerHTML = `<div class="notice ${r.data.status === 'connect' ? 'green' : 'warn'}">${ic('phone')}<span>Perangkat <b class="mono">${esc(r.data.nomor || '-')}</b> · status <b>${esc(r.data.status || '-')}</b> · kuota ${esc(r.data.kuota || '-')} ${r.data.kedaluwarsa ? '· aktif s.d. ' + esc(r.data.kedaluwarsa) : ''}</span></div>`;
  };
  $$('[data-mt]', box).forEach(b => b.onclick = () => {
    const e = m[b.dataset.mt];
    openModal({ title: e.label, size: 'lg', body: `<div class="stack-16"><div class="field"><label>Subjek email</label><input class="input" id="mtS" value="${esc(e.subjek)}"></div>
      <div class="field"><label>Isi pesan (WA memakai *tebal*)</label><textarea class="textarea mono" id="mtP" rows="9">${esc(e.pesan)}</textarea></div></div>`,
      foot: `<button class="btn btn-ghost" id="mtD">Kembalikan bawaan</button><button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="mtOk">Terapkan</button>`,
      onOpen: mm => {
        mm.$('#mtD').onclick = () => { mm.$('#mtS').value = e.subjekDefault; mm.$('#mtP').value = e.pesanDefault; };
        mm.$('#mtOk').onclick = () => { e.subjek = mm.$('#mtS').value; e.pesan = mm.$('#mtP').value; mm.close(); toast('info', 'Teks diterapkan', 'Klik "Simpan Konfigurasi" untuk menyimpan.'); };
      } });
  });
}

function nfAntrean() {
  const st = S.ui.notif, box = $('#nfBody'), q = S.adm.queue;
  const draw = d => {
    const r = d.ringkas;
    box.innerHTML = `<div class="grid-4 mb-16">${kpi('hourglass-split', 'ic-amber', r.Antri || 0, 'Antri')}${kpi('check2-circle', 'ic-green', r.Terkirim || 0, 'Terkirim')}${kpi('x-octagon', 'ic-red', r.Gagal || 0, 'Gagal')}${kpi('slash-circle', 'ic-sky', r.Batal || 0, 'Batal')}</div>
      <div class="card mb-16"><div class="filter-bar"><select class="select" id="aqS"><option value="">Semua status</option>${['Antri', 'Terkirim', 'Gagal', 'Batal'].map(x => `<option ${st.qStatus === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <select class="select" id="aqK"><option value="">Semua kanal</option>${['WA', 'EMAIL'].map(x => `<option ${st.qKanal === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <button class="btn btn-outline" id="aqRetry" ${r.Gagal ? '' : 'disabled'}>${ic('arrow-repeat')} Ulangi yang gagal</button><button class="btn btn-ghost" id="aqRef">${ic('arrow-clockwise')}</button></div></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Kanal</th><th>Penerima</th><th>Event</th><th>Pesan</th><th>Status</th></tr></thead><tbody>
      ${d.rows.filter(x => (!st.qStatus || x.Status === st.qStatus) && (!st.qKanal || x.Kanal === st.qKanal)).slice(0, 200).map(x => `<tr style="cursor:default"><td class="mono text-xs">${esc((x.DikirimPada || x.DibuatPada).slice(5, 16))}</td><td>${x.Kanal === 'WA' ? ic('whatsapp') : ic('envelope')}</td>
        <td class="text-sm"><b>${esc(x.NamaPenerima)}</b><div class="mono text-xs muted">${esc(x.Tujuan)}</div></td><td class="text-xs">${esc(x.Event)}</td><td class="text-xs clamp2" style="max-width:320px">${esc(x.Pesan)}</td>
        <td>${statusPill(x.Status)}${x.Status === 'Gagal' ? `<div class="text-xs muted">${esc(String(x.Respon).slice(0, 60))}</div>` : ''}</td></tr>`).join('') || `<tr><td colspan="6">${emptyState('inbox', 'Antrean kosong')}</td></tr>`}
      </tbody></table></div>`;
    $('#aqS').onchange = e => { st.qStatus = e.target.value; draw(d); };
    $('#aqK').onchange = e => { st.qKanal = e.target.value; draw(d); };
    $('#aqRef').onclick = () => { S.adm.queue = null; nfAntrean(); };
    $('#aqRetry').onclick = async e => { if (await admDo(e.currentTarget, '…', 'notifRetry', [])) { S.adm.queue = null; nfAntrean(); } };
  };
  if (q) draw(q); else box.innerHTML = skelRows(6);
  admLoad('queue', 'notifQueue', {}).then(d => d && onRoute('notifikasi') && st.tab === 'antrean' && draw(d));
}

function nfBlast() {
  const box = $('#nfBody'), L = S.adm.blasts;
  const st = S.ui.blast = S.ui.blast || { sumber: 'crm', segmen: '', tag: '', statusWA: '', manual: '', aud: null, hanyaTerdaftar: true };
  const listHtml = l => !l ? skelRows(3) : (l.length ? l.map(b => `<div class="card-tint mb-8"><div class="row-between gap-8"><div class="grow"><b>${esc(b.judul)}</b><div class="text-xs muted">${esc(b.tanggal)} · ${esc(b.oleh)} · batch ${b.batch} · jeda ${esc(b.jeda)} dtk</div></div>${statusPill(b.status)}</div>
      <div class="progress mt-8"><i style="width:${b.persen}%"></i></div><div class="row-between text-xs mt-4"><span>${b.terkirim} terkirim · ${b.gagal} gagal · ${b.sisa} sisa dari ${b.total}</span>
      <span class="row gap-4">${b.status === 'Berjalan' ? `<button class="btn btn-soft btn-sm" data-bp="${b.id}">${ic('play')} Kirim batch</button><button class="btn btn-ghost btn-sm" data-bs="${b.id}">${ic('stop')} Hentikan</button>` : ''}</span></div></div>`).join('') : `<p class="text-sm muted">Belum ada blast.</p>`);
  const segmen = ['', 'Pegawai Lapangan', 'Pimpinan', 'Admin', 'Kader', 'Mitra'];
  box.innerHTML = `<div class="dash-grid two">
    <div class="card stack-16"><h3 class="section-title">${ic('megaphone')} Blast Baru</h3>
      ${S.adm.notif && !S.adm.notif.waAktif ? `<div class="notice warn">${ic('exclamation-triangle')}<span>WhatsApp belum aktif. Isi token & aktifkan di tab Konfigurasi.</span></div>` : ''}
      <div class="field"><label for="blJ">Judul (internal)</label><input class="input" id="blJ" placeholder="Mis. Undangan Rapat Lokmin Oktober"></div>
      <div class="field"><label for="blP">Isi pesan</label><textarea class="textarea" id="blP" rows="6" placeholder="Yth. {nama},&#10;…&#10;— {institusi}"></textarea><span class="help">Variabel: {nama} {institusi} {link}. Gunakan *teks* untuk tebal.</span></div>
      <div class="segmented"><button class="${st.sumber === 'crm' ? 'active' : ''}" data-src="crm">Dari CRM</button><button class="${st.sumber === 'manual' ? 'active' : ''}" data-src="manual">Daftar manual</button></div>
      ${st.sumber === 'crm' ? `<div class="grid-3"><select class="select" id="blSeg">${segmen.map(x => `<option value="${x}" ${st.segmen === x ? 'selected' : ''}>${x || 'Semua segmen'}</option>`).join('')}</select>
        <input class="input" id="blTag" placeholder="Tag (opsional)" value="${esc(st.tag)}"><select class="select" id="blWa"><option value="">Semua status WA</option>${['Terdaftar', 'Tidak Terdaftar'].map(x => `<option ${st.statusWA === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`
        : `<textarea class="textarea mono" id="blMan" rows="4" placeholder="081234567890|Nama&#10;081298765432|Nama lain">${esc(st.manual)}</textarea>`}
      <button class="btn btn-outline" id="blAud">${ic('people')} Hitung penerima</button>
      <div id="blAudOut"></div>
      <div class="grid-2"><div class="field"><label>Ukuran batch</label><select class="select" id="blB">${[10, 20, 50].map(n => `<option ${(S.adm.notif ? S.adm.notif.batchDefault : 20) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Jeda (detik)</label><input class="input mono" id="blD" value="${esc(S.adm.notif ? S.adm.notif.jeda : '5')}"></div></div>
      <label class="check"><input type="checkbox" id="blHT" ${st.hanyaTerdaftar ? 'checked' : ''}> Lewati nomor yang tidak terdaftar WhatsApp</label>
      <button class="btn btn-primary btn-lg" id="blGo" disabled>${ic('send')} Buat Blast</button>
    </div>
    <div class="card"><div class="row-between mb-8"><h3 class="section-title">Riwayat Blast</h3><button class="btn btn-ghost btn-sm" id="blRef">${ic('arrow-clockwise')}</button></div><div id="blList">${listHtml(L)}</div></div>
  </div>`;
  const bindList = () => {
    $$('[data-bp]', box).forEach(b => b.onclick = async e => { const r = await admDo(e.currentTarget, 'Mengirim…', 'waBlastProcess', b.dataset.bp); if (r) { S.adm.blasts = r.data; $('#blList').innerHTML = listHtml(r.data); bindList(); } });
    $$('[data-bs]', box).forEach(b => b.onclick = async e => { if (!await confirmDialog({ title: 'Hentikan blast?', message: 'Pesan yang belum terkirim dibatalkan.', danger: true, okText: 'Hentikan' })) return; const r = await admDo(e.currentTarget, '…', 'waBlastStop', b.dataset.bs); if (r) { S.adm.blasts = r.data; $('#blList').innerHTML = listHtml(r.data); bindList(); } });
  };
  bindList();
  if (!S.adm.notif) admLoad('notif', 'notifConfig');
  admLoad('blasts', 'waBlastList').then(d => { if (d && onRoute('notifikasi') && $('#blList')) { $('#blList').innerHTML = listHtml(d); bindList(); } });
  $$('[data-src]', box).forEach(b => b.onclick = () => { st.sumber = b.dataset.src; st.aud = null; nfBlast(); });
  $('#blRef').onclick = () => admLoad('blasts', 'waBlastList').then(d => { if (d) { $('#blList').innerHTML = listHtml(d); bindList(); } });
  $('#blAud').onclick = async e => {
    const f = st.sumber === 'crm' ? { sumber: 'crm', segmen: (st.segmen = $('#blSeg').value), tag: (st.tag = $('#blTag').value.trim()), statusWA: (st.statusWA = $('#blWa').value) } : { sumber: 'manual', manual: (st.manual = $('#blMan').value) };
    const r = await admDo(e.currentTarget, 'Menghitung…', 'waAudience', f);
    if (!r) return;
    st.aud = r.data; const g = r.data.ringkas;
    $('#blAudOut').innerHTML = `<div class="notice green">${ic('people-fill')}<span><b>${g.valid}</b> nomor valid dari ${g.total} · ${g.tidakValid} tidak valid · ${g.ganda} ganda · ${g.optOut} opt-out · ${g.terdaftarWA} terdaftar WA</span></div>`;
    $('#blGo').disabled = !g.valid;
  };
  $('#blGo').onclick = async e => {
    const aud = st.aud; if (!aud) return;
    const penerima = aud.rows.filter(x => x.valid && !x.ganda && !x.optOut).map(x => ({ nama: x.nama, hp: x.hp, statusWA: x.statusWA }));
    const ok = await confirmDialog({ title: 'Kirim blast?', message: `${penerima.length} pesan akan masuk antrean dan dikirim bertahap (batch ${$('#blB').value}).`, okText: 'Ya, buat blast' });
    if (!ok) return;
    const r = await admDo(e.currentTarget, 'Membuat…', 'waBlastCreate', { judul: $('#blJ').value.trim(), pesan: $('#blP').value, ukuranBatch: +$('#blB').value, jeda: $('#blD').value.trim(), sasaran: st.sumber === 'crm' ? (st.segmen || 'Semua') + (st.tag ? ' #' + st.tag : '') : 'Manual', penerima, hanyaTerdaftar: $('#blHT').checked });
    if (r) { st.aud = null; S.adm.blasts = null; nfBlast(); }
  };
}

// ═══════════════════════════════ CRM KONTAK ═════════════════════════════════
S.ui.crm = S.ui.crm || { cari: '', segmen: '', sumber: '', statusWA: '', tag: '', duplikat: false, halaman: 1, sel: new Set() };
RENDER.crm = function () {
  const st = S.ui.crm, el = $('#pg-crm'), d = S.adm.crm, s = S.adm.crmStats;
  const filt = () => ({ cari: st.cari, segmen: st.segmen, sumber: st.sumber, statusWA: st.statusWA, tag: st.tag, duplikat: st.duplikat, halaman: st.halaman, per: 50 });
  const facet = (k, label) => d ? `<select class="select" data-cf="${k}"><option value="">${label}</option>${Object.entries(d.facet[k] || {}).map(([v, n]) => `<option value="${esc(v)}" ${st[k] === v ? 'selected' : ''}>${esc(v)} (${n})</option>`).join('')}</select>` : '';
  el.innerHTML = admHead('CRM Kontak', 'Nama · Email · WhatsApp seluruh pegawai (sinkron otomatis) dan kontak mitra seperti kader & kepala desa.',
    `<div class="row gap-8"><button class="btn btn-outline" id="crSync">${ic('arrow-repeat')} Sinkron</button><button class="btn btn-outline" id="crImp">${ic('upload')} Impor</button><button class="btn btn-outline" id="crExp">${ic('download')} Ekspor</button></div>`) +
    `<div class="grid-4 mb-16">${s ? kpi('people', 'ic-green', s.total, 'Total kontak', s.baru7 + ' baru 7 hari') + kpi('whatsapp', 'ic-green', s.terdaftarWA, 'Terdaftar WA', s.belumCek + ' belum dicek') + kpi('envelope-check', 'ic-sky', s.emailValid, 'Email valid') + kpi('exclamation-diamond', 'ic-amber', s.duplikat, 'Duplikat', s.optOut + ' opt-out · ' + s.tidakBisa + ' tak terjangkau') : skelRows(1, 96)}</div>
    <div class="card mb-16"><div class="filter-bar"><div class="input-icon">${ic('search')}<input class="input" id="crQ" placeholder="Cari nama, NIP, email, nomor" value="${esc(st.cari)}"></div>
      ${facet('segmen', 'Semua segmen')}${facet('statusWA', 'Semua status WA')}${facet('sumber', 'Semua sumber')}
      <label class="check"><input type="checkbox" id="crDup" ${st.duplikat ? 'checked' : ''}> Hanya duplikat</label></div></div>
    <div class="bulk-bar" id="crBulk" ${st.sel.size ? '' : 'hidden'}><b>${st.sel.size} dipilih</b><button class="btn btn-soft btn-sm" data-cb="tag">${ic('tag')} Tag</button><button class="btn btn-soft btn-sm" data-cb="untag">Lepas tag</button><button class="btn btn-soft btn-sm" data-cb="optout">${ic('bell-slash')} Opt-out</button><button class="btn btn-soft btn-sm" data-cb="optin">Opt-in</button>${st.sel.size > 1 ? `<button class="btn btn-soft btn-sm" data-cb="merge">${ic('union')} Gabung</button>` : ''}<button class="btn btn-ghost btn-sm" data-cb="hapusManual">${ic('trash')} Hapus (manual)</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" id="crAll"></th><th>Nama</th><th>WhatsApp</th><th>Email</th><th>Segmen</th><th>Tag</th><th>Pesan</th></tr></thead><tbody id="crBody">
    ${!d ? `<tr><td colspan="7">${skelRows(5, 28)}</td></tr>` : d.rows.map(k => `<tr data-ck="${k.id}"><td onclick="event.stopPropagation()"><input type="checkbox" data-cs="${k.id}" ${st.sel.has(k.id) ? 'checked' : ''}></td>
      <td><b>${esc(k.nama)}</b>${k.duplikat ? ' <span class="pill pill-flag">duplikat</span>' : ''}<div class="text-xs muted">${esc(k.info.Jabatan || '')}${k.info.Unit ? ' · ' + esc(k.info.Unit) : ''}${k.sumber === 'manual' ? 'Kontak manual' : ''}</div></td>
      <td><span class="mono text-sm">${esc(k.wa || '—')}</span> ${k.wa ? statusPill(k.statusWA || 'Belum dicek') : ''}${k.optOut ? ' <span class="pill pill-tidak">opt-out</span>' : ''}</td>
      <td class="text-sm">${esc(k.email || '—')}${k.email && k.emailValid === 'TIDAK' ? ' <span class="pill pill-tidak">tidak valid</span>' : ''}</td><td class="text-sm">${esc(k.segmen)}</td>
      <td class="text-xs">${esc(k.tag)}</td><td class="mono text-sm">${k.jumlahPesan}</td></tr>`).join('') || `<tr><td colspan="7">${emptyState('person-x', 'Tidak ada kontak')}</td></tr>`}
    </tbody></table></div>
    ${d && d.total > d.per ? `<div class="pager mt-16">${pageButtons(d.halaman, Math.ceil(d.total / d.per))}</div>` : ''}
    <p class="text-xs muted mt-8">${d ? `${d.total} kontak · sinkron terakhir ${d.sinkronTerakhir ? new Date(d.sinkronTerakhir).toLocaleString('id-ID') : '-'}` : ''}</p>`;
  const reload = () => admLoad('crm', 'crmList', filt()).then(x => x && onRoute('crm') && RENDER.crm());
  $('#crQ').oninput = debounce(e => { st.cari = e.target.value; st.halaman = 1; reload(); }, 300);
  $$('[data-cf]', el).forEach(x => x.onchange = () => { st[x.dataset.cf] = x.value; st.halaman = 1; reload(); });
  $('#crDup').onchange = e => { st.duplikat = e.target.checked; reload(); };
  $$('[data-pg]', el).forEach(b => b.onclick = () => { st.halaman = +b.dataset.pg; reload(); });
  $$('[data-cs]', el).forEach(c => c.onchange = () => { c.checked ? st.sel.add(c.dataset.cs) : st.sel.delete(c.dataset.cs); RENDER.crm(); });
  $('#crAll').onchange = e => { (d ? d.rows : []).forEach(k => e.target.checked ? st.sel.add(k.id) : st.sel.delete(k.id)); RENDER.crm(); };
  $$('[data-ck]', el).forEach(tr => tr.onclick = () => crmDetailDrawer(tr.dataset.ck));
  $('#crSync').onclick = async e => { if (await admDo(e.currentTarget, 'Sinkron…', 'crmSync')) { S.adm.crmStats = null; reload(); admLoad('crmStats', 'crmStats'); } };
  $('#crExp').onclick = async e => {
    const r = await admDo(e.currentTarget, 'Mengekspor…', 'crmExport', filt()); if (!r) return;
    const head = ['Nama', 'WhatsApp', 'StatusWA', 'Email', 'Segmen', 'Sumber', 'Tag', 'OptOut', 'NIP', 'Jabatan', 'Unit', 'JumlahPesan', 'TerakhirDihubungi'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const csv = [head.join(',')].concat(r.data.rows.map(k => [k.nama, k.wa, k.statusWA, k.email, k.segmen, k.sumber, k.tag, k.optOut ? 'YA' : 'TIDAK', k.info.NIP, k.info.Jabatan, k.info.Unit, k.jumlahPesan, k.terakhir].map(q).join(','))).join('\n');
    downloadBase64(btoa(unescape(encodeURIComponent('﻿' + csv))), 'CRM_Kontak_' + todayStr() + '.csv', 'text/csv');
  };
  $('#crImp').onclick = crmImporModal;
  $$('[data-cb]', el).forEach(b => b.onclick = async e => {
    const aksi = b.dataset.cb, ids = Array.from(st.sel);
    if (aksi === 'merge') return crmMergeModal(ids);
    let nilai = '';
    if (aksi === 'tag' || aksi === 'untag') { nilai = prompt('Nama tag:'); if (!nilai) return; }
    if (aksi === 'hapusManual' && !await confirmDialog({ title: 'Hapus kontak manual?', message: 'Hanya kontak bersumber manual yang dihapus. Kontak pegawai tidak terpengaruh.', danger: true, okText: 'Hapus' })) return;
    if (await admDo(e.currentTarget, '…', 'crmBulk', ids, aksi, nilai)) { st.sel.clear(); S.adm.crmStats = null; reload(); admLoad('crmStats', 'crmStats'); }
  });
  if (!d) reload();
  if (!s) admLoad('crmStats', 'crmStats').then(x => x && onRoute('crm') && RENDER.crm());
};

async function crmDetailDrawer(id) {
  const dr = openDrawer({ title: 'Detail Kontak', body: skelRows(5) });
  const r = await admLoad('crmDetail', 'crmDetail', id);
  if (!r) return dr.close();
  const k = r.kontak;
  const body = `<div class="stack-16">
    <div class="row gap-12"><div class="avatar lg">${esc(initials(k.nama))}</div><div class="grow"><div class="fw-7 text-lg">${esc(k.nama)}</div><div class="text-sm muted">${esc(k.segmen)} · ${esc(k.sumber)}${k.info.NIP ? ' · NIP ' + esc(k.info.NIP) : ''}</div></div></div>
    <div class="row gap-8 wrap">${k.wa ? `<a class="btn btn-soft btn-sm" href="https://wa.me/${esc(k.wa.replace(/^0/, '62'))}" target="_blank" rel="noopener">${ic('whatsapp')} Chat WA</a>` : ''}${k.email ? `<a class="btn btn-soft btn-sm" href="mailto:${esc(k.email)}">${ic('envelope')} Email</a>` : ''}</div>
    <div class="grid-2"><div class="field"><label>No. WhatsApp</label><input class="input mono" id="cdW" value="${esc(k.wa)}"></div><div class="field"><label>Email</label><input class="input" id="cdE" value="${esc(k.email)}"></div></div>
    <div class="field"><label>Tag (pisahkan koma)</label><input class="input" id="cdT" value="${esc(k.tag)}"></div>
    <div class="field"><label>Catatan</label><textarea class="textarea" id="cdC" rows="3">${esc(k.catatan)}</textarea></div>
    ${swRow('cdO', 'Opt-out (tidak menerima blast)', '', k.optOut)}
    ${k.sumber === 'pegawai' ? `<p class="help">${ic('info-circle')} Perubahan nama/WA/email ikut memperbarui data pegawai.</p>` : ''}
    <div class="card-tint stack"><b class="text-sm">Catat interaksi</b><div class="row gap-8"><select class="select" id="cdK" style="max-width:140px">${['Telepon', 'WA Manual', 'Kunjungan', 'Catatan'].map(x => `<option>${x}</option>`).join('')}</select><input class="input grow" id="cdR" placeholder="Ringkasan…"><button class="btn btn-soft" id="cdAdd">${ic('plus')}</button></div></div>
    <div><b class="text-sm">Timeline</b><div class="timeline mt-8" id="cdTl">${tl(r.timeline)}</div></div></div>`;
  function tl(t) { return t.length ? t.map(x => `<div class="row gap-8" style="padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start">${ic(x.jenis === 'pesan' ? (x.kanal === 'WA' ? 'whatsapp' : 'envelope') : 'chat-left-text')}<div class="grow"><div class="text-sm">${esc(x.ringkasan)}</div><div class="text-xs muted mono">${esc(x.waktu)} · ${esc(x.kanal)}${x.oleh ? ' · ' + esc(x.oleh) : ''}${x.status ? ' · ' + esc(x.status) : ''}</div></div></div>`).join('') : '<p class="text-sm muted">Belum ada interaksi.</p>'; }
  dr.el.querySelector('.drawer-body, .modal-body') && (dr.el.querySelector('.drawer-body, .modal-body').innerHTML = body);
  const foot = dr.el.querySelector('.drawer-foot, .modal-foot');
  if (foot) foot.innerHTML = `<button class="btn btn-outline" data-close>Tutup</button><button class="btn btn-primary" id="cdSave">${ic('check2')} Simpan</button>`;
  dr.$('#cdAdd').onclick = async e => { const x = await admDo(e.currentTarget, '…', 'crmInteraksi', id, dr.$('#cdK').value, dr.$('#cdR').value.trim()); if (x) { dr.$('#cdR').value = ''; dr.$('#cdTl').innerHTML = tl(x.data.timeline); } };
  const save = dr.$('#cdSave');
  if (save) save.onclick = async e => {
    const x = await admDo(e.currentTarget, 'Menyimpan…', 'crmSave', { id, wa: dr.$('#cdW').value.trim(), email: dr.$('#cdE').value.trim(), tag: dr.$('#cdT').value.trim(), catatan: dr.$('#cdC').value, optOut: dr.$('#cdO').checked });
    if (x) { dr.close(); S.adm.crmStats = null; admLoad('crm', 'crmList', Object.assign({}, S.ui.crm, { sel: undefined })).then(() => onRoute('crm') && RENDER.crm()); }
  };
}

function crmImporModal() {
  openModal({ title: 'Impor Kontak Mitra', size: 'lg', body: `<div class="stack-16"><p class="text-sm muted">Untuk kader posyandu, kepala desa, guru UKS, dan mitra lain di luar daftar pegawai. Satu baris per kontak:</p>
    <pre class="card-tint mono text-xs" style="margin:0">Nama;No WA;Email;Segmen;Tag\nMaria Kader;081234567890;;Kader;Posyandu Melati</pre>
    <textarea class="textarea mono" id="ciT" rows="8" placeholder="Tempel dari Excel (kolom dipisah Tab, ; atau ,)"></textarea>
    <p class="help">${ic('shield-check')} Nomor ganda otomatis dilewati — aman diimpor berulang.</p></div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="ciGo">${ic('upload')} Impor</button>`,
    onOpen: m => m.$('#ciGo').onclick = async e => {
      const rows = m.$('#ciT').value.split(/\r?\n/).map(l => l.split(/\t|;|,/).map(x => x.trim())).filter(p => p[0] && !/^nama$/i.test(p[0]))
        .map(p => ({ nama: p[0], wa: p[1] || '', email: p[2] || '', segmen: p[3] || 'Mitra', tag: p[4] || '' }));
      if (!rows.length) return toast('warning', 'Tidak ada baris yang bisa dibaca');
      if (await admDo(e.currentTarget, 'Mengimpor…', 'crmImport', rows)) { m.close(); S.adm.crm = null; S.adm.crmStats = null; RENDER.crm(); }
    } });
}
function crmMergeModal(ids) {
  const rows = (S.adm.crm ? S.adm.crm.rows : []).filter(k => ids.includes(k.id));
  openModal({ title: 'Gabung Kontak Duplikat', body: `<p class="text-sm muted mb-8">Pilih kontak UTAMA. Tag, catatan, dan jumlah pesan kontak lain digabung ke kontak utama.</p>
    ${rows.map((k, i) => `<label class="check card-tint mb-8"><input type="radio" name="mu" value="${k.id}" ${i ? '' : 'checked'}> <span><b>${esc(k.nama)}</b> · <span class="mono">${esc(k.wa)}</span> · ${esc(k.sumber)}</span></label>`).join('')}`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="mgGo">${ic('union')} Gabungkan</button>`,
    onOpen: m => m.$('#mgGo').onclick = async e => {
      const utama = m.el.querySelector('input[name=mu]:checked').value;
      if (await admDo(e.currentTarget, '…', 'crmMerge', utama, ids.filter(x => x !== utama))) { m.close(); S.ui.crm.sel.clear(); S.adm.crm = null; S.adm.crmStats = null; RENDER.crm(); }
    } });
}

// ═════════════════════════ DOKUMEN & VERIFIKASI ════════════════════════════
S.ui.dok = S.ui.dok || { cari: '', status: '', halaman: 1 };
RENDER.dokumen = function () {
  const el = $('#pg-dokumen'), st = S.ui.dok, ds = S.adm.deStatus, dl = S.adm.deDaftar, admin = isAdmin();
  const tplCard = !ds ? skelRows(3) : `<div class="stack-16">
    <div class="stack"><span class="fw-6">Mesin dokumen</span><div class="segmented">${[['docs', 'Template Google Docs'], ['html', 'HTML bawaan']].map(([v, l]) => `<button class="${ds.engine === v ? 'active' : ''}" data-eng="${v}" ${admin ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>
    ${ds.template && !ds.template.error ? `<div class="card-tint row gap-12"><span style="font-size:28px;color:var(--accent)">${ic('file-earmark-word-fill')}</span><div class="grow"><b class="text-sm">${esc(ds.template.nama)}</b><div class="text-xs muted">versi ${esc(ds.versi || '1')} · diubah ${esc(ds.template.diubah || '-')}</div></div>
      <a class="btn btn-outline btn-sm" href="${esc(ds.template.url)}" target="_blank" rel="noopener">${ic('pencil-square')} Edit di Docs</a></div>` : `<div class="notice warn">${ic('exclamation-triangle')}<span>${ds.template ? esc(ds.template.error) : 'Template belum ada.'}</span></div>`}
    ${admin ? `<div class="row gap-8 wrap"><button class="btn btn-soft btn-sm" id="dePind">${ic('upc-scan')} Pindai placeholder</button><button class="btn btn-ghost btn-sm" id="deBaru">${ic('file-earmark-plus')} Buat template bawaan</button><button class="btn btn-ghost btn-sm" id="deSendiri">${ic('link')} Pakai Docs sendiri</button></div>` : ''}
    <details ${(ds.bidang || []).some(b => !b.dikenal) ? 'open' : ''}><summary class="text-sm fw-6" style="cursor:pointer">Placeholder di template (${(ds.bidang || []).length})${(ds.bidang || []).some(b => !b.dikenal) ? ' · <span style="color:var(--flag-text)">ada yang tidak dikenal</span>' : ' · semua dikenal ✓'}</summary>
      <div class="row wrap gap-4 mt-8">${(ds.bidang || []).map(b => `<span class="pill ${b.dikenal ? 'pill-green' : 'pill-flag'} mono" title="${esc(b.arti)}">{{${esc(b.kunci)}}}</span>`).join('')}</div></details>
    <details><summary class="text-sm fw-6" style="cursor:pointer">Daftar placeholder yang tersedia</summary><div class="text-xs mt-8 stack">
      ${[['Teks', ds.placeholder.teks], ['Baris tabel (diulang per kegiatan, tandai baris dengan {{#KEGIATAN}})', ds.placeholder.baris], ['Gambar', ds.placeholder.gambar]].map(([t, o]) => `<div><b>${t}</b><div class="row wrap gap-4 mt-4">${Object.entries(o).map(([k, v]) => `<span class="pill pill-tercatat mono" title="${esc(v)}">{{${k}}}</span>`).join('')}</div></div>`).join('')}</div></details>
  </div>`;
  el.innerHTML = admHead('Dokumen &amp; Verifikasi', 'Setiap laporan PDF bernomor, ber-QR, dan tercatat. Siapa pun dapat memindai QR untuk memastikan keasliannya.',
    `<button class="btn btn-primary" data-go="laporan">${ic('file-earmark-pdf')} Buat Laporan</button>`) +
    `<div class="grid-4 mb-16">${ds ? kpi('patch-check', 'ic-green', ds.terbit, 'Dokumen terbit') + kpi('x-octagon', 'ic-red', ds.ditarik, 'Ditarik') + kpi('gear', 'ic-sky', ds.engine === 'docs' ? 'Docs' : 'HTML', 'Mesin aktif') + kpi('qr-code', 'ic-amber', '#/cek', 'Halaman verifikasi', '', `onclick="window.open(location.pathname+'#/cek','_blank')"`) : skelRows(1, 96)}</div>
    <div class="dash-grid two"><div class="card"><h3 class="section-title mb-8">Template Laporan</h3>${tplCard}</div>
      <div class="card"><div class="filter-bar mb-8"><div class="input-icon">${ic('search')}<input class="input" id="dkQ" placeholder="Cari nomor, kode, pegawai" value="${esc(st.cari)}"></div><select class="select" id="dkS"><option value="">Semua</option><option ${st.status === 'TERBIT' ? 'selected' : ''}>TERBIT</option><option ${st.status === 'DITARIK' ? 'selected' : ''}>DITARIK</option></select></div>
        <div id="dkList">${!dl ? skelRows(4) : dl.rows.map(x => `<div class="row gap-12" style="padding:10px 0;border-bottom:1px solid var(--border)"><span style="font-size:22px;color:${x.status === 'TERBIT' ? 'var(--primary)' : 'var(--danger)'}">${ic(x.status === 'TERBIT' ? 'patch-check-fill' : 'x-octagon-fill')}</span>
          <div class="grow" style="min-width:0"><div class="text-sm fw-6 ellipsis">${esc(x.pegawai)} — ${esc(x.periode)}</div><div class="mono text-xs muted ellipsis">${esc(x.nomor)} · ${esc(x.kode)}</div>${x.alasanTarik ? `<div class="text-xs" style="color:var(--danger-text)">${esc(x.alasanTarik)}</div>` : ''}</div>
          ${statusPill(x.status)}<button class="icon-btn" data-dkdl="${esc(x.berkasId)}" title="Unduh">${ic('download')}</button>${x.status === 'TERBIT' ? `<button class="icon-btn" data-dkt="${x.id}" title="Tarik">${ic('slash-circle')}</button>` : ''}</div>`).join('') || emptyState('file-earmark', 'Belum ada dokumen')}</div>
        ${dl && dl.total > 25 ? `<div class="pager mt-8">${pageButtons(dl.halaman, Math.ceil(dl.total / 25))}</div>` : ''}</div></div>`;
  const loadList = () => admLoad('deDaftar', 'deDaftar', st).then(x => x && onRoute('dokumen') && RENDER.dokumen());
  $('#dkQ').oninput = debounce(e => { st.cari = e.target.value; st.halaman = 1; loadList(); }, 300);
  $('#dkS').onchange = e => { st.status = e.target.value; loadList(); };
  $$('[data-pg]', el).forEach(b => b.onclick = () => { st.halaman = +b.dataset.pg; loadList(); });
  $$('[data-eng]', el).forEach(b => b.onclick = async e => { const r = await admDo(e.currentTarget, '…', 'deSimpanEngine', b.dataset.eng, ''); if (r) { S.adm.deStatus = r.data; RENDER.dokumen(); } });
  if ($('#dePind')) $('#dePind').onclick = async e => { if (await admDo(e.currentTarget, 'Memindai…', 'dePindai')) admLoad('deStatus', 'deStatus').then(() => RENDER.dokumen()); };
  if ($('#deBaru')) $('#deBaru').onclick = async e => {
    if (!await confirmDialog({ title: 'Buat template bawaan baru?', message: 'Template lama tetap tersimpan di Drive, tetapi aplikasi akan memakai template baru.', okText: 'Buat' })) return;
    const r = await admDo(e.currentTarget, 'Membuat…', 'deBuatTemplate'); if (r) { S.adm.deStatus = r.data; RENDER.dokumen(); }
  };
  if ($('#deSendiri')) $('#deSendiri').onclick = () => openModal({ title: 'Pakai Google Docs sendiri', body: `<div class="stack-16"><p class="text-sm muted">Salin template bawaan, ubah sesuka hati di Google Docs (kop, kalimat, tata letak), lalu tempel URL-nya di sini. Wajib ada satu baris tabel berisi <span class="mono">{{#KEGIATAN}}</span>.</p>
      <input class="input mono" id="dsU" placeholder="https://docs.google.com/document/d/…/edit"></div>`, foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-primary" id="dsGo">Pakai template</button>`,
    onOpen: m => m.$('#dsGo').onclick = async e => { const r = await admDo(e.currentTarget, 'Memeriksa…', 'deSimpanEngine', 'docs', m.$('#dsU').value.trim()); if (r) { S.adm.deStatus = r.data; m.close(); RENDER.dokumen(); } } });
  $$('[data-dkdl]', el).forEach(b => b.onclick = async () => { b.innerHTML = '<span class="spin"></span>'; try { const x = await api('unduhLaporan', S.token, b.dataset.dkdl); if (x.success) downloadBase64(x.data.base64, x.data.name, 'application/pdf'); else toast('error', 'Gagal', x.message); } catch (e) { toast('error', 'Tidak dapat terhubung', e.message); } b.innerHTML = ic('download'); });
  $$('[data-dkt]', el).forEach(b => b.onclick = () => openModal({ title: 'Tarik Dokumen', body: `<div class="stack-16"><div class="notice danger">${ic('exclamation-octagon')}<span>Setelah ditarik, pemindaian QR dokumen ini akan menampilkan status <b>DITARIK</b>. Tindakan ini tercatat di log.</span></div><div class="field"><label>Alasan</label><textarea class="textarea" id="tkA" rows="3"></textarea></div></div>`,
    foot: `<button class="btn btn-outline" data-close>Batal</button><button class="btn btn-danger-solid" id="tkGo">Tarik Dokumen</button>`,
    onOpen: m => m.$('#tkGo').onclick = async e => { if (await admDo(e.currentTarget, '…', 'deTarik', b.dataset.dkt, m.$('#tkA').value.trim())) { m.close(); S.adm.deStatus = null; loadList(); admLoad('deStatus', 'deStatus'); } } }));
  if (!ds) admLoad('deStatus', 'deStatus').then(x => x && onRoute('dokumen') && RENDER.dokumen());
  if (!dl) loadList();
};

// ═════════════════════════════ MIGRASI DATA ═════════════════════════════════
RENDER.migrasi = function () {
  const el = $('#pg-migrasi'), d = S.adm.mig, thn = +todayStr().slice(0, 4);
  el.innerHTML = admHead('Migrasi Data', 'Pindahkan data SIMONIK-LG v1 atau rekap manual lama ke database ini. Semua langkah bisa diuji coba dulu (dry-run) dan aman diulang.') +
    `<div class="grid-4 mb-16">${d ? kpi('diagram-3', 'ic-green', 'v' + d.skema, 'Versi skema', d.skema < d.skemaApp ? 'Perlu upgrade ke v' + d.skemaApp : 'Terbaru') + kpi('people', 'ic-sky', d.jumlah.Pegawai, 'Pegawai') + kpi('clipboard-data', 'ic-amber', d.jumlah.Kegiatan, 'Kegiatan aktif', d.rentang ? tglIndo(d.rentang.dari, 1) + ' – ' + tglIndo(d.rentang.sampai, 1) : '') + kpi('archive', 'ic-orange', d.arsip.length, 'Arsip tahunan') : skelRows(1, 96)}</div>
    <div class="dash-grid two"><div class="stack-16">
      <div class="card stack-16"><h3 class="section-title">${ic('1-circle')} Upgrade skema</h3><p class="text-sm muted">Menambah sheet/kolom baru (No_HP, CRM, antrean, dokumen) tanpa menghapus data lama.</p><button class="btn btn-soft" id="mgSk">${ic('arrow-up-circle')} Periksa &amp; upgrade skema</button></div>
      <div class="card stack-16"><h3 class="section-title">${ic('2-circle')} Impor dari SIMONIK-LG v1</h3>
        <div class="field"><label for="mgSrc">URL / ID spreadsheet DB_SIMONIK_LG lama</label><input class="input mono" id="mgSrc" placeholder="https://docs.google.com/spreadsheets/d/…"></div>
        <div class="row wrap gap-8">${['Pegawai', 'Kegiatan', 'Master_Lokasi', 'Master_Jenis_Kegiatan', 'Pengaturan', 'Log_Hapus'].map(x => `<label class="check"><input type="checkbox" data-ms="${x}" ${['Pegawai', 'Kegiatan', 'Master_Lokasi', 'Master_Jenis_Kegiatan'].includes(x) ? 'checked' : ''}> ${x.replace(/_/g, ' ')}</label>`).join('')}</div>
        <label class="check"><input type="checkbox" id="mgTimpa"> Timpa data yang sudah ada (bila berbeda)</label>
        <label class="check"><input type="checkbox" id="mgDelta"> Delta: hanya yang berubah sejak impor terakhir</label>
        <div class="notice">${ic('info-circle')}<span>Jalankan dengan akun Google yang sama dengan pemilik v1 agar foto/berkas di Drive tetap terbuka. Kata sandi lama tetap berlaku dan otomatis ditingkatkan saat pegawai login.</span></div>
        <div class="row gap-8"><button class="btn btn-outline" id="mgDry">${ic('eye')} Uji coba</button><button class="btn btn-primary" id="mgRun">${ic('database-down')} Impor sekarang</button></div><div id="mgOut"></div></div>
    </div><div class="stack-16">
      <div class="card stack-16"><h3 class="section-title">${ic('3-circle')} Impor rekap manual (CSV)</h3>
        <p class="text-sm muted">Kolom yang dikenali: <span class="mono">Tanggal, NIP/Nama, Desa/Lokasi, Tempat, Jenis, Uraian, Jam Mulai, Jam Selesai, Keterangan</span>. Tanggal boleh 07/03/2025, 2025-03-07, atau 7 Maret 2025.</p>
        <input type="file" id="mgCsv" accept=".csv,text/csv" class="input"><div id="mgCsvOut"></div>
        <div class="row gap-8"><button class="btn btn-outline" id="mgCDry" disabled>${ic('eye')} Uji coba</button><button class="btn btn-primary" id="mgCRun" disabled>${ic('upload')} Impor CSV</button></div></div>
      <div class="card stack-16"><h3 class="section-title">${ic('4-circle')} Arsip tahunan</h3>
        <p class="text-sm muted">Memindahkan kegiatan tahun lama ke spreadsheet arsip terpisah agar aplikasi tetap cepat. Laporan tahun lama tetap bisa dicetak.</p>
        <div class="row gap-8"><select class="select" id="mgTh" style="max-width:140px">${[1, 2, 3, 4, 5].map(i => `<option>${thn - i}</option>`).join('')}</select><button class="btn btn-outline" id="mgADry">${ic('eye')} Uji coba</button><button class="btn btn-soft" id="mgARun">${ic('archive')} Arsipkan</button></div>
        ${d && d.arsip.length ? d.arsip.map(a => `<div class="row-between text-sm"><span>${ic('archive')} Tahun <b>${a.tahun}</b> · ${a.jumlah} kegiatan</span><a href="${esc(a.url)}" target="_blank" rel="noopener">Buka</a></div>`).join('') : ''}</div>
      <div class="card"><h3 class="section-title mb-8">Riwayat migrasi</h3>${d ? (d.log.map(l => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="row-between"><b class="text-sm">${esc(l.Jenis)}</b><span class="mono text-xs muted">${esc(l.Waktu)}</span></div><div class="text-xs muted">${l.DryRun === 'YA' ? '<span class="pill pill-tercatat">uji coba</span> ' : ''}${esc(l.Ringkasan)}</div></div>`).join('') || '<p class="text-sm muted">Belum ada.</p>') : skelRows(3)}</div>
    </div></div>`;
  const reload = () => admLoad('mig', 'migrasiStatus').then(x => x && onRoute('migrasi') && RENDER.migrasi());
  const opt = dry => ({ sumber: $('#mgSrc').value.trim(), sheets: $$('[data-ms]', el).filter(c => c.checked).map(c => c.dataset.ms), dryRun: dry, timpa: $('#mgTimpa').checked, delta: $('#mgDelta').checked });
  const hasil = (r, box) => { if (!r) return; const h = r.data.hasil; box.innerHTML = `<div class="notice ${r.data.dryRun ? '' : 'green'} mt-8">${ic(r.data.dryRun ? 'eye' : 'check-circle')}<div class="text-sm">${h ? Object.entries(h).map(([k, v]) => `<div><b>${k.replace(/_/g, ' ')}</b>: ${v.lewati ? esc(v.lewati) : `+${v.tambah} baru · ${v.ubah} diperbarui · ${v.sama} sama${v.cacat ? ' · ' + v.cacat + ' tanpa kunci' : ''}`}</div>`).join('') : esc(r.message)}</div></div>`; };
  $('#mgSk').onclick = async e => { if (await admDo(e.currentTarget, 'Memeriksa…', 'migrasiSkema')) reload(); };
  $('#mgDry').onclick = async e => hasil(await admDo(e.currentTarget, 'Menguji…', 'migrasiImport', opt(true)), $('#mgOut'));
  $('#mgRun').onclick = async e => {
    if (!await confirmDialog({ title: 'Impor data v1?', message: 'Data akan ditulis ke database aktif. Proses aman diulang (tidak membuat data ganda).', okText: 'Impor' })) return;
    const r = await admDo(e.currentTarget, 'Mengimpor…', 'migrasiImport', opt(false)); hasil(r, $('#mgOut')); if (r) { reload(); syncNow(false); }
  };
  let csvRows = null;
  $('#mgCsv').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    csvRows = parseCsv(await f.text());
    $('#mgCsvOut').innerHTML = `<p class="text-sm">${ic('filetype-csv')} ${csvRows.length} baris terbaca · kolom: <span class="mono text-xs">${esc(Object.keys(csvRows[0] || {}).join(', '))}</span></p>`;
    $('#mgCDry').disabled = $('#mgCRun').disabled = !csvRows.length;
  };
  const csvOut = r => { if (!r) return; const d2 = r.data; $('#mgCsvOut').innerHTML = `<div class="notice ${d2.dryRun ? '' : 'green'}">${ic('info-circle')}<div class="text-sm">${esc(r.message)}${d2.galat.length ? `<div class="text-xs mt-4">${d2.galat.slice(0, 8).map(g => `Baris ${g.baris}: ${esc(g.alasan)}`).join('<br>')}${d2.jumlahGalat > 8 ? '<br>…' : ''}</div>` : ''}</div></div>`; };
  $('#mgCDry').onclick = async e => csvOut(await admDo(e.currentTarget, 'Menguji…', 'migrasiImportCsv', csvRows, true));
  $('#mgCRun').onclick = async e => { const r = await admDo(e.currentTarget, 'Mengimpor…', 'migrasiImportCsv', csvRows, false); csvOut(r); if (r) { reload(); syncNow(false); } };
  $('#mgADry').onclick = e => admDo(e.currentTarget, 'Menghitung…', 'migrasiArsip', $('#mgTh').value, true);
  $('#mgARun').onclick = async e => {
    if (!await confirmDialog({ title: 'Arsipkan tahun ' + $('#mgTh').value + '?', message: 'Kegiatan tahun tersebut dipindah ke spreadsheet arsip (diverifikasi dahulu sebelum dihapus dari database utama).', okText: 'Arsipkan' })) return;
    if (await admDo(e.currentTarget, 'Mengarsipkan…', 'migrasiArsip', $('#mgTh').value, false)) reload();
  };
  if (!d) reload();
};
/** Parser CSV kecil (tanda kutip, koma/titik koma, BOM). */
function parseCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const delim = (txt.split('\n')[0].match(/;/g) || []).length > (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

// ═══════════════════════════════ KEAMANAN ═══════════════════════════════════
RENDER.keamanan = function () {
  const el = $('#pg-keamanan'), d = S.adm.sec;
  const ok = (b, t, f) => `<div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--border)"><span class="text-sm">${t}</span><span class="pill ${b ? 'pill-green' : 'pill-tidak'}">${ic(b ? 'check-circle' : 'x-circle')} ${b ? 'Aman' : (f || 'Belum ada')}</span></div>`;
  const perf = API.perf.slice(-20).reverse();
  el.innerHTML = admHead('Keamanan', 'Semua rahasia disimpan di Script Properties server — tidak pernah di kode, Sheets, atau halaman ini.') +
    `<div class="dash-grid two"><div class="stack-16">
      <div class="card"><h3 class="section-title mb-8">${ic('shield-lock')} Status rahasia</h3>${d ? ok(d.sessionSecret, 'Kunci tanda tangan sesi (SESSION_SECRET)') + ok(d.pepper, 'Pepper hash kata sandi (PEPPER)') + ok(d.darurat, 'Akses darurat (hash, bukan teks asli)') + ok(d.fonnte.ada, 'Token Fonnte ' + (d.fonnte.ada ? `<span class="mono">${esc(d.fonnte.samar)}</span>` : ''), 'Belum diisi') +
        `<div class="row-between text-sm mt-8"><span>Penggunaan Script Properties</span><b class="mono">${Math.round(d.ukuranProperties / 1024)} / ${Math.round(d.batasProperties / 1024)} KB</b></div><div class="progress mt-4"><i style="width:${Math.min(100, d.ukuranProperties / d.batasProperties * 100)}%"></i></div>
        <div class="row-between text-sm mt-8"><span>Token logout yang dicabut (aktif)</span><b class="mono">${d.tokenDicabut}</b></div>${d.daruratTerkunci ? `<div class="notice danger mt-8">${ic('lock')}<span>Akses darurat sedang terkunci karena percobaan gagal berulang.</span></div>` : ''}` : skelRows(4)}</div>
      <div class="card stack-16"><h3 class="section-title">${ic('key')} Ganti kata sandi akses darurat</h3><p class="text-sm muted">Akses darurat dipakai bila semua akun Admin terkunci. Buka <span class="mono">#/darurat</span> di alamat aplikasi.</p>
        <input class="input" id="sdP" type="password" autocomplete="new-password" placeholder="Kata sandi darurat baru (min. 12 karakter)"><button class="btn btn-outline" id="sdGo">${ic('check2')} Simpan</button></div>
    </div><div class="stack-16">
      <div class="card stack-16"><h3 class="section-title">${ic('box-arrow-right')} Keluarkan pengguna dari semua perangkat</h3><p class="text-sm muted">Gunakan bila HP pegawai hilang atau kata sandi bocor.</p>
        <div class="row gap-8"><select class="select grow" id="scP">${S.pegawai.slice().sort((a, b) => a.nama.localeCompare(b.nama)).map(p => `<option value="${p.id}">${esc(p.nama)} — ${esc(p.peran)}</option>`).join('')}</select><button class="btn btn-danger" id="scGo">Cabut sesi</button></div></div>
      <div class="card"><h3 class="section-title mb-8">${ic('lightning-charge')} Performa API (perangkat ini)</h3>
        ${perf.length ? `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Aksi</th><th>Waktu</th><th>Hasil</th></tr></thead><tbody>${perf.map(p => `<tr style="cursor:default"><td class="mono text-xs">${esc(p.action)}</td><td class="mono text-xs" style="color:${p.ms > 3000 ? 'var(--danger)' : p.ms > 1500 ? 'var(--warn)' : 'var(--primary-text)'}">${p.ms} ms</td><td>${p.ok ? ic('check-circle') : ic('x-circle')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="text-sm muted">Belum ada data.</p>'}
        <p class="help mt-8">Rotasi SESSION_SECRET (mengeluarkan semua pengguna) dijalankan dari editor Apps Script: fungsi <span class="mono">rotasiSecretSesi</span>.</p></div>
    </div></div>`;
  $('#sdGo').onclick = async e => { const v = $('#sdP').value; if (v.length < 12) return toast('warning', 'Minimal 12 karakter'); if (await admDo(e.currentTarget, 'Menyimpan…', 'gantiSandiDarurat', v)) $('#sdP').value = ''; };
  $('#scGo').onclick = async e => { const id = $('#scP').value; if (!await confirmDialog({ title: 'Cabut semua sesi?', message: 'Pengguna harus login ulang di semua perangkat.', danger: true, okText: 'Cabut' })) return; admDo(e.currentTarget, '…', 'cabutSesiPengguna', id); };
  admLoad('sec', 'statusKeamanan').then(x => x && onRoute('keamanan') && !d && RENDER.keamanan());
};
