const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../controllers/db');

let sock = null;
let initPromise = null;
let lastStatus = {
  enabled: false,
  dependencyReady: false,
  connection: 'disabled',
  qr: null,
  user: null,
  lastUpdate: Date.now()
};
let brandCache = { name: null, fetchedAt: 0 };

const isEnabled = () => process.env.WA_BOT_ENABLED === '1';
const botSessions = new Map();

const normalizeJid = (jid) => String(jid || '').trim().toLowerCase();

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  if (digits.startsWith('62')) return digits;
  return digits;
};

const toJid = (phone) => {
  const num = normalizePhone(phone);
  if (!num) return '';
  return `${num}@s.whatsapp.net`;
};

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

const getAppBaseUrl = () => normalizeBaseUrl(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '');

const formatRupiah = (value) => {
  const n = Number(value || 0);
  return n.toLocaleString('id-ID');
};

const getBrandName = async () => {
  const now = Date.now();
  if (brandCache.name && now - brandCache.fetchedAt < 60000) return brandCache.name;
  try {
    const row = await db.get('SELECT nama_desa FROM pengaturan WHERE id = 1');
    const name = row && row.nama_desa ? String(row.nama_desa).trim() : '';
    brandCache = { name: name || 'Pemerintah Desa', fetchedAt: now };
    return brandCache.name;
  } catch (e) {
    brandCache = { name: 'Pemerintah Desa', fetchedAt: now };
    return brandCache.name;
  }
};

const waWrap = async (title, body) => {
  const brand = await getBrandName();
  const sep = '────────────────────────';
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  const head = `*${brand}*\n${sep}\n`;
  const mid = t ? `*${t}*\n` : '';
  return head + mid + (b || '-') + `\n${sep}`;
};

const reply = async (jid, title, body) => {
  await sendJid(jid, await waWrap(title, body));
};

const getAdminRecipients = async () => {
  const s = await db.get('SELECT whatsapp, wa_recipients FROM pengaturan WHERE id = 1');
  let recipients = [];
  if (s && s.wa_recipients) {
    try {
      const parsed = JSON.parse(s.wa_recipients);
      if (Array.isArray(parsed)) recipients = parsed;
    } catch (e) {}
  }
  if (s && s.whatsapp) recipients.unshift(String(s.whatsapp));
  recipients = Array.from(new Set(recipients.map((n) => String(n || '').replace(/[^0-9]/g, '')).filter(Boolean)));
  return recipients;
};

const notifyAdmins = async (text) => {
  try {
    const recipients = await getAdminRecipients();
    const msg = await waWrap('Notifikasi Warga (WhatsApp)', text);
    for (const phone of recipients) {
      await sendText(phone, msg);
    }
  } catch (e) {}
};

const getMessageText = (m) => {
  const msg = m && m.message ? m.message : null;
  if (!msg) return '';
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage && msg.extendedTextMessage.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage && msg.imageMessage.caption) return msg.imageMessage.caption;
  return '';
};

const normalizeKey = (key) => {
  if (!key) return { remoteJid: null, senderPn: null, senderLid: null };
  return {
    remoteJid: key.remoteJid || null,
    senderPn: key.senderPn || null,
    senderLid: key.senderLid || null
  };
};

const nowIso = () => new Date().toISOString();

const linkJidToNik = async ({ remoteJid, senderPn, senderLid, nik }) => {
  const linkedAt = nowIso();
  const lastSeen = linkedAt;
  const rows = [remoteJid, senderPn, senderLid].filter(Boolean);
  for (const j of rows) {
    await db.run(
      `INSERT INTO wa_links (jid, nik, pn_jid, lid_jid, linked_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET nik = excluded.nik, pn_jid = excluded.pn_jid, lid_jid = excluded.lid_jid, last_seen = excluded.last_seen`,
      [normalizeJid(j), nik, senderPn || null, senderLid || null, linkedAt, lastSeen]
    );
  }
};

const unlinkJids = async (jids) => {
  const list = (jids || []).filter(Boolean).map(normalizeJid);
  for (const j of list) {
    await db.run('DELETE FROM wa_links WHERE jid = ?', [j]);
  }
};

const getLinkedNik = async ({ remoteJid, senderPn, senderLid }) => {
  const candidates = [remoteJid, senderPn, senderLid].filter(Boolean).map(normalizeJid);
  for (const jid of candidates) {
    const row = await db.get('SELECT nik FROM wa_links WHERE jid = ?', [jid]);
    if (row && row.nik) return row.nik;
  }
  return null;
};

