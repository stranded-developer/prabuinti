if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'intiatap2024';
const FONNTE_TOKEN   = process.env.FONNTE_TOKEN    || '';
const JWT_SECRET     = ADMIN_PASSWORD;

function b64u(s) { return Buffer.from(s).toString('base64url'); }
function signJwt() {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}
function verifyJwt(token) {
  try {
    const [h, p, s] = (token || '').split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
    if (s !== expected) return false;
    const { exp } = JSON.parse(Buffer.from(p, 'base64url').toString());
    return exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

// ============================================================
// Firebase — optional. Falls back to local JSON files in dev.
// Set FIREBASE_PRIVATE_KEY env var to activate.
// ============================================================
let _db = null, _bucket = null;

if (process.env.FIREBASE_PRIVATE_KEY) {
  try {
    const admin = require('firebase-admin');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    const { getFirestore } = require('firebase-admin/firestore');
    _db     = getFirestore(admin.app(), '-default-');
    _bucket = admin.storage().bucket();
    console.log('  Firebase: Firestore + Storage aktif');
  } catch (e) {
    console.error('  Firebase init error:', e.message, e.stack);
  }
}

const USE_FB = !!_db;

// ============================================================
// Local file paths (dev fallback when Firebase not configured)
// ============================================================
const PRODUCTS_FILE  = path.join(__dirname, 'data', 'products.json');
const DOCUMENTS_FILE = path.join(__dirname, 'data', 'documents.json');
const HOMEPAGE_FILE  = path.join(__dirname, 'data', 'homepage.json');
const UPLOADS_DIR    = path.join(__dirname, 'uploads');
const DOCS_DIR       = path.join(__dirname, 'docs');

['data', 'uploads', 'docs'].forEach(d => {
  try { if (!fs.existsSync(path.join(__dirname, d))) fs.mkdirSync(path.join(__dirname, d), { recursive: true }); } catch {}
});

const readLocalJSON  = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeLocalJSON = (f, d) => { try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch {} };

// Ensure homepage.json exists locally
if (!fs.existsSync(HOMEPAGE_FILE)) {
  writeLocalJSON(HOMEPAGE_FILE, {
    heroImages: [
      '/images/hero/kokoh_cover-01.png',
      '/images/hero/alderon_cover-1.png',
      '/images/hero/alderon_innovation-2.png',
      '/images/hero/alderon_warehouse-4.png',
      '/images/hero/fiberled_factory-1.png',
      '/images/hero/kokoh_colors-09.png',
    ],
    alderonImage: '/images/hero/alderon_warehouse-4.png',
    portfolio: [
      { image: '', title: 'Gudang Konstruksi' },
      { image: '', title: 'Bangunan Masjid' },
      { image: '', title: 'Bangunan Gudang' },
    ],
  });
}

// ============================================================
// Firebase helpers
// ============================================================
async function fbUploadFile(buffer, mimetype, folder, ext, isPublic = true) {
  const filename = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
  const file = _bucket.file(folder + '/' + filename);
  if (isPublic) {
    const token = crypto.randomUUID();
    await file.save(buffer, { metadata: { contentType: mimetype, metadata: { firebaseStorageDownloadTokens: token } } });
    const url = `https://firebasestorage.googleapis.com/v0/b/${_bucket.name}/o/${encodeURIComponent(folder + '/' + filename)}?alt=media&token=${token}`;
    return { filename, url };
  }
  await file.save(buffer, { metadata: { contentType: mimetype } });
  return { filename, url: null };
}

async function fbDeleteFile(folder, filename) {
  try { await _bucket.file(folder + '/' + filename).delete(); } catch {}
}

async function fbSignedUrl(folder, filename, expiresMs) {
  const [url] = await _bucket.file(folder + '/' + filename).getSignedUrl({
    action:  'read',
    expires: expiresMs,
  });
  return url;
}

// Seed Firestore from local JSON on first cold start (runs once when collection empty)
async function seedFirestore() {
  try {
    const productsSnap = await _db.collection('products').limit(1).get();
    if (productsSnap.empty) {
      const products = readLocalJSON(PRODUCTS_FILE) || [];
      if (products.length) {
        const batch = _db.batch();
        products.forEach(p => batch.set(_db.collection('products').doc(String(p.id)), p));
        await batch.commit();
        console.log(`  Firestore: seeded ${products.length} products`);
      }
    }

    const docsSnap = await _db.collection('documents').limit(1).get();
    if (docsSnap.empty) {
      const docs = readLocalJSON(DOCUMENTS_FILE) || [];
      if (docs.length) {
        const batch = _db.batch();
        docs.forEach(d => batch.set(_db.collection('documents').doc(String(d.id)), d));
        await batch.commit();
        console.log(`  Firestore: seeded ${docs.length} documents`);
      }
    }

    const hpRef  = _db.collection('config').doc('homepage');
    const hpSnap = await hpRef.get();
    if (!hpSnap.exists) {
      const hp = readLocalJSON(HOMEPAGE_FILE);
      if (hp) { await hpRef.set(hp); console.log('  Firestore: seeded homepage'); }
    }
  } catch (e) {
    console.error('  Firestore seed error:', e.message);
  }
}

// ============================================================
// Auth
// ============================================================
function requireAuth(req, res, next) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token || !verifyJwt(token)) return res.status(401).json({ error: 'Tidak terotorisasi' });
  next();
}

