const db = require('./db');
const bcrypt = require('bcryptjs');

const normalizeSettings = (settings) => {
  if (!settings) return settings;
  if (settings.misi) {
    try {
      settings.misi = JSON.parse(settings.misi);
    } catch (e) {
      settings.misi = [];
    }
  }
  if (settings.wa_recipients) {
    try {
      settings.wa_recipients = JSON.parse(settings.wa_recipients);
    } catch (e) {
      settings.wa_recipients = [];
    }
  } else {
    settings.wa_recipients = [];
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

const parseNavLinksText = (text) => {
  if (!text) return [];
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results = [];
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim()).filter((p) => p.length > 0);
    let label = '';
    let url = '';
    if (parts.length === 1) {
      url = parts[0];
      label = parts[0];
    } else {
      label = parts[0];
      url = parts.slice(1).join('|');
    }

    if (!/^https?:\/\//i.test(url)) continue;
    results.push({ label: label.slice(0, 32), url: url.slice(0, 2048) });
    if (results.length >= 10) break;
  }

  return results;
};

const parseStrukturOrganisasiText = (text) => {
  if (!text) return [];
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results = [];
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length < 2) continue;
    const jabatan = parts[0].slice(0, 64);
    const nama = parts.slice(1).join('|').slice(0, 64);
    if (!jabatan || !nama) continue;
    results.push({ jabatan, nama });
    if (results.length >= 20) break;
  }

  return results;
};

const parseWaRecipientsText = (text) => {
  if (!text) return [];
  const lines = String(text)
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const results = [];
  for (const raw of lines) {
    let digits = String(raw).replace(/[^0-9]/g, '');
    if (!digits) continue;
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    else if (digits.startsWith('8')) digits = '62' + digits;
    if (digits.length < 10 || digits.length > 15) continue;
    results.push(digits);
    if (results.length >= 10) break;
  }

  return Array.from(new Set(results));
};

const syncLeadershipFromUsers = async () => {
  const current = await db.get('SELECT kades, sekdes FROM pengaturan WHERE id = 1');
  const kadesUser = await db.get('SELECT nama FROM users WHERE role = ? ORDER BY username ASC LIMIT 1', ['kades']);
  const sekdesUser = await db.get('SELECT nama FROM users WHERE role = ? ORDER BY username ASC LIMIT 1', ['sekdes']);
  const kadesName = (kadesUser && kadesUser.nama ? String(kadesUser.nama).trim() : '') || (current && current.kades ? String(current.kades).trim() : '');
  const sekdesName = (sekdesUser && sekdesUser.nama ? String(sekdesUser.nama).trim() : '') || (current && current.sekdes ? String(current.sekdes).trim() : '');
  await db.run('UPDATE pengaturan SET kades = ?, sekdes = ? WHERE id = 1', [kadesName, sekdesName]);
};

