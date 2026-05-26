const bcrypt = require('bcryptjs');
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

// Render Halaman Login
const renderLogin = async (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    res.render('login', { error: null, success: null, settings });
  } catch (error) {
    console.error('Error saat merender login:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

// Proses Login
const processLogin = async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    if (!username || !password) {
      return res.render('login', { error: 'Username/NIK dan password wajib diisi.', success: null, settings });
    }

    // Ambil data user secara asinkron dari SQLite
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);

    if (!user) {
      return res.render('login', { error: 'Pengguna tidak ditemukan atau NIK belum terdaftar.', success: null, settings });
    }

    // Bandingkan password
    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Password salah.', success: null, settings });
    }

    // Set Session
    req.session.user = {
      username: user.username,
      role: user.role,
      nama: user.nama,
      nik: user.nik || null
    };

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error saat proses login:', error);
    res.status(500).send('Terjadi kesalahan server saat login.');
  }
};

// Halaman Registrasi Warga
const renderRegister = async (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    res.render('register', { error: null, success: null, settings });
  } catch (error) {
    console.error('Error saat merender registrasi:', error);
    res.status(500).send('Terjadi kesalahan server.');
  }
};

// Proses Registrasi Warga
const processRegister = async (req, res) => {
  const { nik, nama, no_hp, password, confirm_password } = req.body;

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    if (!nik || !nama || !no_hp || !password || !confirm_password) {
      return res.render('register', { error: 'Semua kolom wajib diisi.', settings });
    }

    if (password !== confirm_password) {
      return res.render('register', { error: 'Konfirmasi password tidak cocok.', settings });
    }

    // 1. Validasi: Periksa apakah NIK terdaftar sebagai penduduk Desa Ujunggebang di SQLite
    const wargaValid = await db.get('SELECT * FROM penduduk WHERE nik = ?', [nik.trim()]);
    if (!wargaValid) {
      return res.render('register', {
        error: 'NIK Anda tidak terdaftar sebagai penduduk Desa Ujunggebang. Silakan hubungi staff kantor desa untuk verifikasi data kependudukan Anda.',
        settings
      });
    }

    // 2. Validasi: Periksa kesesuaian Nama dengan NIK untuk keamanan tambahan
    if (wargaValid.nama.toLowerCase().trim() !== nama.toLowerCase().trim()) {
      return res.render('register', {
        error: 'Nama lengkap tidak sesuai dengan data NIK terdaftar. Masukkan nama sesuai KTP.',
        settings
      });
    }

    // 3. Validasi: Apakah NIK tersebut sudah mendaftar akun sebelumnya
    const userExist = await db.get('SELECT * FROM users WHERE username = ? OR nik = ?', [nik.trim(), nik.trim()]);
    if (userExist) {
      return res.render('register', {
        error: 'NIK ini sudah terdaftar sebagai akun warga. Silakan langsung login atau hubungi admin.',
        settings
      });
    }

    // 4. Daftarkan akun baru
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const normalizedHp = String(no_hp || '').replace(/[^0-9]/g, '');
    if (normalizedHp.length < 10 || normalizedHp.length > 15) {
      return res.render('register', { error: 'Nomor HP/WhatsApp tidak valid.', settings });
    }
    await db.run('UPDATE penduduk SET no_hp = ? WHERE nik = ?', [normalizedHp, nik.trim()]);

    await db.run(
      'INSERT INTO users (username, password, role, nik, nama) VALUES (?, ?, ?, ?, ?)',
      [nik.trim(), hashedPassword, 'warga', nik.trim(), wargaValid.nama]
    );

    res.render('login', {
      error: null,
      success: 'Registrasi berhasil! Silakan login menggunakan NIK dan password Anda.',
      settings
    });
  } catch (error) {
    console.error('Error saat registrasi warga:', error);
    res.status(500).send('Terjadi kesalahan server saat melakukan registrasi.');
  }
};

// Proses Logout
const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error saat logout:', err);
    }
    res.redirect('/login');
  });
};

module.exports = {
  renderLogin,
  processLogin,
  renderRegister,
  processRegister,
  logout
};