const getJidsByNik = async (nik) => {
  const rows = await db.all('SELECT jid FROM wa_links WHERE nik = ? ORDER BY linked_at DESC', [nik]);
  return rows.map((r) => r.jid).filter(Boolean);
};

const getInitialLetterContent = async (suratId, jenisSurat, tanggalPengajuan, keterangan) => {
  try {
    const template =
      (await db.get('SELECT * FROM templates WHERE nama_surat = ?', [jenisSurat])) ||
      (await db.get('SELECT * FROM templates WHERE id = ?', ['domisili'])) ||
      { nomor_kode: '470 / {CODE} / Kesra / {YEAR}', isi_surat: 'Bahwa nama tersebut di atas benar-benar penduduk desa setempat.' };

    const codePart = suratId.split('-')[1] || suratId;
    const yearPart = new Date(tanggalPengajuan).getFullYear();
    const nomorSurat = String(template.nomor_kode || '')
      .replace(/{CODE}/g, codePart)
      .replace(/{YEAR}/g, yearPart);

    let isiHtml = String(template.isi_surat || '');
    if (keterangan) {
      isiHtml = isiHtml.replace(/{keperluan}/g, keterangan.keperluan || '');
      isiHtml = isiHtml.replace(/{nama_usaha}/g, keterangan.nama_usaha || '');
      isiHtml = isiHtml.replace(/{jenis_usaha}/g, keterangan.jenis_usaha || '');
      isiHtml = isiHtml.replace(/{alamat_usaha}/g, keterangan.alamat_usaha || '');
      isiHtml = isiHtml.replace(/{nama_bayi}/g, keterangan.nama_bayi || '');
      isiHtml = isiHtml.replace(/{nama_ibu}/g, keterangan.nama_ibu || '');
      isiHtml = isiHtml.replace(/{nama_jenazah}/g, keterangan.nama_jenazah || '');
      if (keterangan.tanggal_kematian) {
        const formattedDate = new Date(keterangan.tanggal_kematian).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
        isiHtml = isiHtml.replace(/{tanggal_kematian}/g, formattedDate);
      }
    }

    return { nomorSurat, isiHtml };
  } catch (e) {
    return { nomorSurat: '', isiHtml: '' };
  }
};

const generateSuratCode = () => {
  const chars = '0123456789ABCDEF';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `SRT-${code}`;
};

const helpBody = (baseUrl) => {
  const linkRegister = baseUrl ? `${baseUrl}/register` : '/register';
  return (
    `Perintah yang bisa dipakai:\n` +
    `• menu\n` +
    `• daftar <NIK> <password>\n` +
    `• surat\n` +
    `• surat|<jenis>|<keperluan>|k=v|k=v\n` +
    `• status\n` +
    `• status <ID>\n` +
    `• apbdes [tahun]\n` +
    `• keluar\n\n` +
    `Contoh cepat:\n` +
    `• daftar 3212xxxxxxxxxxxx warga123\n` +
    `• surat|Surat Keterangan Domisili|Untuk beasiswa\n` +
    `• apbdes 2026\n\n` +
    `Belum punya akun? Daftar di: ${linkRegister}`
  );
};