// ============================================================
// Multer — memory storage so we can route to disk or Firebase
// ============================================================
const uploadImg = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, f, cb) => f.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Hanya gambar')),
});

const uploadPDF = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_, f, cb) => f.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Hanya PDF')),
});

// ============================================================
// OTP + Download tokens (in-memory, same in both modes)
// ============================================================
const otpStore       = new Map();
const downloadTokens = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries())       if (v.expires < now) otpStore.delete(k);
  for (const [k, v] of downloadTokens.entries()) if (v.expires < now) downloadTokens.delete(k);
}, 10 * 60 * 1000);

function normalizePhone(raw) {
  let p = raw.replace(/\D/g, '');
  if (p.startsWith('0'))   p = '62' + p.slice(1);
  if (!p.startsWith('62')) p = '62' + p;
  return p;
}

async function sendWhatsApp(phone, message) {
  if (!FONNTE_TOKEN) {
    console.log(`\n  [OTP DEV] ke ${phone}: ${message}\n`);
    return { ok: true, dev: true };
  }
  const form = new URLSearchParams({ target: phone, message, countryCode: '62', delay: '1', schedule: '0' });
  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: FONNTE_TOKEN },
    body: form,
  });
  return res.json();
}

// ============================================================
// Middleware
// ============================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
if (!USE_FB) app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/dokumen', (_, res) => res.sendFile(path.join(__dirname, 'public', 'dokumen.html')));
app.get('/admin',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

// ============================================================
// Auth routes
// ============================================================
app.post('/api/auth', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Kata sandi salah' });
  res.json({ token: signJwt() });
});

app.get('/api/verify', requireAuth, (_, res) => res.json({ ok: true }));

app.get('/api/status', (_, res) => res.json({
  firebase: USE_FB,
  env: {
    projectId:     !!process.env.FIREBASE_PROJECT_ID,
    clientEmail:   !!process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:    !!process.env.FIREBASE_PRIVATE_KEY,
    storageBucket: !!process.env.FIREBASE_STORAGE_BUCKET,
  },
}));

