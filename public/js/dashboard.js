// Modal Handler
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

// Client-side Table Search / Filter
function filterTable(inputId, tableId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const filter = input.value.toLowerCase().trim();
  const table = document.getElementById(tableId);
  if (!table) return;

  const rows = table.getElementsByTagName('tr');

  // Loop through all table rows, skip the table headers
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    let found = false;
    const cells = row.getElementsByTagName('td');
    
    for (let j = 0; j < cells.length; j++) {
      const cellText = cells[j].textContent || cells[j].innerText;
      if (cellText.toLowerCase().indexOf(filter) > -1) {
        found = true;
        break;
      }
    }

    if (found) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  }
}

// Populate Edit Penduduk Modal
function editPendudukModal(pDataString) {
  try {
    const p = JSON.parse(pDataString);
    
    // Set form values
    document.getElementById('edit_old_nik').value = p.nik;
    document.getElementById('edit_nik').value = p.nik;
    document.getElementById('edit_nama').value = p.nama;
    document.getElementById('edit_no_kk').value = p.no_kk;
    document.getElementById('edit_tempat_lahir').value = p.tempat_lahir;
    document.getElementById('edit_tanggal_lahir').value = p.tanggal_lahir;
    document.getElementById('edit_gender').value = p.gender;
    document.getElementById('edit_alamat').value = p.alamat;
    document.getElementById('edit_dusun').value = p.dusun;
    document.getElementById('edit_agama').value = p.agama;
    document.getElementById('edit_status_kawin').value = p.status_kawin;
    document.getElementById('edit_pekerjaan').value = p.pekerjaan;
    document.getElementById('edit_pendidikan').value = p.pendidikan;
    
    openModal('editPendudukModal');
  } catch (error) {
    console.error('Gagal mem-parsing data penduduk:', error);
  }
}

// Populate Approval Modal for Surat
function openApprovalModal(suratId, currentStatus, currentCatatan) {
  document.getElementById('approval_id').value = suratId;
  document.getElementById('approval_status').value = currentStatus;
  document.getElementById('approval_catatan').value = currentCatatan || '';
  
  openModal('approvalModal');
}

// Populate Tanggapan Modal for Pengaduan
function openTanggapanModal(pengaduanId, currentStatus, currentTanggapan) {
  document.getElementById('tanggapan_id').value = pengaduanId;
  document.getElementById('tanggapan_status').value = currentStatus;
  document.getElementById('tanggapan_isi').value = currentTanggapan || '';
  
  openModal('tanggapanModal');
}

// Populate Edit Berita Modal
function openEditBeritaModal(beritaString) {
  try {
    const b = JSON.parse(beritaString);
    
    document.getElementById('edit_berita_id').value = b.id;
    document.getElementById('edit_berita_judul').value = b.judul;
    document.getElementById('edit_berita_kategori').value = b.kategori;
    document.getElementById('edit_berita_ringkasan').value = b.ringkasan;
    document.getElementById('edit_berita_konten').value = b.konten;

    // Reset checkbox hapus foto
    const hapusCheckbox = document.getElementById('edit_hapus_gambar');
    if (hapusCheckbox) hapusCheckbox.checked = false;

    // Tampilkan foto saat ini jika ada
    const fotoCurrentWrap = document.getElementById('edit_foto_current');
    const fotoCurrentImg = document.getElementById('edit_foto_current_img');
    const fotoPreviewWrap = document.getElementById('edit_foto_preview_wrap');
    const fotoPreviewImg = document.getElementById('edit_foto_preview');
    const gambarInput = document.getElementById('edit_gambar');

    // Reset preview foto baru
    if (fotoPreviewWrap) fotoPreviewWrap.style.display = 'none';
    if (fotoPreviewImg) fotoPreviewImg.src = '';
    if (gambarInput) gambarInput.value = '';

    if (b.gambar && b.gambar !== 'berita_default.jpg' && fotoCurrentWrap && fotoCurrentImg) {
      fotoCurrentImg.src = '/uploads/' + b.gambar;
      fotoCurrentWrap.style.display = 'block';
    } else if (fotoCurrentWrap) {
      fotoCurrentWrap.style.display = 'none';
    }

    // Populate embed URL dan tampilkan preview jika ada
    const embedInput = document.getElementById('edit_embed_url');
    const embedFrameWrap = document.getElementById('edit_embed_frame_wrap');
    const embedFrame = document.getElementById('edit_embed_frame');
    if (embedInput) embedInput.value = b.embed_url || '';
    if (b.embed_url && b.embed_url.trim() !== '') {
      const embedSrc = parseYoutubeUrl(b.embed_url);
      if (embedFrame) embedFrame.src = embedSrc;
      if (embedFrameWrap) embedFrameWrap.style.display = 'block';
    } else {
      if (embedFrame) embedFrame.src = '';
      if (embedFrameWrap) embedFrameWrap.style.display = 'none';
    }
    
    openModal('editBeritaModal');
  } catch (error) {
    console.error('Gagal mem-parsing data berita:', error);
  }
}

// Helper: preview foto sebelum upload
function previewFoto(input, previewId, wrapId) {
  const wrap = document.getElementById(wrapId);
  const preview = document.getElementById(previewId);
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      wrap.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    wrap.style.display = 'none';
    preview.src = '';
  }
}

// Helper: toggle hapus foto lama
function toggleHapusFoto(checkbox) {
  const previewWrap = document.getElementById('edit_foto_preview_wrap');
  const fileInput = document.getElementById('edit_gambar');
  if (checkbox.checked) {
    if (previewWrap) previewWrap.style.display = 'none';
    if (fileInput) { fileInput.value = ''; fileInput.disabled = true; }
  } else {
    if (fileInput) fileInput.disabled = false;
  }
}

// Helper: parse URL YouTube ke format embed
function parseYoutubeUrl(url) {
  if (!url) return '';
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  return url;
}

// Helper: preview iframe embed saat URL diketik
function previewEmbed(rawUrl, wrapId, frameId) {
  const wrap = document.getElementById(wrapId);
  const frame = document.getElementById(frameId);
  if (!wrap || !frame) return;
  const embedUrl = parseYoutubeUrl(rawUrl.trim());
  if (embedUrl && embedUrl.length > 10) {
    frame.src = embedUrl;
    wrap.style.display = 'block';
  } else {
    frame.src = '';
    wrap.style.display = 'none';
  }
}

// Print Handler for official documents
function printDocument() {
  window.print();
}

// DOM Setup
document.addEventListener('DOMContentLoaded', () => {
  // Fade out alerts after 5 seconds
  const alerts = document.querySelectorAll('.alert');
  alerts.forEach((alert) => {
    setTimeout(() => {
      alert.style.transition = 'opacity 0.5s ease';
      alert.style.opacity = '0';
      setTimeout(() => {
        alert.remove();
      }, 500);
    }, 5000);
  });
});
