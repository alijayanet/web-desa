const db = require('./db');

const normalizeSettings = (settings) => {
  if (!settings) return settings;
  if (settings.misi) {
    try {
      settings.misi = JSON.parse(settings.misi);
    } catch (e) {
      settings.misi = [];
    }
  }
  if (settings.nav_links) {
    try {
      settings.nav_links = JSON.parse(settings.nav_links);
    } catch (e) {
      settings.nav_links = [];
    }
  } else {
    settings.nav_links = [];
  }
  if (settings.struktur_organisasi) {
    try {
      settings.struktur_organisasi = JSON.parse(settings.struktur_organisasi);
    } catch (e) {
      settings.struktur_organisasi = [];
    }
  } else {
    settings.struktur_organisasi = [];
  }
  return settings;
};

// Render Halaman Beranda Publik
const renderHome = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    // Ambil 3 berita terbaru secara asinkron
    const beritaTerbaru = await db.all('SELECT * FROM berita ORDER BY tanggal DESC LIMIT 3');

    // Hitung statistik menggunakan query SQL asli
    const countPenduduk = await db.get('SELECT COUNT(*) AS total FROM penduduk');
    const countSurat = await db.get('SELECT COUNT(*) AS total FROM surat WHERE status = "Disetujui"');
    const countPengaduan = await db.get('SELECT COUNT(*) AS total FROM pengaduan WHERE status = "Selesai"');
    const countDusun = await db.get('SELECT COUNT(DISTINCT dusun) AS total FROM penduduk');

    const statistik = {
      penduduk: countPenduduk.total || 0,
      suratSelesai: countSurat.total || 0,
      pengaduanSelesai: countPengaduan.total || 0,
      dusun: countDusun.total || 3
    };

    res.render('index', {
      settings,
      berita: beritaTerbaru,
      statistik,
      user: req.session.user || null
    });
  } catch (error) {
    console.error('Error saat merender beranda publik:', error);
    res.status(500).send('Terjadi kesalahan server saat memuat beranda.');
  }
};

// Render Halaman Profil Desa
const renderProfil = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    
    res.render('profil', {
      settings,
      user: req.session.user || null
    });
  } catch (error) {
    console.error('Error saat merender profil desa:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

// Render Halaman Daftar Berita
const renderBerita = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    const berita = await db.all('SELECT * FROM berita ORDER BY tanggal DESC');

    res.render('berita', {
      settings,
      berita,
      user: req.session.user || null
    });
  } catch (error) {
    console.error('Error saat merender daftar berita:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

// Render Halaman Detail Berita
const renderDetailBerita = async (req, res) => {
  const { id } = req.params;
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    const berita = await db.get('SELECT * FROM berita WHERE id = ?', [id]);

    if (!berita) {
      return res.status(404).send('Berita tidak ditemukan');
    }

    res.render('detail-berita', {
      settings,
      berita,
      user: req.session.user || null
    });
  } catch (error) {
    console.error('Error saat merender detail berita:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

// Render Halaman Keuangan Publik (APBDes)
const renderKeuangan = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    // Ambil data APBDes tahun terbaru dari SQLite (dinamis)
    const latestYear = await db.get('SELECT MAX(tahun) as tahun FROM keuangan');
    const tahun = (latestYear && latestYear.tahun) ? latestYear.tahun : new Date().getFullYear();
    const keuangan = await db.all('SELECT * FROM keuangan WHERE tahun = ?', [tahun]);

    res.render('keuangan', {
      settings,
      keuangan,
      tahun,
      user: req.session.user || null
    });
  } catch (error) {
    console.error('Error saat merender keuangan publik:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

const renderAbsensi = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    const tanggal = String(req.query.tanggal || new Date().toISOString().split('T')[0]);
    const pegawai = await db.all('SELECT username, nama, role FROM users WHERE role != "warga" ORDER BY role ASC, nama ASC');

    const summary = [];
    for (const p of pegawai) {
      const masuk = await db.get(
        'SELECT waktu, foto FROM absensi WHERE username = ? AND tanggal = ? AND jenis = "masuk" ORDER BY waktu ASC LIMIT 1',
        [p.username, tanggal]
      );
      const pulang = await db.get(
        'SELECT waktu, foto FROM absensi WHERE username = ? AND tanggal = ? AND jenis = "pulang" ORDER BY waktu DESC LIMIT 1',
        [p.username, tanggal]
      );
      summary.push({
        username: p.username,
        nama: p.nama,
        role: p.role,
        masuk_waktu: masuk ? masuk.waktu : null,
        masuk_foto: masuk ? masuk.foto : null,
        pulang_waktu: pulang ? pulang.waktu : null,
        pulang_foto: pulang ? pulang.foto : null
      });
    }

    const logs = await db.all(
      'SELECT * FROM absensi WHERE tanggal = ? ORDER BY waktu DESC LIMIT 300',
      [tanggal]
    );

    res.render('absensi', {
      settings,
      user: req.session.user || null,
      tanggal,
      summary,
      logs
    });
  } catch (error) {
    console.error('Error saat merender absensi publik:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

module.exports = {
  renderHome,
  renderProfil,
  renderBerita,
  renderDetailBerita,
  renderKeuangan,
  renderAbsensi
};