// ============================================================
// Products
// ============================================================
app.get('/api/products', async (_, res) => {
  try {
    if (USE_FB) {
      const snap = await _db.collection('products').orderBy('id').get();
      return res.json(snap.docs.map(d => d.data()));
    }
    res.json(readLocalJSON(PRODUCTS_FILE) || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', requireAuth, async (req, res) => {
  try {
    if (USE_FB) {
      const snap  = await _db.collection('products').get();
      const maxId = snap.empty ? 0 : Math.max(...snap.docs.map(d => d.data().id || 0));
      const item  = { id: maxId + 1, name: req.body.name || '', category: req.body.category || '', image: req.body.image || '', description: req.body.description || '' };
      await _db.collection('products').doc(String(item.id)).set(item);
      return res.status(201).json(item);
    }
    const list  = readLocalJSON(PRODUCTS_FILE) || [];
    const maxId = list.reduce((m, p) => Math.max(m, p.id), 0);
    const item  = { id: maxId + 1, name: req.body.name || '', category: req.body.category || '', image: req.body.image || '', description: req.body.description || '' };
    list.push(item);
    writeLocalJSON(PRODUCTS_FILE, list);
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      const ref  = _db.collection('products').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Produk tidak ditemukan' });
      const updated = { ...snap.data(), ...req.body, id };
      await ref.set(updated);
      return res.json(updated);
    }
    const list = readLocalJSON(PRODUCTS_FILE) || [];
    const idx  = list.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    list[idx] = { ...list[idx], ...req.body, id };
    writeLocalJSON(PRODUCTS_FILE, list);
    res.json(list[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      const ref  = _db.collection('products').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Produk tidak ditemukan' });
      const { image } = snap.data();
      if (image && image.includes('storage.googleapis.com')) {
        const parts = image.split('/');
        await fbDeleteFile(parts[parts.length - 2], parts[parts.length - 1]);
      }
      await ref.delete();
      return res.json({ ok: true });
    }
    let list = readLocalJSON(PRODUCTS_FILE) || [];
    const item = list.find(p => p.id === id);
    if (!item) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    if (item.image) { const f = path.join(UPLOADS_DIR, path.basename(item.image)); if (fs.existsSync(f)) fs.unlinkSync(f); }
    writeLocalJSON(PRODUCTS_FILE, list.filter(p => p.id !== id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Upload image
// ============================================================
app.post('/api/upload', requireAuth, uploadImg.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });
    if (USE_FB) {
      const ext = path.extname(req.file.originalname) || '.jpg';
      const { url } = await fbUploadFile(req.file.buffer, req.file.mimetype, 'uploads', ext);
      return res.json({ url });
    }
    const filename = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(req.file.originalname);
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    res.json({ url: '/uploads/' + filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Documents
// ============================================================
app.get('/api/documents', async (_, res) => {
  try {
    if (USE_FB) {
      const snap = await _db.collection('documents').orderBy('id').get();
      return res.json(snap.docs.map(d => {
        const { filename, ...pub } = d.data();
        return pub;
      }));
    }
    const list = readLocalJSON(DOCUMENTS_FILE) || [];
    res.json(list.map(({ id, title, description, size, uploadedAt }) => ({ id, title, description, size, uploadedAt })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/documents', requireAuth, uploadPDF.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file PDF' });
    const bytes = req.file.size;
    const size  = bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';

    if (USE_FB) {
      const snap  = await _db.collection('documents').get();
      const maxId = snap.empty ? 0 : Math.max(...snap.docs.map(d => d.data().id || 0));
      const { filename } = await fbUploadFile(req.file.buffer, 'application/pdf', 'docs', '.pdf', false);
      const item = { id: maxId + 1, title: req.body.title || req.file.originalname.replace('.pdf', ''), description: req.body.description || '', filename, size, uploadedAt: new Date().toISOString().slice(0, 10) };
      await _db.collection('documents').doc(String(item.id)).set(item);
      const { filename: _f, ...pub } = item;
      return res.status(201).json(pub);
    }

    const list     = readLocalJSON(DOCUMENTS_FILE) || [];
    const maxId    = list.reduce((m, d) => Math.max(m, d.id), 0);
    const diskFile = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(DOCS_DIR, diskFile), req.file.buffer);
    const item = { id: maxId + 1, title: req.body.title || req.file.originalname.replace('.pdf', ''), description: req.body.description || '', filename: diskFile, size, uploadedAt: new Date().toISOString().slice(0, 10) };
    list.push(item);
    writeLocalJSON(DOCUMENTS_FILE, list);
    const { filename: _f, ...pub } = item;
    res.status(201).json(pub);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      const ref  = _db.collection('documents').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
      await fbDeleteFile('docs', snap.data().filename);
      await ref.delete();
      return res.json({ ok: true });
    }
    let list = readLocalJSON(DOCUMENTS_FILE) || [];
    const item = list.find(d => d.id === id);
    if (!item) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    const f = path.join(DOCS_DIR, item.filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    writeLocalJSON(DOCUMENTS_FILE, list.filter(d => d.id !== id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin doc preview/download
app.get('/api/admin/docs/:id', (req, res, next) => {
  if (req.query.auth) req.headers['authorization'] = 'Bearer ' + req.query.auth;
  next();
}, requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      const snap = await _db.collection('documents').doc(String(id)).get();
      if (!snap.exists) return res.status(404).json({ error: 'Tidak ditemukan' });
      const item = snap.data();
      const url  = await fbSignedUrl('docs', item.filename, Date.now() + 10 * 60 * 1000);
      return res.redirect(url);
    }
    const list = readLocalJSON(DOCUMENTS_FILE) || [];
    const item = list.find(d => d.id === id);
    if (!item) return res.status(404).json({ error: 'Tidak ditemukan' });
    const f = path.join(DOCS_DIR, item.filename);
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'File tidak ada' });
    res.setHeader('Content-Disposition', `attachment; filename="${item.title}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// OTP
// ============================================================
app.post('/api/otp/send', async (req, res) => {
  try {
    const { phone, docId } = req.body;
    if (!phone || !docId) return res.status(400).json({ error: 'Data tidak lengkap' });
    const normalized = normalizePhone(String(phone));
    if (normalized.length < 10 || normalized.length > 15) return res.status(400).json({ error: 'Nomor HP tidak valid' });

    if (USE_FB) {
      const snap = await _db.collection('documents').doc(String(docId)).get();
      if (!snap.exists) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    } else {
      const docs = readLocalJSON(DOCUMENTS_FILE) || [];
      if (!docs.find(d => d.id === Number(docId))) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    }

    const existing = otpStore.get(normalized);
    if (existing && existing.lastSent > Date.now() - 60_000) {
      const wait = Math.ceil((existing.lastSent + 60_000 - Date.now()) / 1000);
      return res.status(429).json({ error: `Tunggu ${wait} detik sebelum kirim ulang` });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(normalized, { otp, docId: Number(docId), expires: Date.now() + 5 * 60_000, attempts: 0, lastSent: Date.now() });
    await sendWhatsApp(normalized, `Kode OTP unduhan dokumen Inti Atap Anda:\n\n*${otp}*\n\nBerlaku 5 menit. Jangan bagikan kode ini ke siapapun.`);
    res.json({ ok: true, dev: !FONNTE_TOKEN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/otp/verify', async (req, res) => {
  try {
    const { phone, otp, docId } = req.body;
    if (!phone || !otp || !docId) return res.status(400).json({ error: 'Data tidak lengkap' });
    const normalized = normalizePhone(String(phone));
    const entry = otpStore.get(normalized);
    if (!entry)                           return res.status(400).json({ error: 'OTP tidak ditemukan atau sudah kadaluarsa' });
    if (entry.expires < Date.now())       { otpStore.delete(normalized); return res.status(400).json({ error: 'OTP sudah kadaluarsa. Minta kode baru.' }); }
    if (entry.docId !== Number(docId))    return res.status(400).json({ error: 'OTP tidak valid untuk dokumen ini' });
    if (entry.attempts >= 3)              return res.status(400).json({ error: 'Terlalu banyak percobaan. Minta kode baru.' });
    if (entry.otp !== String(otp).trim()) {
      entry.attempts++;
      otpStore.set(normalized, entry);
      return res.status(400).json({ error: `Kode salah. ${3 - entry.attempts} percobaan tersisa.` });
    }

    otpStore.delete(normalized);
    const token = crypto.randomBytes(24).toString('hex');

    if (USE_FB) {
      const snap = await _db.collection('documents').doc(String(docId)).get();
      if (!snap.exists) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
      const doc = snap.data();
      downloadTokens.set(token, { filename: doc.filename, title: doc.title, expires: Date.now() + 10 * 60_000 });
    } else {
      const docs = readLocalJSON(DOCUMENTS_FILE) || [];
      const doc  = docs.find(d => d.id === Number(docId));
      downloadTokens.set(token, { filename: doc.filename, title: doc.title, expires: Date.now() + 10 * 60_000 });
    }

    res.json({ ok: true, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Download (token-gated, one-time)
// ============================================================
app.get('/api/download/:token', async (req, res) => {
  try {
    const entry = downloadTokens.get(req.params.token);
    if (!entry)                     return res.status(403).json({ error: 'Link tidak valid atau sudah kadaluarsa' });
    if (entry.expires < Date.now()) { downloadTokens.delete(req.params.token); return res.status(403).json({ error: 'Link sudah kadaluarsa' }); }
    downloadTokens.delete(req.params.token);

    if (USE_FB) {
      const url = await fbSignedUrl('docs', entry.filename, Date.now() + 5 * 60 * 1000);
      return res.redirect(url);
    }
    const f = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'File tidak ditemukan' });
    res.setHeader('Content-Disposition', `attachment; filename="${entry.title}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Homepage
// ============================================================
app.get('/api/homepage', async (_, res) => {
  try {
    if (USE_FB) {
      const snap = await _db.collection('config').doc('homepage').get();
      return res.json(snap.exists ? snap.data() : {});
    }
    res.json(readLocalJSON(HOMEPAGE_FILE) || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/homepage', requireAuth, async (req, res) => {
  try {
    if (USE_FB) {
      const ref  = _db.collection('config').doc('homepage');
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      if (Array.isArray(req.body.heroImages))  data.heroImages   = req.body.heroImages;
      if (req.body.alderonImage !== undefined) data.alderonImage = req.body.alderonImage;
      if (Array.isArray(req.body.portfolio))   data.portfolio    = req.body.portfolio;
      await ref.set(data);
      return res.json(data);
    }
    const data = readLocalJSON(HOMEPAGE_FILE) || {};
    if (Array.isArray(req.body.heroImages))  data.heroImages   = req.body.heroImages;
    if (req.body.alderonImage !== undefined) data.alderonImage = req.body.alderonImage;
    if (Array.isArray(req.body.portfolio))   data.portfolio    = req.body.portfolio;
    writeLocalJSON(HOMEPAGE_FILE, data);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Seed Firestore and start server
// ============================================================
if (USE_FB) seedFirestore().catch(console.error);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Inti Atap berjalan di http://localhost:${PORT}`);
    console.log(`  Admin panel : http://localhost:${PORT}/admin`);
    console.log(`  Dokumen     : http://localhost:${PORT}/dokumen`);
    console.log(`  Mode        : ${USE_FB ? 'Firebase (Firestore + Storage)' : 'Local files (dev)'}`);
    console.log(`  Password    : ${ADMIN_PASSWORD}`);
    if (!FONNTE_TOKEN) console.log(`  OTP mode    : DEV (kode tampil di console)\n`);
    else               console.log(`  OTP mode    : LIVE via Fonnte\n`);
  });
}

module.exports = app;
