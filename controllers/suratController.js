const db = require('./db');
const waBot = require('../services/waBot');

// Menghasilkan Kode Unik Surat (misal: SRT-83A92B)
const generateSuratCode = () => {
  const chars = '0123456789ABCDEF';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SRT-${code}`;
};

const normalizeTemplateId = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return normalized;
};

// Helper: Dapatkan nomor & isi surat ter-interpolasi secara default dari database templates
const getInitialLetterContent = async (suratId, jenisSurat, tanggalPengajuan, keterangan) => {
  try {
    const template = await db.get('SELECT * FROM templates WHERE nama_surat = ?', [jenisSurat]) 
      || await db.get('SELECT * FROM templates WHERE id = ?', ['domisili']) // Fallback
      || { nomor_kode: "470 / {CODE} / Kesra / {YEAR}", isi_surat: "Bahwa nama tersebut di atas benar-benar penduduk Desa Ujunggebang yang berdomisili di alamat tersebut." };

    const codePart = suratId.split('-')[1] || suratId;
    const yearPart = new Date(tanggalPengajuan).getFullYear();
    const nomorSurat = template.nomor_kode
      .replace(/{CODE}/g, codePart)
      .replace(/{YEAR}/g, yearPart);

    let isiHtml = template.isi_surat;
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
  } catch (err) {
    console.error('Error generating initial letter content:', err);
    return {
      nomorSurat: `470 / ${suratId.split('-')[1] || suratId} / Kesra / ${new Date(tanggalPengajuan).getFullYear()}`,
      isiHtml: "Bahwa nama tersebut di atas benar-benar penduduk Desa Ujunggebang yang berdomisili di alamat tersebut."
    };
  }
};

// Render Halaman Riwayat & Pengajuan Surat Warga (Akses: Warga)
const renderSuratWarga = async (req, res) => {
  const { nik } = req.session.user;
  
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    let riwayat = await db.all('SELECT * FROM surat WHERE nik = ? ORDER BY id DESC', [nik]);
    const templates = await db.all('SELECT * FROM templates ORDER BY nama_surat ASC');

    // Parse kolom keterangan dari JSON String
    riwayat = riwayat.map((s) => {
      if (s.keterangan) {
        try {
          s.keterangan = JSON.parse(s.keterangan);
        } catch (e) {
          console.error('Error parsing keterangan surat:', e);
        }
      }
      return s;
    });

    res.render('dashboard/surat-warga', {
      settings,
      user: req.session.user,
      riwayat,
      templates,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Error saat merender surat warga:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Proses Pengajuan Surat Baru oleh Warga
const createSuratRequest = async (req, res) => {
  const { nik, nama } = req.session.user;
  const { jenis_surat, keperluan, nama_usaha, jenis_usaha, alamat_usaha, nama_bayi, nama_ibu, nama_jenazah, tanggal_kematian, hubungan } = req.body;
  
  try {
    const keterangan = { keperluan };

    if (jenis_surat === 'Surat Keterangan Usaha (SKU)' || jenis_surat === 'Surat Keterangan Domisili Usaha') {
      keterangan.nama_usaha = nama_usaha;
      keterangan.jenis_usaha = jenis_usaha;
      keterangan.alamat_usaha = alamat_usaha;
    } else if (jenis_surat === 'Surat Keterangan Kelahiran') {
      keterangan.nama_bayi = nama_bayi;
      keterangan.nama_ibu = nama_ibu;
      keterangan.hubungan = hubungan || 'Anak Kandung';
    } else if (jenis_surat === 'Surat Keterangan Perbedaan Nama') {
      keterangan.nama_bayi = nama_bayi;
      keterangan.nama_ibu = nama_ibu;
    } else if (jenis_surat === 'Surat Keterangan Kematian') {
      keterangan.nama_jenazah = nama_jenazah;
      keterangan.tanggal_kematian = tanggal_kematian;
      keterangan.hubungan = hubungan || 'Keluarga';
    }

    const newRequest = {
      id: generateSuratCode(),
      nik,
      nama,
      jenis_surat,
      tanggal_pengajuan: new Date().toISOString().split('T')[0],
      status: 'Menunggu Verifikasi Staff',
      catatan: '',
      keterangan: JSON.stringify(keterangan) // Simpan sebagai JSON String relasional
    };

    // Pra-render isi & nomor surat pertama kali untuk disimpan secara fisik di database
    const { nomorSurat, isiHtml } = await getInitialLetterContent(newRequest.id, newRequest.jenis_surat, newRequest.tanggal_pengajuan, keterangan);

    await db.run(
      'INSERT INTO surat (id, nik, nama, jenis_surat, tanggal_pengajuan, status, catatan, keterangan, nomor_surat, isi_surat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newRequest.id, newRequest.nik, newRequest.nama, newRequest.jenis_surat, newRequest.tanggal_pengajuan, newRequest.status, newRequest.catatan, newRequest.keterangan, nomorSurat, isiHtml]
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
        await waBot.sendText(phone, `📩 Pengajuan surat baru\nNama: ${nama}\nNIK: ${nik}\nJenis: ${jenis_surat}\nKeperluan: ${keperluan || '-'}`);
      }
    } catch (e) {}

    res.redirect('/dashboard/surat?success=requested');
  } catch (error) {
    console.error('Error saat pengajuan surat baru:', error);
    res.redirect('/dashboard/surat?error=server_error');
  }
};

// Render Halaman Pengelolaan & Approval Surat (Akses: Staff, Sekdes, Kades)
const renderSuratKelola = async (req, res) => {
  const { role } = req.session.user;
  
  if (role === 'warga') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    const daftarSurat = await db.all('SELECT * FROM surat ORDER BY id DESC');
    const templates = await db.all('SELECT * FROM templates ORDER BY nama_surat ASC');
    
    // Ambil seluruh daftar penduduk untuk pembuatan surat manual/offline
    const penduduk = await db.all('SELECT nik, nama FROM penduduk ORDER BY nama ASC');

    res.render('dashboard/surat-kelola', {
      settings,
      user: req.session.user,
      daftarSurat,
      penduduk,
      templates,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat kelola surat:', error);
    res.status(500).send('Kesalahan server.');
  }
};
// Proses Approval/Update Status Surat (Akses: Staff, Sekdes, Kades)
const updateSuratStatus = async (req, res) => {
  const { role } = req.session.user;
  const { id, status, catatan } = req.body;

  if (role === 'warga') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const exist = await db.get('SELECT * FROM surat WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/surat/kelola?error=notfound');
    }

    await db.run(
      'UPDATE surat SET status = ?, catatan = ? WHERE id = ?',
      [status, catatan ? catatan.trim() : '', id]
    );

    try {
      if (status === 'Disetujui' || status === 'Ditolak') {
        const jids = await db.all('SELECT jid FROM wa_links WHERE nik = ? ORDER BY linked_at DESC', [exist.nik]);
        const base = String(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/g, '');
        const cetakLink = base ? `${base}/dashboard/surat/cetak/${id}` : `/dashboard/surat/cetak/${id}`;
        const loginLink = base ? `${base}/login` : '/login';

        const text =
          status === 'Disetujui'
            ? `✅ Pengajuan surat Anda sudah disetujui.\nID: ${id}\nJenis: ${exist.jenis_surat}\nSilakan cetak: ${cetakLink}\nJika diminta login: ${loginLink}`
            : `❌ Pengajuan surat Anda ditolak.\nID: ${id}\nJenis: ${exist.jenis_surat}\nCatatan: ${(catatan ? catatan.trim() : exist.catatan) || '-'}\nInfo: ${loginLink}`;

        for (const row of jids) {
          if (row && row.jid) {
            await waBot.sendJid(row.jid, text);
          }
        }
      }
    } catch (e) {}

    res.redirect('/dashboard/surat/kelola?success=status_updated');
  } catch (error) {
    console.error('Error saat update status surat:', error);
    res.redirect('/dashboard/surat/kelola?error=server_error');
  }
};

// Render Template Cetak Surat Resmi (Akses: Warga, Staff, Sekdes, Kades)
const renderCetakSurat = async (req, res) => {
  const { id } = req.params;
  
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    const allTemplates = await db.all('SELECT * FROM templates');
    const surat = await db.get('SELECT * FROM surat WHERE id = ?', [id]);

    if (!surat) {
      return res.status(404).send('Surat tidak ditemukan.');
    }

    // Pastikan warga hanya bisa mencetak surat miliknya sendiri
    if (req.session.user.role === 'warga' && req.session.user.nik !== surat.nik) {
      return res.redirect('/dashboard?error=unauthorized');
    }

    // Ambil detail kependudukan pemohon dari SQLite
    const pemohon = await db.get('SELECT * FROM penduduk WHERE nik = ?', [surat.nik]);
    if (!pemohon) {
      return res.status(404).send('Data kependudukan pemohon tidak ditemukan.');
    }

    // Parse keterangan JSON
    if (surat.keterangan) {
      try {
        surat.keterangan = JSON.parse(surat.keterangan);
      } catch (e) {
        console.error('Error parsing JSON keterangan:', e);
      }
    }

    // Cari template surat yang sesuai
    let template = allTemplates.find((t) => t.nama_surat === surat.jenis_surat);
    if (!template) {
      template = {
        nomor_kode: "470 / {CODE} / Kesra / {YEAR}",
        isi_surat: "Bahwa nama tersebut di atas benar-benar penduduk Desa Ujunggebang yang berdomisili di alamat tersebut."
      };
    }

    // Gunakan nomor & isi surat fisik dari database jika tersedia (mencegah overwrite hasil edit manual),
    // jika kosong barulah lakukan interpolasi dinamis
    const codePart = surat.id.split('-')[1];
    const yearPart = new Date(surat.tanggal_pengajuan).getFullYear();
    
    const nomorSurat = surat.nomor_surat || template.nomor_kode
      .replace(/{CODE}/g, codePart)
      .replace(/{YEAR}/g, yearPart);

    let isiHtml = surat.isi_surat || template.isi_surat;
    if (!surat.isi_surat) {
      if (surat.keterangan) {
        isiHtml = isiHtml.replace(/{keperluan}/g, `<strong>${surat.keterangan.keperluan || ''}</strong>`);
        isiHtml = isiHtml.replace(/{nama_usaha}/g, `<strong>${surat.keterangan.nama_usaha || ''}</strong>`);
        isiHtml = isiHtml.replace(/{jenis_usaha}/g, `<strong>${surat.keterangan.jenis_usaha || ''}</strong>`);
        isiHtml = isiHtml.replace(/{alamat_usaha}/g, `<strong>${surat.keterangan.alamat_usaha || ''}</strong>`);
        isiHtml = isiHtml.replace(/{nama_bayi}/g, `<strong>${surat.keterangan.nama_bayi || ''}</strong>`);
        isiHtml = isiHtml.replace(/{nama_ibu}/g, `<strong>${surat.keterangan.nama_ibu || ''}</strong>`);
        isiHtml = isiHtml.replace(/{nama_jenazah}/g, `<strong>${surat.keterangan.nama_jenazah || ''}</strong>`);
        
        // Parse tanggal kematian jika ada
        if (surat.keterangan.tanggal_kematian) {
          const formattedDate = new Date(surat.keterangan.tanggal_kematian).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
          isiHtml = isiHtml.replace(/{tanggal_kematian}/g, `<strong>${formattedDate}</strong>`);
        }
      }
    }

    res.render('dashboard/cetak-surat', {
      settings,
      surat,
      pemohon,
      nomorSurat,
      isiHtml
    });
  } catch (error) {
    console.error('Error saat merender cetak surat:', error);
    res.status(500).send('Kesalahan server saat memuat format cetak.');
  }
};

// ==========================================
// MANAJEMEN TEMPLATE SURAT (Akses: Sekdes, Kades)
// ==========================================

// Render Halaman Kelola Template Surat
const renderTemplates = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    const templates = await db.all('SELECT * FROM templates ORDER BY id ASC');

    res.render('dashboard/templates', {
      settings,
      user: req.session.user,
      templates,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat memuat template surat:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Update/Edit Template Surat
const editTemplate = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id, nomor_kode, isi_surat } = req.body;
  
  try {
    const exist = await db.get('SELECT * FROM templates WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/templates?error=notfound');
    }

    await db.run(
      'UPDATE templates SET nomor_kode = ?, isi_surat = ? WHERE id = ?',
      [nomor_kode.trim(), isi_surat.trim(), id]
    );

    res.redirect('/dashboard/templates?success=saved');
  } catch (error) {
    console.error('Error saat mengedit template surat:', error);
    res.redirect('/dashboard/templates?error=server_error');
  }
};

// Tambah Template Surat Baru (Akses: Sekdes, Kades)
const addTemplate = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id, nama_surat, nomor_kode, isi_surat } = req.body;
  if (!nama_surat || !nomor_kode || !isi_surat) {
    return res.redirect('/dashboard/templates?error=missing_fields');
  }

  const templateId = normalizeTemplateId(id || nama_surat);
  if (!templateId) {
    return res.redirect('/dashboard/templates?error=invalid_id');
  }

  try {
    const exist = await db.get('SELECT * FROM templates WHERE id = ? OR nama_surat = ?', [templateId, nama_surat.trim()]);
    if (exist) {
      return res.redirect('/dashboard/templates?error=already_exists');
    }

    await db.run(
      'INSERT INTO templates (id, nama_surat, nomor_kode, isi_surat) VALUES (?, ?, ?, ?)',
      [templateId, nama_surat.trim(), nomor_kode.trim(), isi_surat.trim()]
    );

    res.redirect('/dashboard/templates?success=created');
  } catch (error) {
    console.error('Error saat menambah template surat:', error);
    res.redirect('/dashboard/templates?error=server_error');
  }
};

// Proses Pembuatan Surat Manual (Offline) oleh Staff / Sekdes
const createSuratManual = async (req, res) => {
  const { role } = req.session.user;
  
  if (role === 'warga') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { nik, jenis_surat, keperluan, nama_usaha, jenis_usaha, alamat_usaha, nama_bayi, nama_ibu, nama_jenazah, tanggal_kematian, hubungan } = req.body;
  
  if (!nik || !jenis_surat || !keperluan) {
    return res.redirect('/dashboard/surat/kelola?error=missing_fields');
  }

  try {
    // Ambil nama penduduk berdasarkan NIK
    const pemohon = await db.get('SELECT nama FROM penduduk WHERE nik = ?', [nik]);
    if (!pemohon) {
      return res.redirect('/dashboard/surat/kelola?error=nik_not_found');
    }

    const keterangan = { keperluan };

    if (jenis_surat === 'Surat Keterangan Usaha (SKU)' || jenis_surat === 'Surat Keterangan Domisili Usaha') {
      keterangan.nama_usaha = nama_usaha;
      keterangan.jenis_usaha = jenis_usaha;
      keterangan.alamat_usaha = alamat_usaha;
    } else if (jenis_surat === 'Surat Keterangan Kelahiran') {
      keterangan.nama_bayi = nama_bayi;
      keterangan.nama_ibu = nama_ibu;
      keterangan.hubungan = hubungan || 'Anak Kandung';
    } else if (jenis_surat === 'Surat Keterangan Perbedaan Nama') {
      keterangan.nama_bayi = nama_bayi;
      keterangan.nama_ibu = nama_ibu;
    } else if (jenis_surat === 'Surat Keterangan Kematian') {
      keterangan.nama_jenazah = nama_jenazah;
      keterangan.tanggal_kematian = tanggal_kematian;
      keterangan.hubungan = hubungan || 'Keluarga';
    }

    const newRequest = {
      id: generateSuratCode(),
      nik,
      nama: pemohon.nama,
      jenis_surat,
      tanggal_pengajuan: new Date().toISOString().split('T')[0],
      // Mengingat di-input fisik/offline oleh staff di kantor, status diset langsung 'Diverifikasi Sekdes'
      // agar Sekdes atau Kades dapat memprosesnya langsung tanpa antrean staff ganda.
      status: 'Diverifikasi Sekdes',
      catatan: 'Dokumen di-input secara manual/offline oleh Staff Pelayanan.',
      keterangan: JSON.stringify(keterangan)
    };

    // Pra-render isi & nomor surat pertama kali untuk disimpan secara fisik di database
    const { nomorSurat, isiHtml } = await getInitialLetterContent(newRequest.id, newRequest.jenis_surat, newRequest.tanggal_pengajuan, keterangan);

    await db.run(
      'INSERT INTO surat (id, nik, nama, jenis_surat, tanggal_pengajuan, status, catatan, keterangan, nomor_surat, isi_surat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newRequest.id, newRequest.nik, newRequest.nama, newRequest.jenis_surat, newRequest.tanggal_pengajuan, newRequest.status, newRequest.catatan, newRequest.keterangan, nomorSurat, isiHtml]
    );

    res.redirect('/dashboard/surat/kelola?success=manual_created');
  } catch (error) {
    console.error('Error saat membuat surat manual:', error);
    res.redirect('/dashboard/surat/kelola?error=server_error');
  }
};

// Proses Edit Isi/Nomor Surat Fisik yang Tersimpan di Database (Akses: Staff, Sekdes, Kades)
const editSuratContent = async (req, res) => {
  const { role } = req.session.user;
  if (role === 'warga') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id, nomor_surat, isi_surat } = req.body;

  if (!id || !nomor_surat || !isi_surat) {
    return res.redirect('/dashboard/surat/kelola?error=missing_fields');
  }

  try {
    const exist = await db.get('SELECT * FROM surat WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/surat/kelola?error=notfound');
    }

    await db.run(
      'UPDATE surat SET nomor_surat = ?, isi_surat = ? WHERE id = ?',
      [nomor_surat.trim(), isi_surat.trim(), id]
    );

    res.redirect('/dashboard/surat/kelola?success=content_updated');
  } catch (error) {
    console.error('Error saat mengedit isi surat disimpan:', error);
    res.redirect('/dashboard/surat/kelola?error=server_error');
  }
};

module.exports = {
  renderSuratWarga,
  createSuratRequest,
  renderSuratKelola,
  updateSuratStatus,
  renderCetakSurat,
  renderTemplates,
  editTemplate,
  addTemplate,
  createSuratManual,
  editSuratContent
};
