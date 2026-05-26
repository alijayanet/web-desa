const db = require('./db');
const waBot = require('../services/waBot');

// Menghasilkan Kode Unik Laporan (misal: LAP-83A92B)
const generateLaporanCode = () => {
  const chars = '0123456789ABCDEF';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `LAP-${code}`;
};

// Halaman Laporan Warga Mandiri (Akses: Warga)
const renderPengaduanWarga = async (req, res) => {
  const { nik } = req.session.user;
  
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    const riwayat = await db.all('SELECT * FROM pengaduan WHERE nik = ? ORDER BY id DESC', [nik]);
    const kategoriList = await db.all('SELECT * FROM categories WHERE tipe = "pengaduan" ORDER BY nama ASC');

    res.render('dashboard/pengaduan-warga', {
      settings,
      user: req.session.user,
      riwayat,
      kategoriList,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Error saat memuat pengaduan warga:', error);
    res.status(500).send('Kesalahan server.');
  }
};
// Proses Pembuatan Pengaduan Baru oleh Warga
const createPengaduan = async (req, res) => {
  const { nik, nama } = req.session.user;
  const { judul, kategori, isi } = req.body;

  if (!judul || !kategori || !isi) {
    return res.redirect('/dashboard/pengaduan?error=missing_fields');
  }

  try {
    const newLaporan = {
      id: generateLaporanCode(),
      nik,
      nama,
      judul: judul.trim(),
      kategori,
      isi: isi.trim(),
      tanggal: new Date().toISOString().split('T')[0],
      status: 'Pending',
      tanggapan: '',
      tanggapan_oleh: '',
      tanggal_tanggapan: ''
    };

    await db.run(
      'INSERT INTO pengaduan VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newLaporan.id, newLaporan.nik, newLaporan.nama, newLaporan.judul, newLaporan.kategori, newLaporan.isi, newLaporan.tanggal, newLaporan.status, newLaporan.tanggapan, newLaporan.tanggapan_oleh, newLaporan.tanggal_tanggapan]
    );

    try {
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
      for (const phone of recipients) {
        await waBot.sendText(phone, `📣 Pengaduan baru\nNama: ${nama}\nNIK: ${nik}\nKategori: ${kategori}\nJudul: ${judul}\nIsi: ${isi}`);
      }
    } catch (e) {}

    res.redirect('/dashboard/pengaduan?success=submitted');
  } catch (error) {
    console.error('Error saat membuat pengaduan baru:', error);
    res.redirect('/dashboard/pengaduan?error=server_error');
  }
};

// Halaman Manajemen Pengaduan/Laporan Desa (Akses: Staff, Kades)
const renderPengaduanKelola = async (req, res) => {
  const { role } = req.session.user;

  if (role === 'warga') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    const daftarPengaduan = await db.all('SELECT * FROM pengaduan ORDER BY id DESC');

    res.render('dashboard/pengaduan-kelola', {
      settings,
      user: req.session.user,
      daftarPengaduan,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat kelola pengaduan:', error);
    res.status(500).send('Kesalahan server.');
  }
};
// Proses Tanggapan & Perubahan Status Pengaduan (Akses: Staff, Kades)
const updatePengaduanStatus = async (req, res) => {
  const { role, nama } = req.session.user;
  const { id, status, tanggapan } = req.body;

  if (role === 'warga') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  if (!id || !status) {
    return res.redirect('/dashboard/pengaduan/kelola?error=missing_fields');
  }

  try {
    const exist = await db.get('SELECT * FROM pengaduan WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/pengaduan/kelola?error=notfound');
    }

    const tanggapanOleh = `${nama} (${role.toUpperCase()})`;
    const tanggalTanggapan = new Date().toISOString().split('T')[0];

    await db.run(
      'UPDATE pengaduan SET status = ?, tanggapan = ?, tanggapan_oleh = ?, tanggal_tanggapan = ? WHERE id = ?',
      [status, tanggapan.trim(), tanggapanOleh, tanggalTanggapan, id]
    );

    res.redirect('/dashboard/pengaduan/kelola?success=updated');
  } catch (error) {
    console.error('Error saat update tanggapan pengaduan:', error);
    res.redirect('/dashboard/pengaduan/kelola?error=server_error');
  }
};

module.exports = {
  renderPengaduanWarga,
  createPengaduan,
  renderPengaduanKelola,
  updatePengaduanStatus
};
