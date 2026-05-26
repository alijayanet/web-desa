require('dotenv').config(); // Muat variabel dari file .env

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const db = require('./controllers/db');

// Kontroler
const publicController = require('./controllers/publicController');
const authController = require('./controllers/authController');
const dashboardController = require('./controllers/dashboardController');
const suratController = require('./controllers/suratController');
const pengaduanController = require('./controllers/pengaduanController');
const beritaController = require('./controllers/beritaController');
const absensiController = require('./controllers/absensiController');

// Middleware
const auth = require('./middleware/auth');
const upload = require('./middleware/upload');
const waBot = require('./services/waBot');

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const okName = name.endsWith('.csv');
    const type = String(file.mimetype || '').toLowerCase();
    const okType =
      type.includes('text/csv') ||
      type.includes('application/csv') ||
      type.includes('application/vnd.ms-excel') ||
      type.includes('text/plain') ||
      type.includes('application/octet-stream');
    cb(null, okName || okType);
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

// Inisialisasi Database SQLite akan dijalankan secara asinkron saat menyalakan server di bawah.

// Konfigurasi Template Engine EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parsing Body request
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Konfigurasi Session
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'desa-digital-secret-fallback-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 // 1 hari aktif
    }
  })
);

app.use('/uploads/attendance', (req, res, next) => {
  if (!req.session || !req.session.user) return res.status(401).send('Unauthorized');
  const role = String(req.session.user.role || '').toLowerCase();
  if (role === 'staff' || role === 'sekdes' || role === 'kades' || role === 'kuwu') return next();
  return res.status(403).send('Forbidden');
});

// Menyajikan file statis dari folder public/
app.use(express.static(path.join(__dirname, 'public')));

// Middleware pencatat akses rute (Logger sederhana)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ==========================================
// 1. RUTE PUBLIK WEBSITE DESA
// ==========================================
app.get('/', publicController.renderHome);
app.get('/profil', publicController.renderProfil);
app.get('/berita', publicController.renderBerita);
app.get('/berita/:id', publicController.renderDetailBerita);
app.get('/keuangan', publicController.renderKeuangan);

// ==========================================
// 2. RUTE AUTENTIKASI (LOGIN & LOGOUT)
// ==========================================
app.get('/login', authController.renderLogin);
app.post('/login', authController.processLogin);
app.get('/register', authController.renderRegister);
app.post('/register', authController.processRegister);
app.get('/logout', authController.logout);

// ==========================================
// 3. RUTE DASHBOARD TERPROTEKSI (RBAC)
// ==========================================
app.use('/dashboard', auth.isAuthenticated);

// Rute Pengalihan Legacy (Backward Compatibility)
app.get('/dashboard/pengaduan-kelola', (req, res) => {
  res.redirect('/dashboard/pengaduan/kelola' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''));
});
app.get('/dashboard/surat-kelola', (req, res) => {
  res.redirect('/dashboard/surat/kelola' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''));
});
app.get('/dashboard/surat-warga', (req, res) => {
  res.redirect('/dashboard/surat' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''));
});
app.get('/dashboard/pengaduan-warga', (req, res) => {
  res.redirect('/dashboard/pengaduan' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''));
});

// Beranda Dashboard
app.get('/dashboard', dashboardController.renderDashboard);

// Profil Mandiri Warga (Akses: Warga saja)
app.get('/dashboard/profil-saya', auth.restrictTo('warga'), dashboardController.renderProfilSaya);

// Manajemen Kependudukan (Akses: Staff, Sekdes)
app.get('/dashboard/penduduk', auth.restrictTo('staff', 'sekdes'), dashboardController.renderPenduduk);
app.post('/dashboard/penduduk', auth.restrictTo('staff', 'sekdes'), dashboardController.addPenduduk);
app.post('/dashboard/penduduk/edit', auth.restrictTo('staff', 'sekdes'), dashboardController.editPenduduk);
app.get('/dashboard/penduduk/hapus/:nik', auth.restrictTo('staff', 'sekdes'), dashboardController.deletePenduduk);
app.get('/dashboard/penduduk/export', auth.restrictTo('staff', 'sekdes'), dashboardController.exportPendudukCsv);
app.post('/dashboard/penduduk/import', auth.restrictTo('staff', 'sekdes'), uploadCsv.single('file'), dashboardController.importPendudukCsv);

