const db = require('./db');
const waBot = require('../services/waBot');

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
  if (settings.wa_recipients) {
    try {
      settings.wa_recipients = JSON.parse(settings.wa_recipients);
    } catch (e) {
      settings.wa_recipients = [];
    }
  } else {
    settings.wa_recipients = [];
  }
  return settings;
};

const getToday = () => new Date().toISOString().split('T')[0];

const haversineDistanceM = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

const renderAbsensiDashboard = async (req, res) => {
  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    normalizeSettings(settings);

    const tanggal = String(req.query.tanggal || getToday());
    const me = req.session.user;
    const viewMode = String(req.query.view || '').toLowerCase() === 'monitor' ? 'monitor' : 'self';
    const role = String(me && me.role ? me.role : '').toLowerCase();
    const canMonitor = role === 'sekdes' || role === 'kades' || role === 'kuwu';
    const todayRecords = canMonitor
      ? await db.all('SELECT * FROM absensi WHERE tanggal = ? ORDER BY waktu DESC LIMIT 200', [tanggal])
      : [];
    const myRecords = await db.all(
      'SELECT * FROM absensi WHERE username = ? ORDER BY waktu DESC LIMIT 30',
      [me.username]
    );
    const lastToday = await db.get(
      'SELECT * FROM absensi WHERE username = ? AND tanggal = ? ORDER BY waktu DESC LIMIT 1',
      [me.username, tanggal]
    );

    if (viewMode === 'monitor' && !canMonitor) {
      return res.redirect('/dashboard?error=unauthorized');
    }

    res.render('dashboard/absensi', {
      settings,
      user: me,
      tanggal,
      canMonitor,
      viewMode,
      todayRecords,
      myRecords,
      lastToday,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (error) {
    console.error('Error saat memuat absensi dashboard:', error);
    res.status(500).send('Kesalahan server.');
  }
};

const submitAbsensi = async (req, res) => {
  const me = req.session.user;
  const role = String(me && me.role ? me.role : '').toLowerCase();
  const jenis = String(req.body.jenis || '').trim().toLowerCase();

  if (role === 'warga') return res.redirect('/dashboard?error=unauthorized');
  if (jenis !== 'masuk' && jenis !== 'pulang') return res.redirect('/dashboard/absensi?error=jenis_invalid');
  if (!req.file) return res.redirect('/dashboard/absensi?error=foto_wajib');

  try {
    const tanggal = getToday();
    const existing = await db.get(
      'SELECT id FROM absensi WHERE username = ? AND tanggal = ? AND jenis = ? LIMIT 1',
      [me.username, tanggal, jenis]
    );
    if (existing) return res.redirect('/dashboard/absensi?error=already_' + jenis);

    const s = await db.get('SELECT office_lat, office_lng, office_radius_m, whatsapp, wa_recipients FROM pengaturan WHERE id = 1');
    const officeLat = s && s.office_lat !== null && s.office_lat !== undefined ? Number(s.office_lat) : null;
    const officeLng = s && s.office_lng !== null && s.office_lng !== undefined ? Number(s.office_lng) : null;
    const officeRadiusM = s && s.office_radius_m ? Number(s.office_radius_m) : 200;
    if (!Number.isFinite(officeLat) || !Number.isFinite(officeLng)) {
      return res.redirect('/dashboard/absensi?error=lokasi_kantor_belum_diatur');
    }

    const lat = Number(req.body.lokasi_lat);
    const lng = Number(req.body.lokasi_lng);
    const acc = req.body.lokasi_acc !== undefined ? Number(req.body.lokasi_acc) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.redirect('/dashboard/absensi?error=lokasi_wajib');
    }

    const jarakM = haversineDistanceM(lat, lng, officeLat, officeLng);
    if (Number.isFinite(officeRadiusM) && officeRadiusM > 0 && jarakM > officeRadiusM) {
      return res.redirect('/dashboard/absensi?error=lokasi_diluar_area');
    }

    const waktu = new Date().toISOString();
    const foto = '/uploads/attendance/' + req.file.filename;
    const catatan = String(req.body.catatan || '').trim().slice(0, 200);

    await db.run(
      'INSERT INTO absensi (username, nama, role, tanggal, jenis, waktu, foto, catatan, lokasi_lat, lokasi_lng, lokasi_acc, jarak_kantor_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [me.username, me.nama || me.username, me.role, tanggal, jenis, waktu, foto, catatan, lat, lng, Number.isFinite(acc) ? acc : null, jarakM]
    );

    try {
      let recipients = [];
      if (s && s.wa_recipients) {
        try {
          const parsed = JSON.parse(s.wa_recipients);
          if (Array.isArray(parsed)) recipients = parsed;
        } catch (e) {}
      }
      if (s && s.whatsapp) recipients.unshift(String(s.whatsapp));
      recipients = Array.from(new Set(recipients.map((n) => String(n || '').replace(/[^0-9]/g, '')).filter(Boolean)));

      const title = `📷 Absensi ${jenis === 'masuk' ? 'Masuk' : 'Pulang'}`;
      const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
      const accText = Number.isFinite(acc) ? `±${Math.round(acc)}m` : '-';
      const text =
        `${title}\n` +
        `Nama: ${me.nama || me.username}\n` +
        `Role: ${me.role}\n` +
        `Waktu: ${new Date(waktu).toLocaleString('id-ID')}\n` +
        `Jarak dari kantor: ${jarakM} m\n` +
        `Akurasi GPS: ${accText}\n` +
        `Lokasi: ${mapLink}` +
        (catatan ? `\nCatatan: ${catatan}` : '');

      for (const phone of recipients) {
        await waBot.sendText(phone, text);
      }
    } catch (e) {}

    res.redirect('/dashboard/absensi?success=ok');
  } catch (error) {
    console.error('Error saat submit absensi:', error);
    res.redirect('/dashboard/absensi?error=server_error');
  }
};

module.exports = {
  renderAbsensiDashboard,
  submitAbsensi
};