// Render Dashboard Utama berdasarkan Role dengan SQL
const renderDashboard = async (req, res) => {
  const { role, nik, username } = req.session.user;
  
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    let stats = {};
    let recentSurat = [];
    let recentPengaduan = [];

    const queryError = req.query.error;
    const errorMsg = queryError === 'unauthorized' ? 'Anda tidak memiliki hak akses untuk membuka halaman tersebut.' : null;

    if (role === 'warga') {
      // Statistik khusus warga bersangkutan menggunakan query SQL
      const countSurat = await db.get('SELECT COUNT(*) as total FROM surat WHERE nik = ?', [nik]);
      const countPending = await db.get('SELECT COUNT(*) as total FROM surat WHERE nik = ? AND status != "Disetujui" AND status != "Ditolak"', [nik]);
      const countSelesai = await db.get('SELECT COUNT(*) as total FROM surat WHERE nik = ? AND status = "Disetujui"', [nik]);
      
      const countPengaduan = await db.get('SELECT COUNT(*) as total FROM pengaduan WHERE nik = ?', [nik]);
      const countPengaduanAktif = await db.get('SELECT COUNT(*) as total FROM pengaduan WHERE nik = ? AND status != "Selesai"', [nik]);
      const countPengaduanSelesai = await db.get('SELECT COUNT(*) as total FROM pengaduan WHERE nik = ? AND status = "Selesai"', [nik]);

      stats = {
        totalSurat: countSurat.total || 0,
        suratPending: countPending.total || 0,
        suratSelesai: countSelesai.total || 0,
        totalPengaduan: countPengaduan.total || 0,
        pengaduanAktif: countPengaduanAktif.total || 0,
        pengaduanSelesai: countPengaduanSelesai.total || 0
      };

      recentSurat = await db.all('SELECT * FROM surat WHERE nik = ? ORDER BY id DESC LIMIT 5', [nik]);
      recentPengaduan = await db.all('SELECT * FROM pengaduan WHERE nik = ? ORDER BY id DESC LIMIT 5', [nik]);

    } else {
      // Statistik untuk Staff, Sekdes, dan Kades (Kumulatif)
      const countPenduduk = await db.get('SELECT COUNT(*) as total FROM penduduk');
      const countLaki = await db.get('SELECT COUNT(*) as total FROM penduduk WHERE gender = "Laki-laki"');
      const countPerempuan = await db.get('SELECT COUNT(*) as total FROM penduduk WHERE gender = "Perempuan"');
      
      const countSurat = await db.get('SELECT COUNT(*) as total FROM surat');
      const countPendingStaff = await db.get('SELECT COUNT(*) as total FROM surat WHERE status = "Menunggu Verifikasi Staff"');
      const countPendingSekdes = await db.get('SELECT COUNT(*) as total FROM surat WHERE status = "Diverifikasi Sekdes"');
      const countPendingKades = await db.get('SELECT COUNT(*) as total FROM surat WHERE status = "Disetujui Sekdes, Menunggu TTD Kades"');
      const countSuratSelesai = await db.get('SELECT COUNT(*) as total FROM surat WHERE status = "Disetujui"');

      const countPengaduan = await db.get('SELECT COUNT(*) as total FROM pengaduan');
      const countPengaduanPending = await db.get('SELECT COUNT(*) as total FROM pengaduan WHERE status = "Pending"');
      const countPengaduanDiproses = await db.get('SELECT COUNT(*) as total FROM pengaduan WHERE status = "Diproses"');
      const countPengaduanSelesai = await db.get('SELECT COUNT(*) as total FROM pengaduan WHERE status = "Selesai"');

      stats = {
        totalPenduduk: countPenduduk.total || 0,
        pendudukLaki: countLaki.total || 0,
        pendudukPerempuan: countPerempuan.total || 0,
        
        totalSurat: countSurat.total || 0,
        suratPendingStaff: countPendingStaff.total || 0,
        suratPendingSekdes: countPendingSekdes.total || 0,
        suratPendingKades: countPendingKades.total || 0,
        suratSelesai: countSuratSelesai.total || 0,

        totalPengaduan: countPengaduan.total || 0,
        pengaduanPending: countPengaduanPending.total || 0,
        pengaduanDiproses: countPengaduanDiproses.total || 0,
        pengaduanSelesai: countPengaduanSelesai.total || 0
      };

      recentSurat = await db.all('SELECT * FROM surat ORDER BY id DESC LIMIT 5');
      recentPengaduan = await db.all('SELECT * FROM pengaduan ORDER BY id DESC LIMIT 5');
    }

    // Melakukan parse data JSON keterangan pada riwayat surat
    recentSurat = recentSurat.map((s) => {
      if (s.keterangan) {
        try {
          s.keterangan = JSON.parse(s.keterangan);
        } catch (e) {
          console.error('Error parse keterangan surat:', e);
        }
      }
      return s;
    });

    res.render('dashboard/index', {
      settings,
      user: req.session.user,
      stats,
      recentSurat,
      recentPengaduan,
      error: errorMsg,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Error saat merender dashboard:', error);
    res.status(500).send('Terjadi kesalahan server saat memuat dashboard.');
  }
};

// Render Halaman Profil Mandiri Warga
const renderProfilSaya = async (req, res) => {
  const { role, nik } = req.session.user;
  
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    if (role !== 'warga') {
      return res.redirect('/dashboard?error=unauthorized');
    }

    const profil = await db.get('SELECT * FROM penduduk WHERE nik = ?', [nik]);

    res.render('dashboard/profil-saya', {
      settings,
      user: req.session.user,
      profil
    });
  } catch (error) {
    console.error('Error saat memuat profil warga:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Render Halaman Manajemen Penduduk (Staff, Sekdes)
const renderPenduduk = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    const allPenduduk = await db.all('SELECT * FROM penduduk ORDER BY nama ASC');
    
    res.render('dashboard/penduduk', {
      settings,
      user: req.session.user,
      penduduk: allPenduduk,
      error: req.query.error || null,
      success: req.query.success || null,
      inserted: req.query.inserted || null,
      updated: req.query.updated || null,
      skipped: req.query.skipped || null
    });
  } catch (error) {
    console.error('Error saat memuat data kependudukan:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Tambah Data Penduduk
const addPenduduk = async (req, res) => {
  const { nik, nama, no_kk, tempat_lahir, tanggal_lahir, gender, alamat, dusun, agama, status_kawin, pekerjaan, pendidikan, no_hp } = req.body;

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    
    // Cek apakah NIK sudah terdaftar
    const exist = await db.get('SELECT * FROM penduduk WHERE nik = ?', [nik.trim()]);
    if (exist) {
      const allPenduduk = await db.all('SELECT * FROM penduduk ORDER BY nama ASC');
      return res.render('dashboard/penduduk', {
        settings,
        user: req.session.user,
        penduduk: allPenduduk,
        error: 'NIK ini sudah terdaftar dalam sistem.',
        success: null
      });
    }

    await db.run(
      'INSERT INTO penduduk (nik, nama, no_kk, tempat_lahir, tanggal_lahir, gender, alamat, dusun, agama, status_kawin, pekerjaan, pendidikan, no_hp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        nik.trim(),
        nama.trim(),
        no_kk.trim(),
        tempat_lahir.trim(),
        tanggal_lahir,
        gender,
        alamat.trim(),
        dusun,
        agama,
        status_kawin,
        pekerjaan.trim(),
        pendidikan,
        String(no_hp || '').replace(/[^0-9]/g, '')
      ]
    );

    res.redirect('/dashboard/penduduk?success=created');
  } catch (error) {
    console.error('Error saat menambah penduduk:', error);
    res.redirect('/dashboard/penduduk?error=server_error');
  }
};

// Edit Data Penduduk
const editPenduduk = async (req, res) => {
  const { old_nik, nik, nama, no_kk, tempat_lahir, tanggal_lahir, gender, alamat, dusun, agama, status_kawin, pekerjaan, pendidikan, no_hp } = req.body;

  try {
    const exist = await db.get('SELECT * FROM penduduk WHERE nik = ?', [old_nik]);
    if (!exist) {
      return res.redirect('/dashboard/penduduk?error=notfound');
    }

    const normalizedNoHp = (no_hp == null ? (exist.no_hp || '') : String(no_hp)).replace(/[^0-9]/g, '');

    await db.run(
      `UPDATE penduduk 
       SET nik = ?, nama = ?, no_kk = ?, tempat_lahir = ?, tanggal_lahir = ?, gender = ?, alamat = ?, dusun = ?, agama = ?, status_kawin = ?, pekerjaan = ?, pendidikan = ?, no_hp = ? 
       WHERE nik = ?`,
      [nik.trim(), nama.trim(), no_kk.trim(), tempat_lahir.trim(), tanggal_lahir, gender, alamat.trim(), dusun, agama, status_kawin, pekerjaan.trim(), pendidikan, normalizedNoHp, old_nik]
    );

    res.redirect('/dashboard/penduduk?success=updated');
  } catch (error) {
    console.error('Error saat mengedit data penduduk:', error);
    res.redirect('/dashboard/penduduk?error=server_error');
  }
};

// Hapus Data Penduduk
const deletePenduduk = async (req, res) => {
  const { nik } = req.params;

  try {
    const exist = await db.get('SELECT * FROM penduduk WHERE nik = ?', [nik]);
    if (!exist) {
      return res.redirect('/dashboard/penduduk?error=notfound');
    }

    // Hapus penduduk (Foreign Key Cascade akan menghapus akun user Warga yang terhubung NIK secara otomatis!)
    await db.run('DELETE FROM penduduk WHERE nik = ?', [nik]);

    res.redirect('/dashboard/penduduk?success=deleted');
  } catch (error) {
    console.error('Error saat menghapus penduduk:', error);
    res.redirect('/dashboard/penduduk?error=server_error');
  }
};

const csvEscape = (value) => {
  const s = String(value == null ? '' : value);
  if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const pickDelimiter = (headerLine) => {
  const line = String(headerLine || '');
  const comma = (line.match(/,/g) || []).length;
  const semi = (line.match(/;/g) || []).length;
  return semi > comma ? ';' : ',';
};

const parseCsv = (text, delimiter) => {
  const rows = [];
  const s = String(text || '');
  const sep = delimiter === ';' ? ';' : ',';
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    if (ch === sep) {
      pushField();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  pushField();
  pushRow();
  return rows.filter((r) => r.some((c) => String(c || '').trim().length > 0));
};

const normalizeHeaderKey = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

const parseDateToIso = (value) => {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return s;
};

const exportPendudukCsv = async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM penduduk ORDER BY nama ASC');
    const headers = [
      'nik',
      'nama',
      'no_kk',
      'tempat_lahir',
      'tanggal_lahir',
      'gender',
      'alamat',
      'dusun',
      'agama',
      'status_kawin',
      'pekerjaan',
      'pendidikan',
      'no_hp'
    ];
    const lines = [];
    lines.push(headers.join(','));
    for (const r of rows) {
      const values = headers.map((h) => csvEscape(r && r[h] != null ? r[h] : ''));
      lines.push(values.join(','));
    }
    const csv = '\ufeff' + lines.join('\n');
    const tanggal = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="penduduk-${tanggal}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error export penduduk:', error);
    res.redirect('/dashboard/penduduk?error=export_failed');
  }
};

const importPendudukCsv = async (req, res) => {
  if (!req.file || !req.file.buffer) return res.redirect('/dashboard/penduduk?error=import_file_required');
  try {
    const raw = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = raw.split(/\r?\n/, 1)[0] || '';
    const delimiter = pickDelimiter(firstLine);
    const rows = parseCsv(raw, delimiter);
    if (!rows.length) return res.redirect('/dashboard/penduduk?error=import_empty');

    const header = rows[0].map((h) => normalizeHeaderKey(h));
    const idx = {};
    header.forEach((h, i) => {
      if (h && idx[h] === undefined) idx[h] = i;
    });
    if (idx.nik === undefined || idx.nama === undefined) {
      return res.redirect('/dashboard/penduduk?error=import_missing_headers');
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const maxRows = 5000;
    const dataRows = rows.slice(1, 1 + maxRows);

    await db.run('BEGIN');
    try {
      for (const r of dataRows) {
        const get = (key) => {
          const i = idx[key];
          if (i === undefined) return '';
          return String(r[i] == null ? '' : r[i]).trim();
        };

        const nik = get('nik').replace(/[^0-9]/g, '');
        const nama = get('nama');
        if (!nik || nik.length !== 16 || !nama) {
          skipped += 1;
          continue;
        }

        const payload = {
          nik,
          nama,
          no_kk: get('no_kk').replace(/[^0-9]/g, ''),
          tempat_lahir: get('tempat_lahir'),
          tanggal_lahir: parseDateToIso(get('tanggal_lahir')),
          gender: get('gender') || 'Laki-laki',
          alamat: get('alamat'),
          dusun: get('dusun'),
          agama: get('agama') || 'Islam',
          status_kawin: get('status_kawin') || 'Belum Kawin',
          pekerjaan: get('pekerjaan'),
          pendidikan: get('pendidikan') || 'Tidak/Belum Sekolah',
          no_hp: get('no_hp').replace(/[^0-9]/g, '')
        };

        const exist = await db.get('SELECT nik FROM penduduk WHERE nik = ? LIMIT 1', [payload.nik]);
        if (exist) {
          await db.run(
            `UPDATE penduduk
             SET nama = ?, no_kk = ?, tempat_lahir = ?, tanggal_lahir = ?, gender = ?, alamat = ?, dusun = ?, agama = ?, status_kawin = ?, pekerjaan = ?, pendidikan = ?, no_hp = ?
             WHERE nik = ?`,
            [
              payload.nama,
              payload.no_kk,
              payload.tempat_lahir,
              payload.tanggal_lahir,
              payload.gender,
              payload.alamat,
              payload.dusun,
              payload.agama,
              payload.status_kawin,
              payload.pekerjaan,
              payload.pendidikan,
              payload.no_hp,
              payload.nik
            ]
          );
          updated += 1;
        } else {
          await db.run(
            'INSERT INTO penduduk (nik, nama, no_kk, tempat_lahir, tanggal_lahir, gender, alamat, dusun, agama, status_kawin, pekerjaan, pendidikan, no_hp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              payload.nik,
              payload.nama,
              payload.no_kk,
              payload.tempat_lahir,
              payload.tanggal_lahir,
              payload.gender,
              payload.alamat,
              payload.dusun,
              payload.agama,
              payload.status_kawin,
              payload.pekerjaan,
              payload.pendidikan,
              payload.no_hp
            ]
          );
          inserted += 1;
        }
      }
      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    }

    res.redirect(`/dashboard/penduduk?success=imported&inserted=${inserted}&updated=${updated}&skipped=${skipped}`);
  } catch (error) {
    console.error('Error import penduduk:', error);
    res.redirect('/dashboard/penduduk?error=import_failed');
  }
};

// Render Halaman Pengaturan Website
const renderSettings = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    res.render('dashboard/pengaturan', {
      settings,
      user: req.session.user,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Error saat memuat pengaturan:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Simpan Pengaturan Website
const updateSettings = async (req, res) => {
  const { nama_desa, kecamatan, kabupaten, provinsi, kode_pos, alamat_kantor, office_lat, office_lng, office_radius_m, email, telepon, whatsapp, wa_recipients, kades, sekdes, visi, misi, sebutan_kades, nav_links, struktur_organisasi } = req.body;
  
  try {
    // Ambil logo saat ini dari database
    const currentSettings = await db.get('SELECT logo FROM pengaturan WHERE id = 1');
    let logoPath = currentSettings ? currentSettings.logo : null;

    // Jika ada file logo baru yang diunggah
    if (req.file) {
      logoPath = '/uploads/' + req.file.filename;
    }

    // Parsing misi (pisahkan berdasarkan baris baru)
    const misiArray = misi
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const navLinksArray = parseNavLinksText(nav_links);
    const strukturOrganisasiArray = parseStrukturOrganisasiText(struktur_organisasi);
    const waRecipientsArray = parseWaRecipientsText(wa_recipients);

    const lat = String(office_lat || '').trim();
    const lng = String(office_lng || '').trim();
    let officeLat = lat === '' ? null : Number(lat);
    let officeLng = lng === '' ? null : Number(lng);
    if (!Number.isFinite(officeLat) || officeLat < -90 || officeLat > 90) officeLat = null;
    if (!Number.isFinite(officeLng) || officeLng < -180 || officeLng > 180) officeLng = null;
    const radiusRaw = String(office_radius_m || '').trim();
    let officeRadiusM = radiusRaw === '' ? 200 : Number(radiusRaw);
    if (!Number.isFinite(officeRadiusM) || officeRadiusM <= 0) officeRadiusM = 200;

    await db.run(
      `UPDATE pengaturan 
       SET nama_desa = ?, kecamatan = ?, kabupaten = ?, provinsi = ?, kode_pos = ?, alamat_kantor = ?, office_lat = ?, office_lng = ?, office_radius_m = ?, email = ?, telepon = ?, whatsapp = ?, wa_recipients = ?, kades = ?, sekdes = ?, visi = ?, misi = ?, logo = ?, sebutan_kades = ?, nav_links = ?, struktur_organisasi = ? 
       WHERE id = 1`,
      [nama_desa, kecamatan, kabupaten, provinsi, kode_pos, alamat_kantor, Number.isFinite(officeLat) ? officeLat : null, Number.isFinite(officeLng) ? officeLng : null, officeRadiusM, email, telepon, whatsapp, JSON.stringify(waRecipientsArray), kades, sekdes, visi, JSON.stringify(misiArray), logoPath, sebutan_kades || 'Kepala Desa', JSON.stringify(navLinksArray), JSON.stringify(strukturOrganisasiArray)]
    );

    await db.run('UPDATE users SET nama = ? WHERE role = "kades"', [String(kades || '').trim()]);
    await db.run('UPDATE users SET nama = ? WHERE role = "sekdes"', [String(sekdes || '').trim()]);

    res.redirect('/dashboard/pengaturan?success=saved');
  } catch (error) {
    console.error('Error saat memperbarui pengaturan:', error);
    res.status(500).send('Gagal menyimpan perubahan.');
  }
};

// ==========================================
// MANAJEMEN PEGAWAI / STAFF DESA (Akses: Sekdes, Kades)
// ==========================================

// Render Halaman Kelola Pegawai
const renderPegawai = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    const pegawai = await db.all('SELECT * FROM users WHERE role != "warga" ORDER BY username ASC');

    res.render('dashboard/pegawai', {
      settings,
      user: req.session.user,
      pegawai,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat memuat data pegawai:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Tambah Akun Pegawai
const addPegawai = async (req, res) => {
  const { username, nama, role, password } = req.body;

  try {
    // Cek apakah username sudah dipakai
    const exist = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (exist) {
      return res.redirect('/dashboard/pegawai?error=username_exist');
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    await db.run(
      'INSERT INTO users (username, password, role, nik, nama) VALUES (?, ?, ?, NULL, ?)',
      [username.trim(), hashedPassword, role, nama.trim()]
    );

    await syncLeadershipFromUsers();
    res.redirect('/dashboard/pegawai?success=created');
  } catch (error) {
    console.error('Error saat menambah pegawai:', error);
    res.redirect('/dashboard/pegawai?error=server_error');
  }
};

// Edit Akun Pegawai
const editPegawai = async (req, res) => {
  const { old_username, nama, role, password } = req.body;

  try {
    const user = await db.get('SELECT * FROM users WHERE username = ?', [old_username]);
    if (!user) {
      return res.redirect('/dashboard/pegawai?error=notfound');
    }

    if (password && password.trim().length > 0) {
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(password, salt);
      await db.run(
        'UPDATE users SET nama = ?, role = ?, password = ? WHERE username = ?',
        [nama.trim(), role, hashedPassword, old_username]
      );
    } else {
      await db.run(
        'UPDATE users SET nama = ?, role = ? WHERE username = ?',
        [nama.trim(), role, old_username]
      );
    }

    await syncLeadershipFromUsers();
    res.redirect('/dashboard/pegawai?success=updated');
  } catch (error) {
    console.error('Error saat mengedit pegawai:', error);
    res.redirect('/dashboard/pegawai?error=server_error');
  }
};

// Hapus Akun Pegawai
const deletePegawai = async (req, res) => {
  const { username } = req.params;

  try {
    // Proteksi: Tidak boleh menghapus diri sendiri saat login!
    if (req.session.user.username === username) {
      return res.redirect('/dashboard/pegawai?error=cannot_delete_self');
    }

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.redirect('/dashboard/pegawai?error=notfound');
    }

    await db.run('DELETE FROM users WHERE username = ?', [username]);
    await syncLeadershipFromUsers();
    res.redirect('/dashboard/pegawai?success=deleted');
  } catch (error) {
    console.error('Error saat menghapus pegawai:', error);
    res.redirect('/dashboard/pegawai?error=server_error');
  }
};

// Render Halaman Kelola Keuangan / APBDes (Akses: Staff, Sekdes, Kades)
const renderKeuangan = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    const daftarKeuangan = await db.all('SELECT * FROM keuangan ORDER BY tahun DESC, kategori ASC, id ASC');
    const kategoriKeuangan = await db.all('SELECT * FROM categories WHERE tipe LIKE "keuangan_%" ORDER BY nama ASC');

    res.render('dashboard/keuangan', {
      settings,
      user: req.session.user,
      daftarKeuangan,
      kategoriKeuangan,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat memuat kelola keuangan:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Tambah Rekor Keuangan (Akses: Staff, Sekdes, Kades)
const addKeuangan = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { tahun, kategori, sub_kategori, anggaran, realisasi } = req.body;

  if (!tahun || !kategori || !sub_kategori || !anggaran || !realisasi) {
    return res.redirect('/dashboard/keuangan?error=missing_fields');
  }

  try {
    await db.run(
      'INSERT INTO keuangan (tahun, kategori, sub_kategori, anggaran, realisasi) VALUES (?, ?, ?, ?, ?)',
      [parseInt(tahun), kategori, sub_kategori.trim(), parseFloat(anggaran), parseFloat(realisasi)]
    );
    res.redirect('/dashboard/keuangan?success=created');
  } catch (error) {
    console.error('Error saat menambah rekor keuangan:', error);
    res.redirect('/dashboard/keuangan?error=server_error');
  }
};

// Edit Rekor Keuangan (Akses: Staff, Sekdes, Kades)
const editKeuangan = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id, tahun, kategori, sub_kategori, anggaran, realisasi } = req.body;

  if (!id || !tahun || !kategori || !sub_kategori || !anggaran || !realisasi) {
    return res.redirect('/dashboard/keuangan?error=missing_fields');
  }

  try {
    const exist = await db.get('SELECT * FROM keuangan WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/keuangan?error=notfound');
    }

    await db.run(
      'UPDATE keuangan SET tahun = ?, kategori = ?, sub_kategori = ?, anggaran = ?, realisasi = ? WHERE id = ?',
      [parseInt(tahun), kategori, sub_kategori.trim(), parseFloat(anggaran), parseFloat(realisasi), id]
    );
    res.redirect('/dashboard/keuangan?success=updated');
  } catch (error) {
    console.error('Error saat mengedit rekor keuangan:', error);
    res.redirect('/dashboard/keuangan?error=server_error');
  }
};

// Hapus Rekor Keuangan (Akses: Staff, Sekdes, Kades)
const deleteKeuangan = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id } = req.params;

  try {
    const exist = await db.get('SELECT * FROM keuangan WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/keuangan?error=notfound');
    }

    await db.run('DELETE FROM keuangan WHERE id = ?', [id]);
    res.redirect('/dashboard/keuangan?success=deleted');
  } catch (error) {
    console.error('Error saat menghapus rekor keuangan:', error);
    res.redirect('/dashboard/keuangan?error=server_error');
  }
};

// ==========================================
// MANAJEMEN KATEGORI (Akses: Staff, Sekdes, Kades)
// ==========================================

// Render Halaman Kelola Kategori
const renderKategori = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);
    const daftarKategori = await db.all('SELECT * FROM categories ORDER BY tipe ASC, nama ASC');

    res.render('dashboard/kategori', {
      settings,
      user: req.session.user,
      daftarKategori,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat memuat kelola kategori:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Tambah Kategori Baru
const addKategori = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { nama, tipe } = req.body;

  if (!nama || !tipe) {
    return res.redirect('/dashboard/kategori?error=missing_fields');
  }

  try {
    await db.run(
      'INSERT INTO categories (nama, tipe) VALUES (?, ?)',
      [nama.trim(), tipe]
    );
    res.redirect('/dashboard/kategori?success=created');
  } catch (error) {
    console.error('Error saat menambah kategori:', error);
    res.redirect('/dashboard/kategori?error=server_error');
  }
};

// Edit Kategori
const editKategori = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id, nama, tipe } = req.body;

  if (!id || !nama || !tipe) {
    return res.redirect('/dashboard/kategori?error=missing_fields');
  }

  try {
    const exist = await db.get('SELECT * FROM categories WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/kategori?error=notfound');
    }

    await db.run(
      'UPDATE categories SET nama = ?, tipe = ? WHERE id = ?',
      [nama.trim(), tipe, id]
    );
    res.redirect('/dashboard/kategori?success=updated');
  } catch (error) {
    console.error('Error saat mengedit kategori:', error);
    res.redirect('/dashboard/kategori?error=server_error');
  }
};

// Hapus Kategori
const deleteKategori = async (req, res) => {
  const { role } = req.session.user;
  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id } = req.params;

  try {
    const exist = await db.get('SELECT * FROM categories WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/kategori?error=notfound');
    }

    await db.run('DELETE FROM categories WHERE id = ?', [id]);
    res.redirect('/dashboard/kategori?success=deleted');
  } catch (error) {
    console.error('Error saat menghapus kategori:', error);
    res.redirect('/dashboard/kategori?error=server_error');
  }
};

module.exports = {
  renderDashboard,
  renderProfilSaya,
  renderPenduduk,
  addPenduduk,
  editPenduduk,
  deletePenduduk,
  exportPendudukCsv,
  importPendudukCsv,
  renderSettings,
  updateSettings,
  renderPegawai,
  addPegawai,
  editPegawai,
  deletePegawai,
  renderKeuangan,
  addKeuangan,
  editKeuangan,
  deleteKeuangan,
  renderKategori,
  addKategori,
  editKategori,
  deleteKategori
};