const handleCommand = async ({ jid, keyInfo, text }) => {
  const lower = String(text || '').trim();
  const cmd = lower.toLowerCase();
  const base = getAppBaseUrl();

  if (
    cmd === 'menu' ||
    cmd === 'help' ||
    cmd === 'kirim menu' ||
    cmd === 'minta menu' ||
    cmd === 'kirim help' ||
    cmd === 'start' ||
    cmd === '/start'
  ) {
    await reply(jid, 'Menu Bantuan', helpBody(base));
    return true;
  }

  if (cmd.startsWith('daftar ') || cmd.startsWith('login ')) {
    const parts = lower.split(/\s+/).filter(Boolean);
    const nik = parts[1] || '';
    const password = parts.slice(2).join(' ') || '';
    if (!nik || !password) {
      await reply(jid, 'Format Login', 'Gunakan:\n• daftar <NIK> <password>');
      return true;
    }

    const user = await db.get('SELECT username, password, role, nik, nama FROM users WHERE username = ? AND role = "warga"', [nik]);
    if (!user || !user.password) {
      const linkRegister = base ? `${base}/register` : '/register';
      await reply(jid, 'Akun Tidak Ditemukan', `NIK belum terdaftar sebagai akun warga.\nDaftar dulu di: ${linkRegister}`);
      return true;
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      await reply(jid, 'Login Gagal', 'Password salah.');
      return true;
    }

    await linkJidToNik({ remoteJid: keyInfo.remoteJid, senderPn: keyInfo.senderPn, senderLid: keyInfo.senderLid, nik });
    await reply(jid, 'Login Berhasil', `Halo ${user.nama}.\nNIK: ${nik}\n\nLanjutkan:\n• ketik: surat\n• atau: surat|<jenis>|<keperluan>`);
    return true;
  }

  if (cmd.startsWith('status ')) {
    const nik = await getLinkedNik(keyInfo);
    if (!nik) {
      await reply(jid, 'Belum Login', 'Ketik:\n• daftar <NIK> <password>');
      return true;
    }
    const id = String(lower.split(/\s+/)[1] || '').trim();
    if (!id) {
      await reply(jid, 'Format Cek Status', 'Gunakan:\n• status <ID>');
      return true;
    }
    const s = await db.get('SELECT id, jenis_surat, tanggal_pengajuan, status, catatan FROM surat WHERE id = ? AND nik = ?', [id, nik]);
    if (!s) {
      await reply(jid, 'Tidak Ditemukan', 'ID surat tidak ditemukan untuk akun Anda.');
      return true;
    }
    const cetakLink = base ? `${base}/dashboard/surat/cetak/${s.id}` : `/dashboard/surat/cetak/${s.id}`;
    const loginLink = base ? `${base}/login` : '/login';
    await reply(
      jid,
      'Status Surat',
      `• ID: ${s.id}\n• Jenis: ${s.jenis_surat}\n• Status: ${s.status}\n• Catatan: ${s.catatan || '-'}\n\nCetak:\n${cetakLink}\n\nJika diminta login:\n${loginLink}`
    );
    return true;
  }

  if (cmd === 'keluar' || cmd === 'logout') {
    await unlinkJids([keyInfo.remoteJid, keyInfo.senderPn, keyInfo.senderLid]);
    botSessions.delete(normalizeJid(jid));
    await reply(jid, 'Logout', 'Sesi WhatsApp sudah dilepas.');
    return true;
  }

  if (cmd === 'status') {
    const nik = await getLinkedNik(keyInfo);
    if (!nik) {
      await reply(jid, 'Belum Login', 'Ketik:\n• daftar <NIK> <password>');
      return true;
    }
    const rows = await db.all('SELECT id, jenis_surat, tanggal_pengajuan, status FROM surat WHERE nik = ? ORDER BY id DESC LIMIT 3', [nik]);
    if (!rows || rows.length === 0) {
      await reply(jid, 'Riwayat Surat', 'Belum ada pengajuan surat.');
      return true;
    }
    const lines = rows.map((r) => `• ${r.id} — ${r.jenis_surat}\n  Status: ${r.status}`);
    await reply(jid, 'Status Pengajuan Terakhir', lines.join('\n\n'));
    return true;
  }

  if (cmd.startsWith('apbdes') || cmd.startsWith('anggaran')) {
    const parts = lower.split(/\s+/).filter(Boolean);
    const yearArg = parts[1] ? parseInt(parts[1], 10) : null;
    let tahun = yearArg;
    if (!tahun || Number.isNaN(tahun)) {
      const latest = await db.get('SELECT MAX(tahun) as tahun FROM keuangan');
      tahun = latest && latest.tahun ? latest.tahun : new Date().getFullYear();
    }

    const pendapatan = await db.get('SELECT SUM(anggaran) as anggaran, SUM(realisasi) as realisasi FROM keuangan WHERE tahun = ? AND kategori = "Pendapatan"', [tahun]);
    const belanja = await db.get('SELECT SUM(anggaran) as anggaran, SUM(realisasi) as realisasi FROM keuangan WHERE tahun = ? AND kategori = "Belanja"', [tahun]);
    const pembiayaan = await db.get('SELECT SUM(anggaran) as anggaran, SUM(realisasi) as realisasi FROM keuangan WHERE tahun = ? AND kategori = "Pembiayaan"', [tahun]);

    const link = base ? `${base}/keuangan` : '/keuangan';

    await reply(
      jid,
      `APBDes ${tahun}`,
      `Pendapatan\n• Anggaran: Rp ${formatRupiah(pendapatan && pendapatan.anggaran)}\n• Realisasi: Rp ${formatRupiah(pendapatan && pendapatan.realisasi)}\n\nBelanja\n• Anggaran: Rp ${formatRupiah(belanja && belanja.anggaran)}\n• Realisasi: Rp ${formatRupiah(belanja && belanja.realisasi)}\n\nPembiayaan\n• Anggaran: Rp ${formatRupiah(pembiayaan && pembiayaan.anggaran)}\n• Realisasi: Rp ${formatRupiah(pembiayaan && pembiayaan.realisasi)}\n\nDetail:\n${link}`
    );
    return true;
  }

  if (cmd === 'surat') {
    const nik = await getLinkedNik(keyInfo);
    if (!nik) {
      await reply(jid, 'Belum Login', 'Ketik:\n• daftar <NIK> <password>');
      return true;
    }

    const templates = await db.all('SELECT nama_surat FROM templates ORDER BY nama_surat ASC');
    const list = templates.slice(0, 12).map((t, i) => `${i + 1}. ${t.nama_surat}`).join('\n');
    botSessions.set(normalizeJid(jid), { step: 'surat_jenis', nik, templates: templates.map((t) => t.nama_surat) });
    await reply(
      jid,
      'Pengajuan Surat',
      `Pilih jenis surat (ketik angka atau nama):\n\n${list}${templates.length > 12 ? `\n\n... dan ${templates.length - 12} lainnya` : ''}`
    );
    return true;
  }

  if (cmd.startsWith('surat|')) {
    const nik = await getLinkedNik(keyInfo);
    if (!nik) {
      await reply(jid, 'Belum Login', 'Ketik:\n• daftar <NIK> <password>');
      return true;
    }

    const rawParts = String(lower).split('|').map((p) => String(p || '').trim()).filter((p) => p.length > 0);
    if (rawParts.length < 3) {
      await reply(jid, 'Format Pengajuan Cepat', 'Gunakan:\n• surat|<jenis>|<keperluan>|k=v|k=v');
      return true;
    }

    const jenisInput = rawParts[1];
    const keperluan = rawParts[2];

    const templates = await db.all('SELECT nama_surat FROM templates ORDER BY nama_surat ASC');
    const names = templates.map((t) => t.nama_surat);
    const target = String(jenisInput).toLowerCase();
    const jenis_surat =
      names.find((n) => String(n).toLowerCase() === target) ||
      names.find((n) => String(n).toLowerCase().includes(target));

    if (!jenis_surat) {
      await reply(jid, 'Jenis Tidak Ditemukan', 'Ketik:\n• surat\nuntuk lihat daftar jenis surat.');
      return true;
    }

    const extraParts = rawParts.slice(3);
    const kv = {};
    for (const p of extraParts) {
      const idx = p.indexOf('=');
      if (idx <= 0) continue;
      const k = p.slice(0, idx).trim().toLowerCase();
      const v = p.slice(idx + 1).trim();
      if (!k || !v) continue;
      kv[k] = v;
    }

    const keterangan = { keperluan };
    if (jenis_surat === 'Surat Keterangan Usaha (SKU)' || jenis_surat === 'Surat Keterangan Domisili Usaha') {
      if (kv.nama_usaha) keterangan.nama_usaha = kv.nama_usaha;
      if (kv.jenis_usaha) keterangan.jenis_usaha = kv.jenis_usaha;
      if (kv.alamat_usaha) keterangan.alamat_usaha = kv.alamat_usaha;
    } else if (jenis_surat === 'Surat Keterangan Kelahiran') {
      if (kv.nama_bayi) keterangan.nama_bayi = kv.nama_bayi;
      if (kv.nama_ibu) keterangan.nama_ibu = kv.nama_ibu;
      if (kv.hubungan) keterangan.hubungan = kv.hubungan;
    } else if (jenis_surat === 'Surat Keterangan Kematian') {
      if (kv.nama_jenazah) keterangan.nama_jenazah = kv.nama_jenazah;
      if (kv.tanggal_kematian) keterangan.tanggal_kematian = kv.tanggal_kematian;
      if (kv.hubungan) keterangan.hubungan = kv.hubungan;
    } else if (jenis_surat === 'Surat Keterangan Perbedaan Nama') {
      if (kv.nama_ibu) keterangan.nama_ibu = kv.nama_ibu;
      if (kv.nama_bayi) keterangan.nama_bayi = kv.nama_bayi;
    }

    const pemohonPenduduk = await db.get('SELECT nama FROM penduduk WHERE nik = ?', [nik]);
    const pemohonUser = await db.get('SELECT nama FROM users WHERE username = ? AND role = "warga"', [nik]);
    const nama = (pemohonPenduduk && pemohonPenduduk.nama) || (pemohonUser && pemohonUser.nama) || nik;
    const tanggal_pengajuan = new Date().toISOString().split('T')[0];
    const id = generateSuratCode();
    const status = 'Menunggu Verifikasi Staff';

    const { nomorSurat, isiHtml } = await getInitialLetterContent(id, jenis_surat, tanggal_pengajuan, keterangan);
    await db.run(
      'INSERT INTO surat (id, nik, nama, jenis_surat, tanggal_pengajuan, status, catatan, keterangan, nomor_surat, isi_surat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, nik, nama, jenis_surat, tanggal_pengajuan, status, '', JSON.stringify(keterangan), nomorSurat, isiHtml]
    );

    await notifyAdmins(`📩 Pengajuan surat via WhatsApp\nNama: ${nama}\nNIK: ${nik}\nJenis: ${jenis_surat}\nKeperluan: ${keperluan}`);

    const loginLink = base ? `${base}/login` : '/login';
    await reply(
      jid,
      'Pengajuan Berhasil',
      `• ID: ${id}\n• Jenis: ${jenis_surat}\n• Status: ${status}\n\nJika diminta login:\n${loginLink}\n\nLink cetak akan dikirim setelah disetujui.`
    );
    return true;
  }

  return false;
};