// Pengajuan Surat Online (Akses: Warga saja)
app.get('/dashboard/surat', auth.restrictTo('warga'), suratController.renderSuratWarga);
app.post('/dashboard/surat', auth.restrictTo('warga'), suratController.createSuratRequest);

// Pengelolaan & Approval Surat (Akses: Staff, Sekdes, Kades)
app.get('/dashboard/surat/kelola', auth.restrictTo('staff', 'sekdes', 'kades'), suratController.renderSuratKelola);
app.post('/dashboard/surat/kelola', auth.restrictTo('staff', 'sekdes', 'kades'), suratController.updateSuratStatus);
app.post('/dashboard/surat/manual', auth.restrictTo('staff', 'sekdes'), suratController.createSuratManual);
app.post('/dashboard/surat/edit-konten', auth.restrictTo('staff', 'sekdes', 'kades'), suratController.editSuratContent);

// Cetak Surat Resmi (Akses: Semua user yang terautentikasi dan berwenang)
app.get('/dashboard/surat/cetak/:id', suratController.renderCetakSurat);

// Kirim Pengaduan Baru (Akses: Warga saja)
app.get('/dashboard/pengaduan', auth.restrictTo('warga'), pengaduanController.renderPengaduanWarga);
app.post('/dashboard/pengaduan', auth.restrictTo('warga'), pengaduanController.createPengaduan);

// Manajemen Laporan Pengaduan (Akses: Staff, Sekdes, Kades)
app.get('/dashboard/pengaduan/kelola', auth.restrictTo('staff', 'sekdes', 'kades'), pengaduanController.renderPengaduanKelola);
app.post('/dashboard/pengaduan/kelola', auth.restrictTo('staff', 'sekdes', 'kades'), pengaduanController.updatePengaduanStatus);

// Manajemen Berita Desa (Akses: Staff, Sekdes, Kades)
app.get('/dashboard/berita', auth.restrictTo('staff', 'sekdes', 'kades'), beritaController.renderBeritaKelola);
app.post('/dashboard/berita', auth.restrictTo('staff', 'sekdes', 'kades'), upload.single('gambar'), beritaController.createBerita);
app.post('/dashboard/berita/edit', auth.restrictTo('staff', 'sekdes', 'kades'), upload.single('gambar'), beritaController.updateBerita);
app.get('/dashboard/berita/hapus/:id', auth.restrictTo('staff', 'sekdes', 'kades'), beritaController.deleteBerita);

// Pengaturan Profil Desa (Akses: Sekdes, Kades)
app.get('/dashboard/pengaturan', auth.restrictTo('sekdes', 'kades'), dashboardController.renderSettings);
app.post('/dashboard/pengaturan', auth.restrictTo('sekdes', 'kades'), upload.single('logo'), dashboardController.updateSettings);

// Manajemen Kategori Desa (Akses: Staff, Sekdes, Kades)
app.get('/dashboard/kategori', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.renderKategori);
app.post('/dashboard/kategori', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.addKategori);
app.post('/dashboard/kategori/edit', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.editKategori);
app.get('/dashboard/kategori/hapus/:id', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.deleteKategori);

// Manajemen Keuangan / APBDes Desa (Akses: Staff, Sekdes, Kades)
app.get('/dashboard/keuangan', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.renderKeuangan);
app.post('/dashboard/keuangan', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.addKeuangan);
app.post('/dashboard/keuangan/edit', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.editKeuangan);
app.get('/dashboard/keuangan/hapus/:id', auth.restrictTo('staff', 'sekdes', 'kades'), dashboardController.deleteKeuangan);

// Manajemen Akun Pegawai / Staff Desa (Akses: Sekdes, Kades)
app.get('/dashboard/pegawai', auth.restrictTo('sekdes', 'kades'), dashboardController.renderPegawai);
app.post('/dashboard/pegawai', auth.restrictTo('sekdes', 'kades'), dashboardController.addPegawai);
app.post('/dashboard/pegawai/edit', auth.restrictTo('sekdes', 'kades'), dashboardController.editPegawai);
app.get('/dashboard/pegawai/hapus/:username', auth.restrictTo('sekdes', 'kades'), dashboardController.deletePegawai);

// Manajemen Template Surat (Akses: Sekdes, Kades)
app.get('/dashboard/templates', auth.restrictTo('sekdes', 'kades'), suratController.renderTemplates);
app.post('/dashboard/templates/add', auth.restrictTo('sekdes', 'kades'), suratController.addTemplate);
app.post('/dashboard/templates/edit', auth.restrictTo('sekdes', 'kades'), suratController.editTemplate);

