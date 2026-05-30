# PT. Inti Atap Suksesindo — Website

Website resmi **intiatap.com** — Supplier bahan bangunan atap terlengkap di Tangerang, sejak 2011.

---

## Cara Menjalankan

```bash
npm install
npm start
```

Buka browser di `http://localhost:3000`

---

## URL Penting

| Halaman       | URL                              |
|---------------|----------------------------------|
| Website       | `http://localhost:3000`          |
| Dokumen       | `http://localhost:3000/dokumen`  |
| Panel Admin   | `http://localhost:3000/admin`    |

**Kata sandi admin default:** `intiatap2024`

Ganti kata sandi dengan environment variable saat menjalankan server:
```bash
ADMIN_PASSWORD=kataSandiBaruKamu npm start
```

---

## Setup Fonnte (OTP WhatsApp)

Halaman Dokumen memerlukan verifikasi OTP via WhatsApp. Tanpa Fonnte, kode OTP akan tampil di terminal (mode dev). Untuk produksi, ikuti langkah berikut:

### Langkah 1 — Daftar akun Fonnte
Buka [fonnte.com](https://fonnte.com) → Register → verifikasi email.

> **Biaya:** sekitar Rp 250–300 per pesan WhatsApp. Top up via transfer bank (minimum Rp 10.000).

### Langkah 2 — Hubungkan WhatsApp
1. Login ke dashboard Fonnte
2. Klik **"Add Device"**
3. Scan QR code yang muncul menggunakan aplikasi WhatsApp di HP
4. Sama seperti WhatsApp Web — HP harus tetap online dan terhubung internet

### Langkah 3 — Ambil API Token
1. Di dashboard Fonnte → klik nama device
2. Copy **Token** (panjang string acak)

### Langkah 4 — Jalankan server dengan token
```bash
FONNTE_TOKEN=token_kamu_disini npm start
```

Atau set keduanya sekaligus:
```bash
FONNTE_TOKEN=abc123xxxyyy ADMIN_PASSWORD=passwordBaru npm start
```

---

## Struktur Folder

```
intiatap/
├── server.js              — Node.js server (API + static files)
├── package.json
├── data/
│   ├── products.json      — Data produk (dikelola via admin panel)
│   └── documents.json     — Data dokumen (dikelola via admin panel)
├── uploads/               — Foto produk yang diupload admin
├── docs/                  — File PDF dokumen (TIDAK bisa diakses publik langsung)
├── public/
│   ├── index.html         — Website utama
│   ├── dokumen.html       — Halaman unduh dokumen (OTP protected)
│   ├── css/style.css
│   ├── js/main.js
│   ├── images/
│   │   ├── hero/          — Foto untuk hero section
│   │   └── products/      — Foto ilustrasi produk dari brosur
│   └── admin/
│       └── index.html     — Panel admin
└── references/            — Brosur PDF referensi (tidak di-deploy)
```

---

## Panel Admin

Buka `http://localhost:3000/admin` → masukkan kata sandi.

**Tab Produk:**
- Lihat semua produk dalam grid
- Klik **Edit** untuk ubah nama, kategori, deskripsi, atau upload foto baru
- Klik **+ Tambah Produk Baru** untuk produk baru

**Tab Dokumen:**
- Upload file PDF baru (maks. 50MB)
- Atur judul dan keterangan dokumen
- Hapus dokumen yang tidak diperlukan

---

## Catatan Penting

- Folder `docs/` **tidak bisa diakses langsung** dari browser — hanya bisa diunduh setelah verifikasi OTP
- Token OTP berlaku **5 menit** setelah dikirim
- Link unduhan berlaku **10 menit** setelah OTP diverifikasi (sekali pakai)
- Maksimal 3 percobaan salah OTP sebelum harus minta kode baru
- Foto produk di-upload ke folder `uploads/` dan bisa diakses publik