const handleFlow = async ({ jid, keyInfo, text }) => {
  const session = botSessions.get(normalizeJid(jid));
  if (!session || !session.step) return false;
  const input = String(text || '').trim();
  if (!input) return true;

  if (session.step === 'surat_jenis') {
    const templates = session.templates || [];
    let chosen = null;
    const idx = parseInt(input, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= templates.length) {
      chosen = templates[idx - 1];
    } else {
      const low = input.toLowerCase();
      chosen = templates.find((t) => String(t).toLowerCase() === low) || templates.find((t) => String(t).toLowerCase().includes(low));
    }

    if (!chosen) {
      await reply(jid, 'Jenis Tidak Ditemukan', 'Ketik angka atau nama surat yang tersedia.');
      return true;
    }

    session.jenis_surat = chosen;
    session.step = 'surat_keperluan';
    botSessions.set(normalizeJid(jid), session);
    await reply(jid, 'Isi Keperluan', `Jenis surat:\n• ${chosen}\n\nSilakan tulis keperluannya.`);
    return true;
  }

  if (session.step === 'surat_keperluan') {
    const nik = session.nik;
    const jenis_surat = session.jenis_surat;
    const keperluan = input;

    const pemohonPenduduk = await db.get('SELECT nama FROM penduduk WHERE nik = ?', [nik]);
    const pemohonUser = await db.get('SELECT nama FROM users WHERE username = ? AND role = "warga"', [nik]);
    const nama = (pemohonPenduduk && pemohonPenduduk.nama) || (pemohonUser && pemohonUser.nama) || nik;

    const tanggal_pengajuan = new Date().toISOString().split('T')[0];
    const id = generateSuratCode();
    const status = 'Menunggu Verifikasi Staff';
    const keterangan = { keperluan };

    const { nomorSurat, isiHtml } = await getInitialLetterContent(id, jenis_surat, tanggal_pengajuan, keterangan);

    await db.run(
      'INSERT INTO surat (id, nik, nama, jenis_surat, tanggal_pengajuan, status, catatan, keterangan, nomor_surat, isi_surat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, nik, nama, jenis_surat, tanggal_pengajuan, status, '', JSON.stringify(keterangan), nomorSurat, isiHtml]
    );

    await notifyAdmins(`📩 Pengajuan surat via WhatsApp\nNama: ${nama}\nNIK: ${nik}\nJenis: ${jenis_surat}\nKeperluan: ${keperluan}`);

    const base = getAppBaseUrl();
    const webLink = base ? `${base}/login` : '/login';

    botSessions.delete(normalizeJid(jid));
    await reply(
      jid,
      'Pengajuan Berhasil',
      `• ID: ${id}\n• Status: ${status}\n\nJika diminta login:\n${webLink}\n\nLink cetak akan dikirim setelah disetujui.`
    );
    return true;
  }

  return false;
};

