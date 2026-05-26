# Web Desa Digital

Repo: https://github.com/alijayanet/web-desa

Platform layanan dan manajemen desa berbasis web dengan portal publik (transparansi) dan dashboard (operasional) untuk perangkat desa serta warga.

## Ringkas

**Stack**
- Node.js + Express
- EJS (server-rendered)
- SQLite (sqlite + sqlite3)
- Multer (upload)
- express-session (session)
- WhatsApp bot (Baileys) + QR PNG (qrcode)

**Modul**
| Modul | Ringkasan |
|---|---|
| Publik | Beranda, profil desa, berita, transparansi APBDes, navbar link eksternal dinamis |
| Kependudukan | Manajemen penduduk + import/export CSV |
| Surat | Pengajuan warga, verifikasi & approval, cetak surat |
| Pengaduan | Pengajuan warga + tindak lanjut perangkat |
| WhatsApp | QR scan, perintah warga, notifikasi admin/staff |
| Absensi | Absen masuk/pulang berbasis foto + geo-tagging + radius kantor + notifikasi |

## Role & Akses

- **warga**: pengajuan surat, pengaduan, profil saya
- **staff**: penduduk, surat kelola, pengaduan kelola, berita, keuangan, kategori, absen saya
- **sekdes / kades / kuwu**: monitoring & approval (lebih luas), pengaturan desa, laporan absensi

## Cara Menjalankan (Local)

1. Install dependency
   ```bash
   npm install
   ```
2. Jalankan server
   ```bash
   npm run dev
   ```
3. Buka
   - http://localhost:3000

Database SQLite akan diinisialisasi otomatis saat server pertama kali dijalankan.

## Konfigurasi (.env)

Contoh:
```env
PORT=3000
SESSION_SECRET=isi_dengan_random_yang_panjang
WA_BOT_ENABLED=1
APP_BASE_URL=https://domain-anda.com
```

Keterangan:
- `WA_BOT_ENABLED=1` mengaktifkan WhatsApp bot
- `APP_BASE_URL` dipakai untuk membuat link yang dikirim lewat WhatsApp (supaya tidak localhost)

## Pengaturan Penting (Dashboard)

### WhatsApp (Notifikasi)
Menu: Dashboard → Pengaturan Profil Desa
- Nomor WhatsApp utama: `whatsapp`
- Penerima tambahan: `wa_recipients` (maks 10 nomor)

### Absensi (Geo-Tagging)
Menu: Dashboard → Pengaturan Profil Desa
- `office_lat` / `office_lng`: koordinat kantor desa
- `office_radius_m`: radius validasi (meter)

Jika lokasi kantor belum diatur, absensi ditolak.

## Kependudukan: Import / Export CSV

Menu: Dashboard → Penduduk
- **Export**: download `penduduk-YYYY-MM-DD.csv`
- **Import**: upload CSV, sistem akan:
  - insert jika NIK belum ada
  - update jika NIK sudah ada
  - skip jika baris tidak valid

Header yang didukung:
`nik,nama,no_kk,tempat_lahir,tanggal_lahir,gender,alamat,dusun,agama,status_kawin,pekerjaan,pendidikan,no_hp`

Minimal wajib ada: `nik,nama`

## WhatsApp Bot

Menu: Dashboard → WhatsApp Bot
- Scan QR untuk menghubungkan nomor WhatsApp
- Perintah warga tersedia (menu, daftar/login, surat, status, apbdes, keluar)
- Notifikasi admin/staff untuk pengajuan surat/pengaduan dan event absensi

## Absensi Perangkat

Menu:
- **Absen**: Dashboard → Absensi (foto + lokasi wajib)
- **Laporan**: Dashboard → Laporan Absensi (monitoring untuk sekdes/kades/kuwu)

Catatan:
- Foto tersimpan di `public/uploads/attendance` dan aksesnya diproteksi (wajib login).
- Saat absen, lokasi (lat/lng/akurasi) disimpan dan divalidasi terhadap radius kantor.

## Struktur Proyek

- `server.js` : routing + middleware
- `controllers/` : fitur dashboard, surat, pengaduan, absensi, auth
- `services/` : WhatsApp bot
- `views/` : EJS publik + dashboard
- `public/` : CSS/JS + `uploads/`
- `data/desa.db` : database SQLite

## Keamanan

- Jangan commit `.env` ke repo publik.
- Pastikan `SESSION_SECRET` diganti untuk produksi.

## Lisensi

MIT
