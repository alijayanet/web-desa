const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = null;

// Membuka dan menginisialisasi database SQLite
const initDatabase = async () => {
  console.log('Menginisialisasi basis data relasional SQLite...');
  
  db = await open({
    filename: path.join(DATA_DIR, 'desa.db'),
    driver: sqlite3.Database
  });

  // Aktifkan dukungan Foreign Keys di SQLite
  await db.run('PRAGMA foreign_keys = ON');

  // 1. Buat Tabel Penduduk
  await db.exec(`
    CREATE TABLE IF NOT EXISTS penduduk (
      nik TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      no_kk TEXT NOT NULL,
      tempat_lahir TEXT NOT NULL,
      tanggal_lahir TEXT NOT NULL,
      gender TEXT NOT NULL,
      alamat TEXT NOT NULL,
      dusun TEXT NOT NULL,
      agama TEXT NOT NULL,
      status_kawin TEXT NOT NULL,
      pekerjaan TEXT NOT NULL,
      pendidikan TEXT NOT NULL,
      no_hp TEXT DEFAULT ''
    )
  `);

  // 2. Buat Tabel Users (Relasi ke Penduduk via NIK)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      nik TEXT,
      nama TEXT NOT NULL,
      FOREIGN KEY (nik) REFERENCES penduduk(nik) ON DELETE CASCADE
    )
  `);

  // 3. Buat Tabel Surat
  await db.exec(`
    CREATE TABLE IF NOT EXISTS surat (
      id TEXT PRIMARY KEY,
      nik TEXT NOT NULL,
      nama TEXT NOT NULL,
      jenis_surat TEXT NOT NULL,
      tanggal_pengajuan TEXT NOT NULL,
      status TEXT NOT NULL,
      catatan TEXT,
      keterangan TEXT NOT NULL, -- JSON String
      FOREIGN KEY (nik) REFERENCES penduduk(nik) ON DELETE CASCADE
    )
  `);

  // 4. Buat Tabel Pengaduan
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pengaduan (
      id TEXT PRIMARY KEY,
      nik TEXT NOT NULL,
      nama TEXT NOT NULL,
      judul TEXT NOT NULL,
      kategori TEXT NOT NULL,
      isi TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      status TEXT NOT NULL,
      tanggapan TEXT,
      tanggapan_oleh TEXT,
      tanggal_tanggapan TEXT,
      FOREIGN KEY (nik) REFERENCES penduduk(nik) ON DELETE CASCADE
    )
  `);

  // 5. Buat Tabel Berita
  await db.exec(`
    CREATE TABLE IF NOT EXISTS berita (
      id TEXT PRIMARY KEY,
      judul TEXT NOT NULL,
      kategori TEXT NOT NULL,
      ringkasan TEXT NOT NULL,
      konten TEXT NOT NULL,
      gambar TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      penulis TEXT NOT NULL
    )
  `);

  // 6. Buat Tabel Templates Surat
  await db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      nama_surat TEXT NOT NULL,
      nomor_kode TEXT NOT NULL,
      isi_surat TEXT NOT NULL
    )
  `);

  // 7. Buat Tabel Pengaturan Desa (Satu Baris)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pengaturan (
      id INTEGER PRIMARY KEY CHECK (id = 1), -- Menjamin hanya ada 1 baris
      nama_desa TEXT NOT NULL,
      kecamatan TEXT NOT NULL,
      kabupaten TEXT NOT NULL,
      provinsi TEXT NOT NULL,
      kode_pos TEXT NOT NULL,
      alamat_kantor TEXT NOT NULL,
      office_lat REAL,
      office_lng REAL,
      office_radius_m INTEGER DEFAULT 200,
      email TEXT NOT NULL,
      telepon TEXT NOT NULL,
      whatsapp TEXT DEFAULT '',
      wa_recipients TEXT DEFAULT '[]',
      kades TEXT NOT NULL,
      sekdes TEXT NOT NULL,
      visi TEXT NOT NULL,
      misi TEXT NOT NULL, -- JSON String Array
      logo TEXT, -- Kolom logo desa
      sebutan_kades TEXT DEFAULT 'Kepala Desa',
      nav_links TEXT DEFAULT '[]',
      struktur_organisasi TEXT DEFAULT '[]'
    )
  `);

  // 8. Buat Tabel Keuangan Desa (APBDes)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS keuangan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tahun INTEGER NOT NULL,
      kategori TEXT NOT NULL, -- 'Pendapatan', 'Belanja', 'Pembiayaan'
      sub_kategori TEXT NOT NULL, -- misal: 'Dana Desa', 'Infrastruktur', dll.
      anggaran REAL NOT NULL,
      realisasi REAL NOT NULL
    )
  `);

  // 9. Buat Tabel Kategori (Berita, Pengaduan, Keuangan)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      tipe TEXT NOT NULL
    )
  `);

  // 10. Buat Tabel Kaitan WhatsApp Bot (JID <-> NIK Warga)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS wa_links (
      jid TEXT PRIMARY KEY,
      nik TEXT NOT NULL,
      pn_jid TEXT,
      lid_jid TEXT,
      linked_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      FOREIGN KEY (nik) REFERENCES penduduk(nik) ON DELETE CASCADE
    )
  `);

  // 11. Buat Tabel Absensi Perangkat Desa (Scan Wajah / Foto)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS absensi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      nama TEXT NOT NULL,
      role TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      jenis TEXT NOT NULL, -- 'masuk' | 'pulang'
      waktu TEXT NOT NULL, -- ISO datetime
      foto TEXT NOT NULL, -- path publik /uploads/attendance/...
      catatan TEXT,
      lokasi_lat REAL,
      lokasi_lng REAL,
      lokasi_acc REAL,
      jarak_kantor_m INTEGER,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    )
  `);

  // Migrasi: Cek apakah kolom 'logo' sudah ada di tabel 'pengaturan'
  const tableInfo = await db.all("PRAGMA table_info(pengaturan)");
  const hasLogo = tableInfo.some(column => column.name === 'logo');
  if (!hasLogo) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN logo TEXT");
    console.log("Kolom 'logo' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  // Migrasi: Cek apakah kolom 'no_hp' sudah ada di tabel 'penduduk'
  const tableInfoPenduduk = await db.all("PRAGMA table_info(penduduk)");
  const hasNoHp = tableInfoPenduduk.some(column => column.name === 'no_hp');
  if (!hasNoHp) {
    await db.exec("ALTER TABLE penduduk ADD COLUMN no_hp TEXT DEFAULT ''");
    console.log("Kolom 'no_hp' berhasil ditambahkan ke tabel 'penduduk'!");
  }

  // Migrasi: Cek apakah kolom 'whatsapp' sudah ada di tabel 'pengaturan'
  const tableInfoWhatsapp = await db.all("PRAGMA table_info(pengaturan)");
  const hasWhatsapp = tableInfoWhatsapp.some(column => column.name === 'whatsapp');
  if (!hasWhatsapp) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN whatsapp TEXT DEFAULT ''");
    console.log("Kolom 'whatsapp' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  // Migrasi: Cek apakah kolom 'wa_recipients' sudah ada di tabel 'pengaturan'
  const tableInfoWaRecipients = await db.all("PRAGMA table_info(pengaturan)");
  const hasWaRecipients = tableInfoWaRecipients.some(column => column.name === 'wa_recipients');
  if (!hasWaRecipients) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN wa_recipients TEXT DEFAULT '[]'");
    console.log("Kolom 'wa_recipients' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  // Migrasi: Cek apakah kolom 'sebutan_kades' sudah ada di tabel 'pengaturan'
  const tableInfoSebutanKades = await db.all("PRAGMA table_info(pengaturan)");
  const hasSebutanKades = tableInfoSebutanKades.some(column => column.name === 'sebutan_kades');
  if (!hasSebutanKades) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN sebutan_kades TEXT DEFAULT 'Kepala Desa'");
    console.log("Kolom 'sebutan_kades' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  // Migrasi: Cek apakah kolom 'nav_links' sudah ada di tabel 'pengaturan'
  const tableInfoNavLinks = await db.all("PRAGMA table_info(pengaturan)");
  const hasNavLinks = tableInfoNavLinks.some(column => column.name === 'nav_links');
  if (!hasNavLinks) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN nav_links TEXT DEFAULT '[]'");
    await db.exec(`UPDATE pengaturan SET nav_links = '[{"label":"CCTV","url":"https://cctv.alijaya.com"}]' WHERE id = 1 AND (nav_links IS NULL OR nav_links = '')`);
    console.log("Kolom 'nav_links' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  // Migrasi: Cek apakah kolom 'struktur_organisasi' sudah ada di tabel 'pengaturan'
  const tableInfoStruktur = await db.all("PRAGMA table_info(pengaturan)");
  const hasStrukturOrganisasi = tableInfoStruktur.some(column => column.name === 'struktur_organisasi');
  if (!hasStrukturOrganisasi) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN struktur_organisasi TEXT DEFAULT '[]'");
    await db.exec(
      `UPDATE pengaturan 
       SET struktur_organisasi = '[{"jabatan":"Staff Kesejahteraan & Pelayanan","nama":"Andi Wijaya"},{"jabatan":"Kepala Dusun Krajan","nama":"Rudi Hartono"},{"jabatan":"Kepala Dusun Sari Mulyo","nama":"Hendra Wijaya"},{"jabatan":"Kepala Dusun Tirta Jaya","nama":"Bambang S."},{"jabatan":"Bendahara Desa","nama":"Dewi Lestari"}]' 
       WHERE id = 1 AND (struktur_organisasi IS NULL OR struktur_organisasi = '')`
    );
    console.log("Kolom 'struktur_organisasi' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  const tableInfoOffice = await db.all("PRAGMA table_info(pengaturan)");
  const hasOfficeLat = tableInfoOffice.some(column => column.name === 'office_lat');
  if (!hasOfficeLat) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN office_lat REAL");
    console.log("Kolom 'office_lat' berhasil ditambahkan ke tabel 'pengaturan'!");
  }
  const tableInfoOfficeLng = await db.all("PRAGMA table_info(pengaturan)");
  const hasOfficeLng = tableInfoOfficeLng.some(column => column.name === 'office_lng');
  if (!hasOfficeLng) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN office_lng REAL");
    console.log("Kolom 'office_lng' berhasil ditambahkan ke tabel 'pengaturan'!");
  }
  const tableInfoOfficeRadius = await db.all("PRAGMA table_info(pengaturan)");
  const hasOfficeRadius = tableInfoOfficeRadius.some(column => column.name === 'office_radius_m');
  if (!hasOfficeRadius) {
    await db.exec("ALTER TABLE pengaturan ADD COLUMN office_radius_m INTEGER DEFAULT 200");
    console.log("Kolom 'office_radius_m' berhasil ditambahkan ke tabel 'pengaturan'!");
  }

  const tableInfoAbsensi = await db.all("PRAGMA table_info(absensi)");
  const hasLokasiLat = tableInfoAbsensi.some(column => column.name === 'lokasi_lat');
  if (!hasLokasiLat) {
    await db.exec("ALTER TABLE absensi ADD COLUMN lokasi_lat REAL");
    console.log("Kolom 'lokasi_lat' berhasil ditambahkan ke tabel 'absensi'!");
  }
  const tableInfoAbsensiLng = await db.all("PRAGMA table_info(absensi)");
  const hasLokasiLng = tableInfoAbsensiLng.some(column => column.name === 'lokasi_lng');
  if (!hasLokasiLng) {
    await db.exec("ALTER TABLE absensi ADD COLUMN lokasi_lng REAL");
    console.log("Kolom 'lokasi_lng' berhasil ditambahkan ke tabel 'absensi'!");
  }
  const tableInfoAbsensiAcc = await db.all("PRAGMA table_info(absensi)");
  const hasLokasiAcc = tableInfoAbsensiAcc.some(column => column.name === 'lokasi_acc');
  if (!hasLokasiAcc) {
    await db.exec("ALTER TABLE absensi ADD COLUMN lokasi_acc REAL");
    console.log("Kolom 'lokasi_acc' berhasil ditambahkan ke tabel 'absensi'!");
  }
  const tableInfoAbsensiDistance = await db.all("PRAGMA table_info(absensi)");
  const hasJarak = tableInfoAbsensiDistance.some(column => column.name === 'jarak_kantor_m');
  if (!hasJarak) {
    await db.exec("ALTER TABLE absensi ADD COLUMN jarak_kantor_m INTEGER");
    console.log("Kolom 'jarak_kantor_m' berhasil ditambahkan ke tabel 'absensi'!");
  }

  // Migrasi: Cek apakah kolom 'embed_url' sudah ada di tabel 'berita'
  const tableInfoBerita = await db.all("PRAGMA table_info(berita)");
  const hasEmbedUrl = tableInfoBerita.some(column => column.name === 'embed_url');
  if (!hasEmbedUrl) {
    await db.exec("ALTER TABLE berita ADD COLUMN embed_url TEXT DEFAULT ''");
    console.log("Kolom 'embed_url' berhasil ditambahkan ke tabel 'berita'!");
  }

  // Migrasi: Cek apakah kolom 'nomor_surat' dan 'isi_surat' sudah ada di tabel 'surat'
  const tableInfoSurat = await db.all("PRAGMA table_info(surat)");
  const hasNomorSurat = tableInfoSurat.some(column => column.name === 'nomor_surat');
  if (!hasNomorSurat) {
    await db.exec("ALTER TABLE surat ADD COLUMN nomor_surat TEXT");
    console.log("Kolom 'nomor_surat' berhasil ditambahkan ke tabel 'surat'!");
  }
  const hasIsiSurat = tableInfoSurat.some(column => column.name === 'isi_surat');
  if (!hasIsiSurat) {
    await db.exec("ALTER TABLE surat ADD COLUMN isi_surat TEXT");
    console.log("Kolom 'isi_surat' berhasil ditambahkan ke tabel 'surat'!");
  }

  // Migrasi: Isi nilai default untuk 'nomor_surat' dan 'isi_surat' pada data lama yang kosong
  const nullSurat = await db.all("SELECT * FROM surat WHERE nomor_surat IS NULL OR isi_surat IS NULL");
  if (nullSurat.length > 0) {
    console.log(`Mengisi data default untuk ${nullSurat.length} data surat lama...`);
    const allTemplates = await db.all('SELECT * FROM templates');
    for (const s of nullSurat) {
      let t = allTemplates.find(temp => temp.nama_surat === s.jenis_surat);
      if (!t) {
        t = {
          nomor_kode: "470 / {CODE} / Kesra / {YEAR}",
          isi_surat: "Bahwa nama tersebut di atas benar-benar penduduk Desa Ujunggebang yang berdomisili di alamat tersebut."
        };
      }
      const codePart = s.id.split('-')[1] || s.id;
      const yearPart = new Date(s.tanggal_pengajuan).getFullYear() || new Date().getFullYear();
      let num = t.nomor_kode.replace(/{CODE}/g, codePart).replace(/{YEAR}/g, yearPart);
      
      let isi = t.isi_surat;
      let ket = {};
      try {
        if (s.keterangan) ket = JSON.parse(s.keterangan);
      } catch (e) {
        console.error('Error parse keterangan:', e);
      }
      
      if (ket) {
        isi = isi.replace(/{keperluan}/g, ket.keperluan || '');
        isi = isi.replace(/{nama_usaha}/g, ket.nama_usaha || '');
        isi = isi.replace(/{jenis_usaha}/g, ket.jenis_usaha || '');
        isi = isi.replace(/{alamat_usaha}/g, ket.alamat_usaha || '');
        isi = isi.replace(/{nama_bayi}/g, ket.nama_bayi || '');
        isi = isi.replace(/{nama_ibu}/g, ket.nama_ibu || '');
        isi = isi.replace(/{nama_jenazah}/g, ket.nama_jenazah || '');
        if (ket.tanggal_kematian) {
          const formattedDate = new Date(ket.tanggal_kematian).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
          isi = isi.replace(/{tanggal_kematian}/g, formattedDate);
        }
      }

      await db.run("UPDATE surat SET nomor_surat = ?, isi_surat = ? WHERE id = ?", [num, isi, s.id]);
    }
    console.log("Migrasi data default surat berhasil diselesaikan!");
  }

  // ==========================================
  // MELAKUKAN DATA SEEDING (Pengisian Default)
  // ==========================================
  
  // A. Seed Penduduk
  const countPenduduk = await db.get('SELECT COUNT(*) AS total FROM penduduk');
  if (countPenduduk.total === 0) {
    console.log('Menyuntikkan data benih kependudukan default...');
    const seedPenduduk = [
      ['3212010101800001', 'Budi Santoso', '3212011212080001', 'Indramayu', '1980-01-15', 'Laki-laki', 'Blok Desa, RT 01/RW 01', 'Krajan', 'Islam', 'Kawin', 'Wiraswasta', 'SLTA/Sederajat', ''],
      ['3212010202850002', 'Siti Aminah', '3212011212080001', 'Indramayu', '1985-02-20', 'Perempuan', 'Blok Desa, RT 01/RW 01', 'Krajan', 'Islam', 'Kawin', 'Ibu Rumah Tangga', 'SLTA/Sederajat', ''],
      ['3212010303900003', 'Ahmad Fauzi', '3212011212080002', 'Cirebon', '1990-03-25', 'Laki-laki', 'Blok Sawah, RT 02/RW 02', 'Sari Mulyo', 'Islam', 'Kawin', 'Petani', 'SLTP/Sederajat', ''],
      ['3212010404950004', 'Rina Lestari', '3212011212080003', 'Bandung', '1995-04-12', 'Perempuan', 'Blok Pesantren, RT 03/RW 01', 'Krajan', 'Islam', 'Belum Kawin', 'Karyawan Swasta', 'Diploma/Sarjana', ''],
      ['3212010505700005', 'Haji Sulaiman', '3212011212080004', 'Indramayu', '1970-05-30', 'Laki-laki', 'Blok Masjid, RT 01/RW 03', 'Tirta Jaya', 'Islam', 'Kawin', 'Pedagang', 'SLTA/Sederajat', ''],
      ['3212010606990006', 'Muhammad Yusuf', '3212011212080003', 'Indramayu', '1999-06-18', 'Laki-laki', 'Blok Pesantren, RT 03/RW 01', 'Krajan', 'Islam', 'Belum Kawin', 'Pelajar/Mahasiswa', 'Diploma/Sarjana', '']
    ];

    const stmt = await db.prepare('INSERT INTO penduduk (nik, nama, no_kk, tempat_lahir, tanggal_lahir, gender, alamat, dusun, agama, status_kawin, pekerjaan, pendidikan, no_hp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const p of seedPenduduk) {
      await stmt.run(p);
    }
    await stmt.finalize();
  }

  // B. Seed Users
  const countUsers = await db.get('SELECT COUNT(*) AS total FROM users');
  if (countUsers.total === 0) {
    console.log('Menyuntikkan data benih akun pengguna default...');
    
    // Hash password default
    const salt = bcrypt.genSaltSync(10);
    const passWarga = bcrypt.hashSync('warga123', salt);
    const passStaff = bcrypt.hashSync('staff123', salt);
    const passSekdes = bcrypt.hashSync('sekdes123', salt);
    const passKades = bcrypt.hashSync('kades123', salt);

    const seedUsers = [
      ['3212010101800001', passWarga, 'warga', '3212010101800001', 'Budi Santoso'],
      ['3212010606990006', passWarga, 'warga', '3212010606990006', 'Muhammad Yusuf'],
      ['staff', passStaff, 'staff', null, 'Andi Wijaya (Staff Administrasi)'],
      ['sekdes', passSekdes, 'sekdes', null, 'Suryono, S.Sos (Sekretaris Desa)'],
      ['kades', passKades, 'kades', null, 'H. Sukarno, M.Si (Kepala Desa / Kuwu)']
    ];

    const stmt = await db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)');
    for (const u of seedUsers) {
      await stmt.run(u);
    }
    await stmt.finalize();
  }

  // C. Seed Templates
  console.log('Menyuntikkan data benih template surat...');
  const seedTemplates = [
    ['domisili', 'Surat Keterangan Domisili', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas adalah benar-benar penduduk Desa Ujunggebang yang bertempat tinggal di alamat tersebut, Kecamatan Sukra, Kabupaten Indramayu, Jawa Barat.'],
    ['sku', 'Surat Keterangan Usaha (SKU)', '470 / {CODE} / Ekbang / {YEAR}', 'Bahwa nama yang bersangkutan di atas benar memiliki kegiatan usaha di wilayah Desa Ujunggebang, dengan rincian nama usaha {nama_usaha}, bidang usaha {jenis_usaha}, yang beralamat di {alamat_usaha}.'],
    ['sktm', 'Surat Keterangan Tidak Mampu (SKTM)', '470 / {CODE} / Kesra / {YEAR}', 'Bahwa nama tersebut di atas benar merupakan warga berdomisili di Desa Ujunggebang yang tergolong dalam keluarga pra-sejahtera (tidak mampu secara ekonomi) berdasarkan basis data terpadu kesejahteraan sosial desa.'],
    ['skck', 'Surat Keterangan Berkelakuan Baik (Pengantar SKCK)', '470 / {CODE} / Trantib / {YEAR}', 'Bahwa sepanjang sepengetahuan kami, nama tersebut di atas berkelakuan baik, tidak pernah terlibat dalam aksi kriminalitas, penggunaan narkoba, maupun kegiatan melanggar hukum lainnya di wilayah Desa Ujunggebang.'],
    ['kelahiran', 'Surat Keterangan Kelahiran', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas telah melaporkan kelahiran seorang anak kandung bernama {nama_bayi} dari Ibu Kandung bernama {nama_ibu} pada wilayah hukum Desa Ujunggebang.'],
    ['kematian', 'Surat Keterangan Kematian', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas benar telah melaporkan wafatnya anggota keluarga atas nama almarhum/ah {nama_jenazah} pada tanggal {tanggal_kematian} di Desa Ujunggebang.'],
    ['nikah', 'Surat Pengantar Nikah (N1-N4)', '470 / {CODE} / Kesra / {YEAR}', 'Bahwa nama tersebut di atas benar-benar warga Desa Ujunggebang yang bermaksud melangsungkan perkawinan/pernikahan. Surat keterangan ini dikeluarkan sebagai pengantar nikah (N1-N4) guna pengurusan administrasi perkawinan di Kantor Urusan Agama (KUA).'],
    ['duda_janda', 'Surat Keterangan Duda/Janda', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas benar merupakan warga berdomisili di Desa Ujunggebang, dan sepanjang sepengetahuan kami serta berdasarkan catatan yang ada, yang bersangkutan berstatus duda/janda setelah bercerai/wafat pasangan hidupnya.'],
    ['penghasilan', 'Surat Keterangan Penghasilan', '470 / {CODE} / Kesra / {YEAR}', 'Bahwa berdasarkan keterangan pemohon dan data yang ada, yang bersangkutan yang bekerja sebagai wiraswasta/freelancer memiliki penghasilan rata-rata sebesar {keperluan} per bulannya.'],
    ['bersih_diri', 'Surat Keterangan Bersih Diri', '470 / {CODE} / Trantib / {YEAR}', 'Bahwa sepanjang catatan desa, nama tersebut di atas beserta keluarganya tidak pernah terlibat dalam gerakan ekstremisme, organisasi terlarang, maupun kegiatan yang membahayakan kedaulatan Negara Kesatuan Republik Indonesia (NKRI).'],
    ['beda_nama', 'Surat Keterangan Perbedaan Nama', '470 / {CODE} / Pem / {YEAR}', 'Bahwa terjadi perbedaan penulisan nama pada berkas kependudukan pemohon. Nama yang tertulis pada KTP/KK adalah {nama_ibu} sedangkan pada ijazah/akta lahir tertulis {nama_bayi}. Kami menerangkan bahwa kedua penulisan nama tersebut adalah menunjuk pada satu orang/individu yang sama.'],
    ['kehilangan', 'Surat Keterangan Pengantar Kehilangan', '470 / {CODE} / Trantib / {YEAR}', 'Bahwa nama tersebut di atas telah melaporkan kehilangan dokumen penting berupa kartu identitas/surat berharga di wilayah Desa Ujunggebang, dengan rincian dokumen yang hilang adalah {keperluan}.'],
    ['pengantar_ktp', 'Surat Pengantar Pembuatan KTP', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas benar warga berdomisili di Desa Ujunggebang dan surat ini dipergunakan sebagai pengantar untuk pengurusan administrasi KTP, dengan keperluan: {keperluan}.'],
    ['pengantar_kk', 'Surat Pengantar Pembuatan KK', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas benar warga Desa Ujunggebang dan surat ini dipergunakan sebagai pengantar untuk pengurusan administrasi Kartu Keluarga (KK), dengan keperluan: {keperluan}.'],
    ['belum_menikah', 'Surat Keterangan Belum Menikah', '470 / {CODE} / Pem / {YEAR}', 'Bahwa berdasarkan data dan keterangan yang ada, nama tersebut di atas sampai saat surat ini dibuat berstatus belum menikah, dan surat ini dipergunakan untuk: {keperluan}.'],
    ['ahli_waris', 'Surat Keterangan Ahli Waris', '470 / {CODE} / Pem / {YEAR}', 'Bahwa berdasarkan keterangan para pihak dan data yang ada, surat ini menerangkan hubungan ahli waris untuk keperluan: {keperluan}.'],
    ['pindah', 'Surat Keterangan Pindah', '470 / {CODE} / Pem / {YEAR}', 'Bahwa nama tersebut di atas benar warga Desa Ujunggebang dan surat ini dipergunakan sebagai keterangan pindah/domisili untuk: {keperluan}.'],
    ['izin_keramaian', 'Surat Izin Keramaian', '470 / {CODE} / Trantib / {YEAR}', 'Bahwa surat ini dipergunakan sebagai keterangan/izin keramaian pada kegiatan: {keperluan}. Pemohon wajib menjaga ketertiban dan keamanan lingkungan selama kegiatan berlangsung.'],
    ['domisili_usaha', 'Surat Keterangan Domisili Usaha', '470 / {CODE} / Ekbang / {YEAR}', 'Bahwa benar di wilayah Desa Ujunggebang terdapat usaha milik pemohon dengan nama usaha {nama_usaha}, bidang usaha {jenis_usaha}, beralamat di {alamat_usaha}. Surat ini dipergunakan untuk: {keperluan}.'],
    ['belum_bekerja', 'Surat Keterangan Belum Bekerja', '470 / {CODE} / Kesra / {YEAR}', 'Bahwa berdasarkan keterangan pemohon dan data yang ada, nama tersebut di atas saat surat ini dibuat belum bekerja, dan surat ini dipergunakan untuk: {keperluan}.']
  ];

  for (const t of seedTemplates) {
    const exist = await db.get('SELECT id FROM templates WHERE id = ?', [t[0]]);
    if (!exist) {
      await db.run('INSERT INTO templates (id, nama_surat, nomor_kode, isi_surat) VALUES (?, ?, ?, ?)', t);
      console.log(`Template surat '${t[1]}' berhasil disuntikkan!`);
    }
  }

  // D. Seed Pengaturan
  const countSettings = await db.get('SELECT COUNT(*) AS total FROM pengaturan');
  if (countSettings.total === 0) {
    console.log('Menyuntikkan data benih konfigurasi desa default...');
    const defaultMisi = [
      "Meningkatkan kualitas pelayanan publik desa melalui adopsi teknologi informasi yang cepat dan transparan.",
      "Mengembangkan potensi pertanian lokal dengan penyediaan sarana irigasi dan pupuk yang memadai bagi petani.",
      "Mendorong tata kelola pemerintahan desa yang bersih, amanah, dan mengutamakan gotong royong warga.",
      "Meningkatkan pembangunan infrastruktur jalan, drainase, dan sarana umum desa secara merata."
    ];
    const defaultNavLinks = [
      { label: 'CCTV', url: 'https://cctv.alijaya.com' }
    ];
    const defaultStrukturOrganisasi = [
      { jabatan: 'Staff Kesejahteraan & Pelayanan', nama: 'Andi Wijaya' },
      { jabatan: 'Kepala Dusun Krajan', nama: 'Rudi Hartono' },
      { jabatan: 'Kepala Dusun Sari Mulyo', nama: 'Hendra Wijaya' },
      { jabatan: 'Kepala Dusun Tirta Jaya', nama: 'Bambang S.' },
      { jabatan: 'Bendahara Desa', nama: 'Dewi Lestari' }
    ];

    await db.run(`
      INSERT INTO pengaturan (id, nama_desa, kecamatan, kabupaten, provinsi, kode_pos, alamat_kantor, email, telepon, whatsapp, wa_recipients, kades, sekdes, visi, misi, nav_links, struktur_organisasi)
      VALUES (
        1, 
        'Desa Ujunggebang', 
        'Sukra', 
        'Indramayu', 
        'Jawa Barat', 
        '45257', 
        'Jl. Raya Pantura No. 12, Desa Ujunggebang, Kec. Sukra, Kab. Indramayu, Jawa Barat', 
        'info@ujunggebang.desa.id', 
        '0812-3456-7890', 
        '',
        '[]',
        'H. Sukarno, M.Si', 
        'Suryono, S.Sos', 
        'Terwujudnya Desa Ujunggebang yang Mandiri, Sejahtera, Transparan, dan Unggul dalam Sektor Pertanian serta Pelayanan Publik berbasis Digital.',
        ?,
        ?,
        ?
      )
    `, JSON.stringify(defaultMisi), JSON.stringify(defaultNavLinks), JSON.stringify(defaultStrukturOrganisasi));
  }

  // E. Seed Berita
  const countBerita = await db.get('SELECT COUNT(*) AS total FROM berita');
  if (countBerita.total === 0) {
    console.log('Menyuntikkan data benih berita default...');
    const seedBerita = [
      [
        'BRT-000001', 
        'Kerja Bakti Massal Desa Ujunggebang Menyambut Musim Kemarau', 
        'Kegiatan Desa', 
        'Warga Desa Ujunggebang bergotong royong membersihkan saluran irigasi dan selokan guna mencegah penyumbatan menjelang musim kemarau.', 
        '<p>Warga Desa Ujunggebang melaksanakan kerja bakti massal pada hari Minggu kemarin. Kegiatan ini dipimpin langsung oleh Kepala Desa H. Sukarno dan diikuti oleh ratusan warga dari seluruh RT/RW.</p><p>Fokus utama dari kerja bakti kali ini adalah pembersihan saluran irigasi pertanian di Blok Sawah serta saluran air pemukiman di Dusun Krajan. Langkah ini diambil guna memastikan aliran air lancar untuk pertanian padi serta menjaga kebersihan lingkungan agar bebas dari penyakit.</p><p>Kades H. Sukarno menyampaikan apresiasi yang setinggi-tingginya kepada seluruh warga yang sangat antusias berpartisipasi. Budaya gotong royong ini diharapkan dapat terus dipertahankan demi kemajuan Desa Ujunggebang.</p>', 
        'berita1.jpg', 
        '2026-05-18', 
        'Andi Wijaya'
      ],
      [
        'BRT-000002', 
        'Penyaluran Bantuan Langsung Tunai (BLT) Dana Desa Tahap II Sukses Terlaksana', 
        'Pengumuman', 
        'Pemerintah Desa Ujunggebang telah merampungkan penyaluran BLT Dana Desa Tahap II kepada 50 Keluarga Penerima Manfaat (KPM).', 
        '<p>Pemerintah Desa Ujunggebang menyalurkan Bantuan Langsung Tunai (BLT) bersumber dari Dana Desa tahun anggaran 2026 tahap kedua. Penyaluran ini dilaksanakan secara tertib di Aula Kantor Desa Ujunggebang pada hari Jumat pagi.</p><p>Sebanyak 50 Keluarga Penerima Manfaat (KPM) menerima dana bantuan masing-masing sebesar Rp 300.000. Penerima manfaat ini telah melalui proses verifikasi ketat dari tim verifikasi desa untuk memastikan bantuan tepat sasaran kepada warga yang paling membutuhkan.</p><p>Sekretaris Desa Suryono menjelaskan bahwa penyaluran berjalan dengan aman dan lancar berkat kerja sama yang baik antara aparat desa, Babinsa, dan Bhabinkamtibmas.</p>', 
        'berita2.jpg', 
        '2026-05-22', 
        'Suryono'
      ]
    ];

    const stmt = await db.prepare('INSERT INTO berita VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const b of seedBerita) {
      await stmt.run(b);
    }
    await stmt.finalize();
  }

  // F. Seed Surat (Riwayat Awal)
  const countSurat = await db.get('SELECT COUNT(*) AS total FROM surat');
  if (countSurat.total === 0) {
    console.log('Menyuntikkan data benih pengajuan surat default...');
    const skuKeterangan = {
      nama_usaha: 'Toko Kelontong "Sumber Rejeki"',
      jenis_usaha: 'Perdagangan Sembako',
      alamat_usaha: 'Blok Desa RT 01 RW 01 Desa Ujunggebang',
      keperluan: 'Pengajuan Modal Usaha ke Bank BRI'
    };
    const domKeterangan = {
      keperluan: 'Persyaratan Pendaftaran Beasiswa Kuliah'
    };

    await db.run(
      'INSERT INTO surat VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      'SRT-000001', '3212010101800001', 'Budi Santoso', 'Surat Keterangan Usaha (SKU)', '2026-05-20', 'Disetujui', 'Dokumen lengkap dan usaha terverifikasi.', JSON.stringify(skuKeterangan)
    );
    await db.run(
      'INSERT INTO surat VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      'SRT-000002', '3212010606990006', 'Muhammad Yusuf', 'Surat Keterangan Domisili', '2026-05-22', 'Diverifikasi Sekdes', 'Data sesuai dengan KK aktif.', JSON.stringify(domKeterangan)
    );
  }

  // G. Seed Pengaduan (Riwayat Awal)
  const countPengaduan = await db.get('SELECT COUNT(*) AS total FROM pengaduan');
  if (countPengaduan.total === 0) {
    console.log('Menyuntikkan data benih laporan pengaduan default...');
    await db.run(
      'INSERT INTO pengaduan VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'LAP-000001', '3212010101800001', 'Budi Santoso', 'Jalan Rusak Parah di Blok Desa', 'Infrastruktur', 'Jalanan di Blok Desa RT 01 mengalami kerusakan yang cukup parah setelah musim hujan. Banyak lubang besar yang membahayakan pengendara motor, terutama saat malam hari. Mohon perhatian dari pemerintah desa.', '2026-05-18', 'Diproses', 'Terima kasih atas laporan Bapak Budi. Anggaran pemeliharaan jalan desa sudah dianggarkan pada APBDes triwulan ini. Tim pembangunan desa akan berkoordinasi untuk mulai melakukan penambalan jalan pada minggu depan.', 'Andi Wijaya (Staff)', '2026-05-19'
    );
    await db.run(
      'INSERT INTO pengaduan VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'LAP-000002', '3212010606990006', 'Muhammad Yusuf', 'Lampu Penerangan Jalan Mati di Dekat Masjid Al-Ikhlas', 'Fasilitas Umum', 'Sudah 3 hari lampu jalan di gang dekat Masjid Al-Ikhlas padam. Suasana jalan menjadi sangat gelap gulita di malam hari, membuat warga khawatir akan keamanan sekitar. Mohon segera diperbaiki.', '2026-05-24', 'Pending', '', '', ''
    );
  }

  // H. Seed Keuangan (APBDes 2026)
  const countKeuangan = await db.get('SELECT COUNT(*) AS total FROM keuangan');
  if (countKeuangan.total === 0) {
    console.log('Menyuntikkan data benih keuangan APBDes default...');
    const seedKeuangan = [
      // PENDAPATAN
      [2026, 'Pendapatan', 'Dana Desa (DD)', 1200000000, 1200000000],
      [2026, 'Pendapatan', 'Alokasi Dana Desa (ADD)', 450000000, 450000000],
      [2026, 'Pendapatan', 'Bagi Hasil Pajak & Retribusi', 80000000, 75000000],
      [2026, 'Pendapatan', 'Pendapatan Asli Desa (PADes)', 60000000, 58000000],
      // BELANJA
      [2026, 'Belanja', 'Penyelenggaraan Pemerintahan', 520000000, 518000000],
      [2026, 'Belanja', 'Pembangunan Infrastruktur', 850000000, 842000000],
      [2026, 'Belanja', 'Pembinaan Kemasyarakatan', 180000000, 175000000],
      [2026, 'Belanja', 'Pemberdayaan Masyarakat', 210000000, 205000000],
      [2026, 'Belanja', 'Penanggulangan Bencana & Darurat', 30000000, 30000000],
      // PEMBIAYAAN
      [2026, 'Pembiayaan', 'SILPA Tahun Sebelumnya', 45000000, 45000000]
    ];

    const stmt = await db.prepare('INSERT INTO keuangan (tahun, kategori, sub_kategori, anggaran, realisasi) VALUES (?, ?, ?, ?, ?)');
    for (const k of seedKeuangan) {
      await stmt.run(k);
    }
    await stmt.finalize();
    console.log('Data benih keuangan APBDes berhasil disuntikkan!');
  }

  // I. Seed Kategori Bawaan
  const countCategories = await db.get('SELECT COUNT(*) AS total FROM categories');
  if (countCategories.total === 0) {
    console.log('Menyuntikkan data benih kategori default...');
    const seedCategories = [
      // Berita
      ['Kegiatan Desa', 'berita'],
      ['Pengumuman', 'berita'],
      ['Pertanian', 'berita'],
      ['Kesehatan', 'berita'],
      ['Teknologi & Informasi', 'berita'],
      // Pengaduan
      ['Infrastruktur', 'pengaduan'],
      ['Fasilitas Umum', 'pengaduan'],
      ['Keamanan', 'pengaduan'],
      ['Bantuan Sosial', 'pengaduan'],
      ['Layanan Desa', 'pengaduan'],
      ['Lain-lain', 'pengaduan'],
      // Keuangan Pendapatan
      ['Dana Desa (DD)', 'keuangan_pendapatan'],
      ['Alokasi Dana Desa (ADD)', 'keuangan_pendapatan'],
      ['Bagi Hasil Pajak & Retribusi', 'keuangan_pendapatan'],
      ['Pendapatan Asli Desa (PADes)', 'keuangan_pendapatan'],
      // Keuangan Belanja
      ['Penyelenggaraan Pemerintahan', 'keuangan_belanja'],
      ['Pembangunan Infrastruktur', 'keuangan_belanja'],
      ['Pembinaan Kemasyarakatan', 'keuangan_belanja'],
      ['Pemberdayaan Masyarakat', 'keuangan_belanja'],
      ['Penanggulangan Bencana & Darurat', 'keuangan_belanja'],
      // Keuangan Pembiayaan
      ['SILPA Tahun Sebelumnya', 'keuangan_pembiayaan']
    ];

    const stmt = await db.prepare('INSERT INTO categories (nama, tipe) VALUES (?, ?)');
    for (const c of seedCategories) {
      await stmt.run(c);
    }
    await stmt.finalize();
    console.log('Data benih kategori berhasil disuntikkan!');
  }

  console.log('Inisialisasi basis data relasional SQLite berhasil diselesaikan!');
};

// Query wrapper pembantu demi mempermudah operasi di kontroler
const all = async (sql, params = []) => {
  return await db.all(sql, params);
};

const get = async (sql, params = []) => {
  return await db.get(sql, params);
};

const run = async (sql, params = []) => {
  return await db.run(sql, params);
};

module.exports = {
  initDatabase,
  all,
  get,
  run
};