const init = async () => {
  if (!isEnabled()) return null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let baileys;
    let pino;
    try {
      baileys = require('@whiskeysockets/baileys');
      pino = require('pino');
      lastStatus.dependencyReady = true;
    } catch (e) {
      console.error('WA bot dependency belum terpasang. Jalankan: npm i @whiskeysockets/baileys pino');
      lastStatus = {
        enabled: true,
        dependencyReady: false,
        connection: 'missing_dependency',
        qr: null,
        user: null,
        lastUpdate: Date.now()
      };
      return null;
    }

    const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;
    const authDir = path.join(__dirname, '../data/wa_auth');
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' })
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      lastStatus.enabled = true;
      lastStatus.dependencyReady = true;
      if (qr) {
        lastStatus.connection = 'qr';
        lastStatus.qr = qr;
        lastStatus.user = null;
        lastStatus.lastUpdate = Date.now();
      } else if (connection) {
        lastStatus.connection = connection;
        lastStatus.qr = null;
        lastStatus.user = socket.user || null;
        lastStatus.lastUpdate = Date.now();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        sock = null;
        initPromise = null;
        if (!shouldReconnect) {
          lastStatus.connection = 'logged_out';
          lastStatus.qr = null;
          lastStatus.user = null;
          lastStatus.lastUpdate = Date.now();
        }
        if (shouldReconnect) {
          init().catch(() => {});
        }
      }
    });

    socket.ev.on('messages.upsert', async (m) => {
      try {
        if (!m || m.type !== 'notify' || !m.messages || m.messages.length === 0) return;
        const msg = m.messages[0];
        if (!msg || msg.key.fromMe) return;
        const text = getMessageText(msg);
        const keyInfo = normalizeKey(msg.key);
        const from = keyInfo.remoteJid;
        if (!from || !text) return;

        await db.run('UPDATE wa_links SET last_seen = ? WHERE jid = ?', [nowIso(), normalizeJid(from)]).catch(() => {});

        if (String(text).trim().toLowerCase() === 'ping') {
          await socket.sendMessage(from, { text: 'pong' });
          return;
        }

        const handledFlow = await handleFlow({ jid: from, keyInfo, text });
        if (handledFlow) return;
        const handledCmd = await handleCommand({ jid: from, keyInfo, text });
        if (handledCmd) return;
      } catch (e) {}
    });

    sock = socket;
    return sock;
  })();

  return initPromise;
};

