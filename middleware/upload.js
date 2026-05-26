const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Pastikan direktori public/uploads ada
const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const attendanceDir = path.join(__dirname, '../public/uploads/attendance');
if (!fs.existsSync(attendanceDir)) {
  fs.mkdirSync(attendanceDir, { recursive: true });
}

// Konfigurasi Penyimpanan Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'absen_foto') return cb(null, attendanceDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    // Beri prefix sesuai field name agar mudah dikenali
    const prefix = file.fieldname === 'gambar' ? 'berita-' : (file.fieldname === 'absen_foto' ? 'attendance-' : 'logo-');
    cb(null, prefix + uniqueSuffix + ext);
  }
});

// Filter jenis file (hanya gambar)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Jenis file tidak didukung! Hanya gambar (.jpeg, .jpg, .png, .gif, .webp) yang diperbolehkan.'), false);
  }
};

// Batasan ukuran file (maksimal 5MB untuk berita, 2MB untuk logo)
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

module.exports = upload;
