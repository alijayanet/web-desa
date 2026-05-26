const db = require('./db');
const path = require('path');
const fs = require('fs');

// Helper: Ekstrak embed URL YouTube menjadi format yang bisa di-embed
const parseEmbedUrl = (url) => {
  if (!url || url.trim() === '') return '';
  
  // YouTube: youtube.com/watch?v=ID → youtube.com/embed/ID
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `https://www.youtube.com/embed/${ytMatch[1]}`;
  }
  
  // Jika sudah format embed langsung, kembalikan apa adanya
  if (url.includes('/embed/') || url.includes('player.vimeo.com')) {
    return url;
  }
  
  // URL lain dikembalikan apa adanya (pengguna tahu yang mereka masukkan)
  return url.trim();
};

// Render Halaman Kelola Berita (Akses: Staff, Sekdes, Kades)
const renderBeritaKelola = async (req, res) => {
  const { role } = req.session.user;

  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  try {
    const settings = await db.get('SELECT * FROM pengaturan WHERE id = 1');
    const berita = await db.all('SELECT * FROM berita ORDER BY id DESC');
    const kategoriList = await db.all('SELECT * FROM categories WHERE tipe = "berita" ORDER BY nama ASC');

    res.render('dashboard/berita', {
      settings,
      user: req.session.user,
      berita,
      kategoriList,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error saat memuat berita kelola:', error);
    res.status(500).send('Kesalahan server.');
  }
};

// Tambah Berita Baru (Akses: Staff, Sekdes, Kades)
const createBerita = async (req, res) => {
  const { role, nama } = req.session.user;

  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { judul, kategori, ringkasan, konten, embed_url } = req.body;
  if (!judul || !kategori || !ringkasan || !konten) {
    return res.redirect('/dashboard/berita?error=missing_fields');
  }

  try {
    // Generate ID berita baru
    const lastBerita = await db.get('SELECT id FROM berita ORDER BY id DESC LIMIT 1');
    let lastId = 0;
    if (lastBerita && lastBerita.id) {
      lastId = parseInt(lastBerita.id.split('-')[1]) || 0;
    }
    const newId = `BRT-${String(lastId + 1).padStart(6, '0')}`;

    // Tentukan nama file gambar
    let gambarFilename = 'berita_default.jpg';
    if (req.file) {
      gambarFilename = req.file.filename;
    }

    // Parse embed URL
    const cleanEmbedUrl = parseEmbedUrl(embed_url || '');

    const newArticle = {
      id: newId,
      judul: judul.trim(),
      kategori,
      ringkasan: ringkasan.trim(),
      konten: konten.trim(),
      gambar: gambarFilename,
      tanggal: new Date().toISOString().split('T')[0],
      penulis: nama,
      embed_url: cleanEmbedUrl
    };

    await db.run(
      'INSERT INTO berita (id, judul, kategori, ringkasan, konten, gambar, tanggal, penulis, embed_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newArticle.id, newArticle.judul, newArticle.kategori, newArticle.ringkasan, newArticle.konten, newArticle.gambar, newArticle.tanggal, newArticle.penulis, newArticle.embed_url]
    );

    res.redirect('/dashboard/berita?success=created');
  } catch (error) {
    console.error('Error saat membuat berita baru:', error);
    res.redirect('/dashboard/berita?error=server_error');
  }
};

// Edit Berita (Akses: Staff, Sekdes, Kades)
const updateBerita = async (req, res) => {
  const { role } = req.session.user;

  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id, judul, kategori, ringkasan, konten, embed_url, hapus_gambar } = req.body;
  
  try {
    const exist = await db.get('SELECT * FROM berita WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/berita?error=notfound');
    }

    // Tentukan gambar yang dipakai
    let gambarFilename = exist.gambar;
    
    if (hapus_gambar === '1') {
      // Hapus gambar lama dari disk jika bukan default
      if (exist.gambar && exist.gambar !== 'berita_default.jpg') {
        const oldPath = path.join(__dirname, '../public/uploads', exist.gambar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      gambarFilename = 'berita_default.jpg';
    }
    
    if (req.file) {
      // Hapus gambar lama jika ada dan bukan default
      if (exist.gambar && exist.gambar !== 'berita_default.jpg') {
        const oldPath = path.join(__dirname, '../public/uploads', exist.gambar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      gambarFilename = req.file.filename;
    }

    // Parse embed URL
    const cleanEmbedUrl = parseEmbedUrl(embed_url || '');

    await db.run(
      'UPDATE berita SET judul = ?, kategori = ?, ringkasan = ?, konten = ?, gambar = ?, embed_url = ? WHERE id = ?',
      [judul.trim(), kategori, ringkasan.trim(), konten.trim(), gambarFilename, cleanEmbedUrl, id]
    );

    res.redirect('/dashboard/berita?success=updated');
  } catch (error) {
    console.error('Error saat memperbarui berita:', error);
    res.redirect('/dashboard/berita?error=server_error');
  }
};

// Hapus Berita (Akses: Staff, Sekdes, Kades)
const deleteBerita = async (req, res) => {
  const { role } = req.session.user;

  if (role !== 'staff' && role !== 'sekdes' && role !== 'kades') {
    return res.redirect('/dashboard?error=unauthorized');
  }

  const { id } = req.params;
  
  try {
    const exist = await db.get('SELECT * FROM berita WHERE id = ?', [id]);
    if (!exist) {
      return res.redirect('/dashboard/berita?error=notfound');
    }

    // Hapus file gambar dari disk jika bukan default
    if (exist.gambar && exist.gambar !== 'berita_default.jpg') {
      const imgPath = path.join(__dirname, '../public/uploads', exist.gambar);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await db.run('DELETE FROM berita WHERE id = ?', [id]);
    res.redirect('/dashboard/berita?success=deleted');
  } catch (error) {
    console.error('Error saat menghapus berita:', error);
    res.redirect('/dashboard/berita?error=server_error');
  }
};

module.exports = {
  renderBeritaKelola,
  createBerita,
  updateBerita,
  deleteBerita
};