const getStatus = () => {
  if (!isEnabled()) {
    return {
      enabled: false,
      dependencyReady: false,
      connection: 'disabled',
      qr: null,
      user: null,
      lastUpdate: Date.now()
    };
  }
  return { ...lastStatus, enabled: true };
};

const resetSession = async () => {
  const authDir = path.join(__dirname, '../data/wa_auth');
  try {
    if (sock && typeof sock.logout === 'function') {
      try {
        await sock.logout();
      } catch (e) {}
    }
  } catch (e) {}
  sock = null;
  initPromise = null;
  lastStatus = {
    enabled: true,
    dependencyReady: lastStatus.dependencyReady,
    connection: 'reset',
    qr: null,
    user: null,
    lastUpdate: Date.now()
  };

  try {
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
  } catch (e) {}
};

const sendJid = async (jid, text) => {
  if (!isEnabled()) return false;
  if (!sock) await init();
  if (!sock) return false;
  const to = normalizeJid(jid);
  if (!to) return false;
  try {
    await sock.sendMessage(to, { text: String(text || '') });
    return true;
  } catch (e) {
    return false;
  }
};

const sendText = async (phone, text) => {
  if (!isEnabled()) return false;
  if (!sock) await init();
  if (!sock) return false;
  const jid = toJid(phone);
  if (!jid) return false;
  try {
    await sock.sendMessage(jid, { text: String(text || '') });
    return true;
  } catch (e) {
    return false;
  }
};

module.exports = {
  isEnabled,
  init,
  getStatus,
  resetSession,
  sendJid,
  sendText
};
