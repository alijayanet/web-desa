# Web Desa Digital

Repo: https://github.com/alijayanet/web-desa

Web Desa Digital adalah aplikasi layanan dan manajemen desa berbasis web (Node.js + Express + EJS + SQLite). Aplikasi ini menyediakan portal publik untuk transparansi informasi desa dan portal dashboard untuk perangkat desa serta warga.

## Fitur Utama

### Website Publik
- Beranda + statistik ringkas (penduduk, surat selesai, pengaduan selesai, dusun).
- Profil desa + struktur organisasi (dinamis dari pengaturan).
- Berita & kegiatan desa.
- Keuangan APBDes (transparansi dari data SQLite).
- Navbar link eksternal dinamis (bisa diatur admin).

### Portal Dashboard (RBAC)
- Login/Logout, registrasi warga berbasis NIK (penduduk terdaftar).
- Manajemen penduduk (staff/sekdes).
- Pengajuan surat online (warga).
- Kelola & approval surat (staff/sekdes/kades/kuwu sesuai role yang dipakai).
- Cetak surat.
- Pengaduan warga + pengelolaan status pengaduan.
- Manajemen berita, kategori, keuangan, pegawai.
- Pengaturan profil desa (nama, alamat, logo, sebutan kades/kuwu, nav links, struktur organisasi, WhatsApp recipients).

### WhatsApp Bot (Baileys)
- Status koneksi + QR scan dari dashboard.
- Perintah warga (menu, daftar/login, pengajuan surat, cek status, cek APBDes).
- Notifikasi ke admin/staff (nomor utama + daftar penerima tambahan) untuk pengajuan surat/pengaduan.

### Absensi Perangkat Desa (Scan Wajah + Geo Tagging)
- Absensi masuk/pulang menggunakan foto (kamera/unggah) untuk staff/sekdes/kades/kuwu.
- Geo-tagging wajib saat absen (lat/lng/akurasi).
- Validasi radius kantor: absen ditolak jika di luar area kantor (radius diatur pada pengaturan).
- Laporan absensi (monitor) untuk sekdes/kades/kuwu, menampilkan data + foto (tanpa form absen).
- Notifikasi WhatsApp setiap ada absen masuk/pulang (ke nomor penerima pengaturan).

## Teknologi
- Backend: Node.js, Express
- View: EJS
- DB: SQLite (sqlite + sqlite3)
- Upload file: Multer
- Session: express-session
- WhatsApp: @whiskeysockets/baileys, pino
- QR PNG: qrcode

## Struktur Folder Singkat
- `server.js` : entrypoint aplikasi + route
- `controllers/` : controller fitur (dashboard, surat, pengaduan, absensi, auth)
- `services/` : WhatsApp bot
- `views/` : template EJS (publik + dashboard)
- `public/` : asset statis (css/js) + `uploads/`
- `data/desa.db` : database SQLite

## Instalasi & Menjalankan

### Prasyarat
- Node.js (disarankan versi LTS)

### Langkah
1. Install dependency:
   ```bash
   npm install
   ```
2. Jalankan aplikasi:
   ```bash
   npm run dev
   ```
3. Buka:
   - http://localhost:3000

Catatan: database akan diinisialisasi otomatis saat server pertama kali dijalankan.

## Konfigurasi Environment (.env)

Contoh variabel yang dipakai aplikasi:
- `PORT=3000`
- `SESSION_SECRET=...`
- `WA_BOT_ENABLED=1` (aktifkan bot WhatsApp)
- `APP_BASE_URL=https://domain-anda.com` (untuk link yang dibagikan via WhatsApp)

## Pengaturan Penting di Dashboard

### Setting Penerima Notifikasi WhatsApp
Atur di menu Pengaturan:
- `NOMOR WHATSAPP (UNTUK KONTAK & NOTIF)` (utama)
- `PENERIMA NOTIF WHATSAPP (STAFF/ADMIN)` (tambahan)

### Setting Lokasi Kantor (untuk Geo-tagging Absensi)
Atur di menu Pengaturan:
- `LATITUDE KANTOR`
- `LONGITUDE KANTOR`
- `RADIUS AREA (METER)`

Jika lokasi kantor belum diatur, absensi akan ditolak.

## Catatan Keamanan
- Jangan commit `.env` ke repo publik.
- Setelah deploy, pastikan mengganti `SESSION_SECRET`.
- Jika ada akun/seed awal untuk kebutuhan demo, ganti passwordnya untuk produksi.

## Lisensi
MIT