// Absensi Perangkat Desa (Akses: Staff, Sekdes, Kades)
app.get('/dashboard/absensi', auth.restrictTo('staff', 'sekdes', 'kades'), absensiController.renderAbsensiDashboard);
app.post('/dashboard/absensi', auth.restrictTo('staff', 'sekdes', 'kades'), upload.single('absen_foto'), absensiController.submitAbsensi);

// WhatsApp Bot (Akses: Sekdes, Kades)
app.get('/dashboard/whatsapp', auth.restrictTo('sekdes', 'kades'), async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    if (settings && settings.nav_links && typeof settings.nav_links === 'string') {
      try {
        settings.nav_links = JSON.parse(settings.nav_links);
      } catch (e) {
        settings.nav_links = [];
      }
    }
    if (settings && settings.wa_recipients && typeof settings.wa_recipients === 'string') {
      try {
        settings.wa_recipients = JSON.parse(settings.wa_recipients);
      } catch (e) {
        settings.wa_recipients = [];
      }
    }
    res.render('dashboard/whatsapp', {
      settings,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error saat memuat halaman WhatsApp:', error);
    res.status(500).send('Kesalahan server.');
  }
});

app.get('/dashboard/api/whatsapp/status', auth.restrictTo('sekdes', 'kades'), async (req, res) => {
  try {
    await waBot.init();
  } catch (e) {}
  res.json(waBot.getStatus());
});

app.get('/dashboard/api/whatsapp/qr.png', auth.restrictTo('sekdes', 'kades'), async (req, res) => {
  try {
    await waBot.init();
  } catch (e) {}

  const s = waBot.getStatus();
  if (!s || s.connection !== 'qr' || !s.qr) {
    return res.status(404).send('QR tidak tersedia.');
  }

  let QRCode;
  try {
    QRCode = require('qrcode');
  } catch (e) {
    return res.status(503).send('Dependency QR belum terpasang. Jalankan: npm install');
  }

  try {
    const buf = await QRCode.toBuffer(String(s.qr), { type: 'png', margin: 1, scale: 6 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.send(buf);
  } catch (error) {
    console.error('Error generate QR PNG:', error);
    res.status(500).send('Gagal membuat QR.');
  }
});

app.post('/dashboard/whatsapp/reset', auth.restrictTo('sekdes', 'kades'), async (req, res) => {
  try {
    await waBot.resetSession();
  } catch (e) {}
  res.redirect('/dashboard/whatsapp');
});

app.post('/dashboard/whatsapp/settings', auth.restrictTo('sekdes', 'kades'), async (req, res) => {
  try {
    const whatsapp = String(req.body.whatsapp || '').replace(/[^0-9]/g, '');
    const waRecipientsText = String(req.body.wa_recipients || '');

    const lines = waRecipientsText
      .split(/[\n,]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const list = [];
    for (const raw of lines) {
      let digits = String(raw).replace(/[^0-9]/g, '');
      if (!digits) continue;
      if (digits.startsWith('0')) digits = '62' + digits.slice(1);
      else if (digits.startsWith('8')) digits = '62' + digits;
      if (digits.length < 10 || digits.length > 15) continue;
      list.push(digits);
      if (list.length >= 10) break;
    }

    const unique = Array.from(new Set(list));

    await db.run('UPDATE pengaturan SET whatsapp = ?, wa_recipients = ? WHERE id = 1', [whatsapp, JSON.stringify(unique)]);
    res.redirect('/dashboard/whatsapp');
  } catch (error) {
    console.error('Error saat menyimpan nomor WhatsApp:', error);
    res.status(500).send('Kesalahan server.');
  }
});

// Handle error 404
app.use((req, res) => {
  res.status(404).send('Halaman tidak ditemukan - 404');
});

// Inisialisasi Database SQLite & nyalakan server Express
db.initDatabase()
  .then(() => {
    waBot.init().catch(() => {});
    app.listen(PORT, () => {
      console.log(`===========================================================`);
      console.log(`🚀 Aplikasi Desa Digital Ujunggebang Berjalan Lancar!`);
      console.log(`🌐 Buka di browser Anda: http://localhost:${PORT}`);
      console.log(`🛡️ Semua basis data SQL Relasional SQLite siap digunakan.`);
      console.log(`===========================================================`);
    });
  })
  .catch((err) => {
    console.error('❌ Gagal menginisialisasi basis data SQLite:', err);
    process.exit(1);
  });
