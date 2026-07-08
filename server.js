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

// --- Visitor (phone-verified) tokens, used for commenting on news ---
function signUserToken(phone, name) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ phone, name: name || '', exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }));
  const s = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}
function verifyUserToken(token) {
  try {
    const [h, p, s] = (token || '').split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.phone || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { phone: payload.phone, name: payload.name || '' };
  } catch { return null; }
}

// ============================================================
// Firebase — optional. Falls back to local JSON files in dev.
// Set FIREBASE_PRIVATE_KEY env var to activate.
// ============================================================
let _db = null, _bucket = null;

if (process.env.FIREBASE_PRIVATE_KEY) {
  try {
    // We always authenticate with an explicit service-account cert, so the
    // Google auth client never needs to probe the GCP metadata server
    // (169.254.169.254) to detect its "universe domain". On networks where that
    // bogus address is dropped rather than refused, the probe hangs for the full
    // ~170s timeout during admin.storage().bucket() before falling back. Disable
    // it so init stays fast. Guarded with || so an explicit value still wins.
    process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
    const admin = require('firebase-admin');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    _db     = admin.firestore();
    // Use Firestore's REST/HTTP transport instead of the default gRPC. On
    // networks that block/throttle gRPC, the first read otherwise stalls ~30s
    // before connecting; REST isn't affected and stays at ~200ms. Safe in
    // production since we authenticate with an explicit service-account cert.
    _db.settings({ preferRest: true });
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
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categories.json');
const DOCUMENTS_FILE = path.join(__dirname, 'data', 'documents.json');
const HOMEPAGE_FILE  = path.join(__dirname, 'data', 'homepage.json');
const PROJECTS_FILE  = path.join(__dirname, 'data', 'projects.json');
const NEWS_FILE      = path.join(__dirname, 'data', 'news.json');
const COMMENTS_FILE  = path.join(__dirname, 'data', 'comments.json');
const USERS_FILE     = path.join(__dirname, 'data', 'users.json');
const FAQ_FILE       = path.join(__dirname, 'data', 'faq.json');
const DOC_CATEGORIES_FILE = path.join(__dirname, 'data', 'doc-categories.json');
const UPLOADS_DIR    = path.join(__dirname, 'uploads');
const DOCS_DIR       = path.join(__dirname, 'docs');

['data', 'uploads', 'docs'].forEach(d => {
  try { if (!fs.existsSync(path.join(__dirname, d))) fs.mkdirSync(path.join(__dirname, d), { recursive: true }); } catch {}
});

const readLocalJSON  = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeLocalJSON = (f, d) => { try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch {} };

// Canonical default content for the homepage "Produk Unggulan" (featured
// product) block. These are the single source of truth for the copy that used
// to be hardcoded in index.html. Stored values override these per-field; any
// field not yet customised falls back here — so GET /api/homepage always
// returns the full content and the backoffice opens pre-filled with the
// current live text/bullets instead of blank fields.
const ALDERON_DEFAULTS = {
  alderonTitle: 'MATTAKA',
  alderonSub:   'Atap uPVC — Roof It. Prove It.',
  alderonDesc:  'Inovasi atap uPVC dengan pilihan Single & Double Layer. Super profile mencegah rembesan air hujan dan Dual Tone menghilangkan tembus cahaya — ruangan lebih sejuk, lebih tenang, dengan garansi hingga 15 tahun.',
  alderonFeatures: [
    'UV Protection — ruangan lebih sejuk & dingin',
    'Super Profile — cegah rembesan air hujan (double layer)',
    'Dual Tone — hilangkan tembus cahaya (single layer)',
    'Anti Karat & Tahan Kontaminasi Bahan Kimia',
    'Garansi Terpanjang Hingga 15 Tahun',
  ],
};

// Merge stored homepage data over the featured-product defaults. A field counts
// as "customised" only when it is actually present, so an admin can still clear
// text to an empty string without it snapping back to the default.
function withAlderonDefaults(data) {
  const d = data || {};
  return {
    ...d,
    alderonTitle:    d.alderonTitle    !== undefined ? d.alderonTitle    : ALDERON_DEFAULTS.alderonTitle,
    alderonSub:      d.alderonSub       !== undefined ? d.alderonSub      : ALDERON_DEFAULTS.alderonSub,
    alderonDesc:     d.alderonDesc      !== undefined ? d.alderonDesc     : ALDERON_DEFAULTS.alderonDesc,
    alderonFeatures: Array.isArray(d.alderonFeatures) ? d.alderonFeatures : ALDERON_DEFAULTS.alderonFeatures,
  };
}

// Ensure homepage.json exists locally
if (!fs.existsSync(HOMEPAGE_FILE)) {
  writeLocalJSON(HOMEPAGE_FILE, {
    heroVideo: '',
    alderonImage: '',
    portfolio: [
      { image: '', title: 'Gudang Konstruksi' },
      { image: '', title: 'Bangunan Masjid' },
      { image: '', title: 'Bangunan Gudang' },
    ],
  });
}

// Ensure categories.json exists locally (default catalog of product categories)
if (!fs.existsSync(CATEGORIES_FILE)) {
  writeLocalJSON(CATEGORIES_FILE, [
    { id: 1, name: 'Roofing & Cladding', order: 1 },
    { id: 2, name: 'Floor Deck',         order: 2 },
    { id: 3, name: 'Roof Truss',         order: 3 },
    { id: 4, name: 'Fiber Glass',        order: 4 },
    { id: 5, name: 'Insulasi',           order: 5 },
    { id: 6, name: 'Wiremesh',           order: 6 },
    { id: 7, name: 'Mattaka uPVC',       order: 7 },
  ]);
}

// Ensure doc-categories.json exists locally (default document categories)
if (!fs.existsSync(DOC_CATEGORIES_FILE)) {
  writeLocalJSON(DOC_CATEGORIES_FILE, [
    { id: 1, name: 'Sertifikat', order: 1 },
    { id: 2, name: 'Brosur',     order: 2 },
    { id: 3, name: 'Katalog',    order: 3 },
    { id: 4, name: 'Panduan',    order: 4 },
  ]);
}

// ============================================================
// Firebase helpers
// ============================================================
// Uploaded files get unique hashed names and are never overwritten, so they're
// safe to cache forever. Without this, Firebase Storage serves them as
// `private, max-age=0`, forcing the browser to re-download the (potentially
// 20MB+) video every time — e.g. opening a news detail re-fetches the exact
// same clip already loaded in the marquee. immutable caching makes those reuse.
const STORAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

async function fbUploadFile(buffer, mimetype, folder, ext, isPublic = true) {
  const filename = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
  const file = _bucket.file(folder + '/' + filename);
  if (isPublic) {
    const token = crypto.randomUUID();
    await file.save(buffer, { metadata: { contentType: mimetype, cacheControl: STORAGE_CACHE_CONTROL, metadata: { firebaseStorageDownloadTokens: token } } });
    const url = `https://firebasestorage.googleapis.com/v0/b/${_bucket.name}/o/${encodeURIComponent(folder + '/' + filename)}?alt=media&token=${token}`;
    return { filename, url };
  }
  await file.save(buffer, { metadata: { contentType: mimetype, cacheControl: STORAGE_CACHE_CONTROL } });
  return { filename, url: null };
}

async function fbDeleteFile(folder, filename) {
  try { await _bucket.file(folder + '/' + filename).delete(); } catch {}
}

// Extract the Storage object path (e.g. "uploads/123-ab.jpg") from a stored URL.
// Handles the Firebase download URL ("…/o/uploads%2F123-ab.jpg?alt=media&token=…")
// and the plain GCS URL ("storage.googleapis.com/<bucket>/uploads/123-ab.jpg").
function fbObjectPathFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/o\/(.+)$/);
    if (m) return decodeURIComponent(m[1]);
    if (u.hostname === 'storage.googleapis.com') {
      const parts = u.pathname.replace(/^\/+/, '').split('/');
      parts.shift(); // drop the bucket segment
      return parts.join('/');
    }
  } catch {}
  return null;
}

// Delete an uploaded image given its public URL — actually removes the file from
// Firebase Storage (production) or the local uploads dir (dev). Best-effort.
async function deleteImageByUrl(url) {
  if (!url) return;
  if (USE_FB) {
    if (!/(?:firebasestorage|storage)\.googleapis\.com/.test(url)) return;
    const objectPath = fbObjectPathFromUrl(url);
    if (objectPath) { try { await _bucket.file(objectPath).delete(); } catch {} }
  } else {
    if (!url.startsWith('/uploads/')) return;
    try { const f = path.join(UPLOADS_DIR, path.basename(url)); if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

async function fbSignedUrl(folder, filename, expiresMs) {
  const [url] = await _bucket.file(folder + '/' + filename).getSignedUrl({
    action:  'read',
    expires: expiresMs,
  });
  return url;
}

// Allow the browser to PUT directly to the Storage bucket via signed URLs
// (used for large hero-video uploads). Best-effort; runs once at startup.
async function ensureBucketCors() {
  try {
    await _bucket.setCorsConfiguration([{
      origin:         ['*'],
      method:         ['GET', 'PUT'],
      responseHeader: ['Content-Type'],
      maxAgeSeconds:  3600,
    }]);
    console.log('  Storage: CORS dikonfigurasi untuk upload langsung');
  } catch (e) {
    console.error('  Storage CORS error:', e.message);
  }
}

// Default FAQ content (originally hardcoded in index.html). Used to seed both
// the local faq.json and an empty Firestore `faq` collection. Answers are plain
// text: blank lines separate paragraphs, "- " lines become bullet lists, and
// "1." / "2." lines become numbered lists (see renderAnswer in main.js).
const DEFAULT_FAQ = [
  { id: 1, order: 1,
    question: 'Bagaimana cara memesan produk?',
    answer: 'Pemesanan dapat dilakukan melalui beberapa cara:\n1. Hubungi CS kami via WhatsApp di 085199881929\n2. Isi form kontak di halaman ini\n3. Kunjungi langsung ke kantor & gudang kami di Tangerang\n\nTim kami akan membantu Anda memilih produk yang sesuai kebutuhan dan memberikan penawaran harga terbaik.' },
  { id: 2, order: 2,
    question: 'Metode pembayaran apa saja yang tersedia?',
    answer: 'Kami menerima pembayaran melalui:\n- Transfer Bank BCA\n- Pembayaran tunai (untuk pembelian langsung di gudang)\n\nBukti pembayaran dikirimkan melalui WhatsApp setelah transaksi selesai.' },
  { id: 3, order: 3,
    question: 'Apakah melayani pengiriman ke luar kota?',
    answer: 'Ya, kami melayani pengiriman ke seluruh wilayah Indonesia. Ongkos kirim akan disesuaikan dengan lokasi tujuan dan volume pesanan. Hubungi CS kami untuk mendapatkan estimasi biaya pengiriman.' },
  { id: 4, order: 4,
    question: 'Bagaimana cara membersihkan produk atap?',
    answer: 'Serbuk besi atau metal akibat kegiatan pengeboran/pemotongan harus segera dibersihkan dari permukaan atap untuk menghindari karat. Kotoran keras yang melekat pada bahan atap dapat dibersihkan menggunakan air bersih dan kain lembut. Hindari bahan kimia keras.' },
  { id: 5, order: 5,
    question: 'Bagaimana cara penyimpanan yang benar?',
    answer: '- Hindari penumpukan lembaran atap langsung di tanah\n- Kelompokkan berdasarkan type dan ukuran masing-masing\n- Letakkan di atas balok kayu dengan posisi landai untuk menghindari genangan air\n- Simpan di tempat yang terlindung dari paparan cuaca langsung' },
  { id: 6, order: 6,
    question: 'Apakah bisa request harga produk?',
    answer: 'Tentu. Hubungi CS kami via WhatsApp dengan menyebutkan jenis produk, ukuran, dan jumlah yang dibutuhkan. Kami akan memberikan penawaran harga yang kompetitif sesuai kebutuhan proyek Anda.' },
];

// Ensure faq.json exists locally (default FAQ content) for the dev/local fallback.
if (!fs.existsSync(FAQ_FILE)) writeLocalJSON(FAQ_FILE, DEFAULT_FAQ);

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

    const catSnap = await _db.collection('categories').limit(1).get();
    if (catSnap.empty) {
      const cats = readLocalJSON(CATEGORIES_FILE) || [];
      if (cats.length) {
        const batch = _db.batch();
        cats.forEach(c => batch.set(_db.collection('categories').doc(String(c.id)), c));
        await batch.commit();
        console.log(`  Firestore: seeded ${cats.length} categories`);
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

    const projectsSnap = await _db.collection('projects').limit(1).get();
    if (projectsSnap.empty) {
      const projects = readLocalJSON(PROJECTS_FILE) || [];
      if (projects.length) {
        const batch = _db.batch();
        projects.forEach(p => batch.set(_db.collection('projects').doc(String(p.id)), p));
        await batch.commit();
        console.log(`  Firestore: seeded ${projects.length} projects`);
      }
    }

    const newsSnap = await _db.collection('news').limit(1).get();
    if (newsSnap.empty) {
      const news = readLocalJSON(NEWS_FILE) || [];
      if (news.length) {
        const batch = _db.batch();
        news.forEach(n => batch.set(_db.collection('news').doc(String(n.id)), n));
        await batch.commit();
        console.log(`  Firestore: seeded ${news.length} news`);
      }
    }

    const faqSnap = await _db.collection('faq').limit(1).get();
    if (faqSnap.empty) {
      const faqs = readLocalJSON(FAQ_FILE) || DEFAULT_FAQ;
      if (faqs.length) {
        const batch = _db.batch();
        faqs.forEach(f => batch.set(_db.collection('faq').doc(String(f.id)), f));
        await batch.commit();
        console.log(`  Firestore: seeded ${faqs.length} faq`);
      }
    }

    const docCatSnap = await _db.collection('docCategories').limit(1).get();
    if (docCatSnap.empty) {
      const cats = readLocalJSON(DOC_CATEGORIES_FILE) || [];
      if (cats.length) {
        const batch = _db.batch();
        cats.forEach(c => batch.set(_db.collection('docCategories').doc(String(c.id)), c));
        await batch.commit();
        console.log(`  Firestore: seeded ${cats.length} doc-categories`);
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

function requireUser(req, res, next) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  const user  = verifyUserToken(token);
  if (!user) return res.status(401).json({ error: 'Verifikasi nomor diperlukan' });
  req.user = user;
  next();
}

// --- Visitor name lookup (works in both Firebase and local modes) ---
async function getUserName(phone) {
  if (USE_FB) {
    const snap = await _db.collection('users').doc(phone).get();
    return snap.exists ? (snap.data().name || '') : '';
  }
  const list = readLocalJSON(USERS_FILE) || [];
  const u = list.find(x => x.phone === phone);
  return u ? (u.name || '') : '';
}
async function setUserName(phone, name) {
  if (USE_FB) {
    await _db.collection('users').doc(phone).set({ phone, name }, { merge: true });
    return;
  }
  const list = readLocalJSON(USERS_FILE) || [];
  const i = list.findIndex(x => x.phone === phone);
  if (i >= 0) list[i].name = name;
  else list.push({ phone, name });
  writeLocalJSON(USERS_FILE, list);
}

// Persist every OTP-verified phone (document-download + comment flows) so the
// admin can see who has verified. Never overwrites an existing display name;
// keeps the first-seen source and timestamp, refreshes lastVerifiedAt.
async function recordVerifiedPhone(phone, source) {
  const now = new Date().toISOString();
  if (USE_FB) {
    const ref  = _db.collection('users').doc(phone);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    await ref.set({
      phone,
      name:           data.name   || '',
      source:         data.source || source,
      createdAt:      data.createdAt || now,
      lastVerifiedAt: now,
    }, { merge: true });
    return;
  }
  const list = readLocalJSON(USERS_FILE) || [];
  const i = list.findIndex(x => x.phone === phone);
  if (i >= 0) {
    list[i].lastVerifiedAt = now;
    if (!list[i].createdAt) list[i].createdAt = now;
    if (!list[i].source)    list[i].source = source;
  } else {
    list.push({ phone, name: '', source, createdAt: now, lastVerifiedAt: now });
  }
  writeLocalJSON(USERS_FILE, list);
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
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_, f, cb) => f.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Hanya PDF')),
});

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_, f, cb) => f.mimetype.startsWith('video/') ? cb(null, true) : cb(new Error('Hanya video')),
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

// ------------------------------------------------------------
// Homepage HTML with the hero video URL inlined.
//
// Without this, the browser only learns the video URL after:
//   index.html -> main.js (download+parse) -> fetch /api/homepage
//   -> serverless cold start + Firestore read -> set <video src>.
// That whole chain runs before a single byte of video is fetched.
//
// Here we read the homepage config server-side (cached briefly) and bake the
// src/poster straight into the <video> tag, so the download starts during
// HTML parse — in parallel with main.js — instead of after it.
// ------------------------------------------------------------
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
let _hpCache = { at: 0, data: null };
async function getHomepageConfig() {
  if (_hpCache.data && Date.now() - _hpCache.at < 60_000) return _hpCache.data;
  let data = {};
  try {
    if (USE_FB) {
      const snap = await _db.collection('config').doc('homepage').get();
      data = snap.exists ? snap.data() : {};
    } else {
      data = readLocalJSON(HOMEPAGE_FILE) || {};
    }
  } catch {}
  _hpCache = { at: Date.now(), data };
  return data;
}
const escAttr = s => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

app.get(['/', '/index.html'], async (_, res) => {
  let attrs = '';
  try {
    const hp = await getHomepageConfig();
    if (hp && hp.heroVideo) {
      attrs = `src="${escAttr(hp.heroVideo)}"`;
      if (hp.heroPoster) attrs += ` poster="${escAttr(hp.heroPoster)}"`;
    }
  } catch {}
  res.set('Cache-Control', 'no-cache');
  // Replace the placeholder only where it sits on the <video> tag, so a stray
  // mention elsewhere (e.g. a comment) can never absorb the substitution.
  res.type('html').send(INDEX_HTML.replace(' __HERO_VIDEO_ATTRS__>', attrs ? ' ' + attrs + '>' : '>'));
});

app.use(express.static(path.join(__dirname, 'public')));
// Uploaded files have unique hashed names and never change → cache hard so the
// news detail video (and product images) reuse the marquee's already-downloaded
// bytes instead of revalidating.
if (!USE_FB) app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true }));

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
// Bidirectional product <-> project links
// Products carry projectIds; projects carry productIds. Whenever one side is
// saved we mirror the change onto the other side, so a link created from either
// the product form or the project form shows up in both places automatically.
// ============================================================
function diffIds(nextIds, prevIds) {
  const next = [...new Set((nextIds || []).map(Number))];
  const prev = [...new Set((prevIds || []).map(Number))];
  return { add: next.filter(id => !prev.includes(id)), remove: prev.filter(id => !next.includes(id)) };
}

async function mirrorLinks(collection, field, ownerId, nextIds, prevIds, file) {
  const { add, remove } = diffIds(nextIds, prevIds);
  if (!add.length && !remove.length) return;
  const oid = Number(ownerId);
  if (USE_FB) {
    const apply = async (otherId, addIt) => {
      const ref  = _db.collection(collection).doc(String(otherId));
      const snap = await ref.get();
      if (!snap.exists) return;
      const ids = [...new Set((snap.data()[field] || []).map(Number))];
      const has = ids.includes(oid);
      if (addIt && !has)        await ref.update({ [field]: [...ids, oid] });
      else if (!addIt && has)   await ref.update({ [field]: ids.filter(x => x !== oid) });
    };
    for (const id of add)    await apply(id, true);
    for (const id of remove) await apply(id, false);
    return;
  }
  const list = readLocalJSON(file) || [];
  let changed = false;
  list.forEach(item => {
    const ids = [...new Set((item[field] || []).map(Number))];
    const has = ids.includes(oid);
    if (add.includes(item.id) && !has)    { item[field] = [...ids, oid]; changed = true; }
    if (remove.includes(item.id) && has)  { item[field] = ids.filter(x => x !== oid); changed = true; }
  });
  if (changed) writeLocalJSON(file, list);
}

// Mirror a product's projectIds onto the matching projects' productIds (and back).
const mirrorProductToProjects = (productId, nextIds, prevIds) =>
  mirrorLinks('projects', 'productIds', productId, nextIds, prevIds, PROJECTS_FILE);
const mirrorProjectToProducts = (projectId, nextIds, prevIds) =>
  mirrorLinks('products', 'projectIds', projectId, nextIds, prevIds, PRODUCTS_FILE);

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
      const item  = { id: maxId + 1, name: req.body.name || '', category: req.body.category || '', image: req.body.image || '', description: req.body.description || '', projectIds: Array.isArray(req.body.projectIds) ? req.body.projectIds : [] };
      await _db.collection('products').doc(String(item.id)).set(item);
      await mirrorProductToProjects(item.id, item.projectIds, []);
      return res.status(201).json(item);
    }
    const list  = readLocalJSON(PRODUCTS_FILE) || [];
    const maxId = list.reduce((m, p) => Math.max(m, p.id), 0);
    const item  = { id: maxId + 1, name: req.body.name || '', category: req.body.category || '', image: req.body.image || '', description: req.body.description || '', projectIds: Array.isArray(req.body.projectIds) ? req.body.projectIds : [] };
    list.push(item);
    writeLocalJSON(PRODUCTS_FILE, list);
    await mirrorProductToProjects(item.id, item.projectIds, []);
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
      const prev    = snap.data();
      const updated = { ...prev, ...req.body, id };
      await ref.set(updated);
      if (Array.isArray(req.body.projectIds)) await mirrorProductToProjects(id, updated.projectIds || [], prev.projectIds || []);
      return res.json(updated);
    }
    const list = readLocalJSON(PRODUCTS_FILE) || [];
    const idx  = list.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    const prevIds = list[idx].projectIds || [];
    list[idx] = { ...list[idx], ...req.body, id };
    writeLocalJSON(PRODUCTS_FILE, list);
    if (Array.isArray(req.body.projectIds)) await mirrorProductToProjects(id, list[idx].projectIds || [], prevIds);
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
      const { image, projectIds } = snap.data();
      if (image && image.includes('storage.googleapis.com')) {
        const parts = image.split('/');
        await fbDeleteFile(parts[parts.length - 2], parts[parts.length - 1]);
      }
      await ref.delete();
      await mirrorProductToProjects(id, [], projectIds || []);
      return res.json({ ok: true });
    }
    let list = readLocalJSON(PRODUCTS_FILE) || [];
    const item = list.find(p => p.id === id);
    if (!item) return res.status(404).json({ error: 'Produk tidak ditemukan' });
    if (item.image) { const f = path.join(UPLOADS_DIR, path.basename(item.image)); if (fs.existsSync(f)) fs.unlinkSync(f); }
    writeLocalJSON(PRODUCTS_FILE, list.filter(p => p.id !== id));
    await mirrorProductToProjects(id, [], item.projectIds || []);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Categories (product categories — managed from the back office)
// Model: { id, name, order }. Products reference a category by its name.
// ============================================================
async function readCategories() {
  if (USE_FB) {
    const snap = await _db.collection('categories').get();
    return snap.docs.map(d => d.data()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const list = readLocalJSON(CATEGORIES_FILE) || [];
  return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

async function readDocCategories() {
  if (USE_FB) {
    const snap = await _db.collection('docCategories').get();
    return snap.docs.map(d => d.data()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const list = readLocalJSON(DOC_CATEGORIES_FILE) || [];
  return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

app.get('/api/categories', async (_, res) => {
  try {
    res.json(await readCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categories', requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nama kategori wajib diisi' });
    const list = await readCategories();
    if (list.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Kategori sudah ada' });
    }
    const maxId    = list.reduce((m, c) => Math.max(m, c.id || 0), 0);
    const maxOrder = list.reduce((m, c) => Math.max(m, c.order || 0), 0);
    const item = { id: maxId + 1, name, order: maxOrder + 1 };
    if (USE_FB) {
      await _db.collection('categories').doc(String(item.id)).set(item);
    } else {
      writeLocalJSON(CATEGORIES_FILE, [...(readLocalJSON(CATEGORIES_FILE) || []), item]);
    }
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rename a category — cascades the new name to every product using the old one.
app.put('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const id   = Number(req.params.id);
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nama kategori wajib diisi' });
    const list = await readCategories();
    const cat  = list.find(c => c.id === id);
    if (!cat) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    if (list.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Kategori sudah ada' });
    }
    const oldName = cat.name;
    const updated = { ...cat, name };
    if (USE_FB) {
      await _db.collection('categories').doc(String(id)).set(updated);
      if (oldName !== name) {
        const prods = await _db.collection('products').where('category', '==', oldName).get();
        if (!prods.empty) {
          const batch = _db.batch();
          prods.forEach(d => batch.update(d.ref, { category: name }));
          await batch.commit();
        }
      }
    } else {
      const cats = (readLocalJSON(CATEGORIES_FILE) || []).map(c => c.id === id ? updated : c);
      writeLocalJSON(CATEGORIES_FILE, cats);
      if (oldName !== name) {
        const prods = (readLocalJSON(PRODUCTS_FILE) || []).map(p => p.category === oldName ? { ...p, category: name } : p);
        writeLocalJSON(PRODUCTS_FILE, prods);
      }
    }
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      await _db.collection('categories').doc(String(id)).delete();
    } else {
      writeLocalJSON(CATEGORIES_FILE, (readLocalJSON(CATEGORIES_FILE) || []).filter(c => c.id !== id));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reorder — body: { ids: [orderedIds...] }. Sets each category's order to its index.
app.put('/api/categories', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
    if (!ids) return res.status(400).json({ error: 'ids harus berupa array' });
    if (USE_FB) {
      const batch = _db.batch();
      ids.forEach((id, i) => batch.update(_db.collection('categories').doc(String(id)), { order: i + 1 }));
      await batch.commit();
    } else {
      const byId = new Map((readLocalJSON(CATEGORIES_FILE) || []).map(c => [c.id, c]));
      ids.forEach((id, i) => { const c = byId.get(id); if (c) c.order = i + 1; });
      writeLocalJSON(CATEGORIES_FILE, [...byId.values()]);
    }
    res.json(await readCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Document categories — mirror product categories (model: { id, name, order }).
// Documents reference a category by name. Renaming cascades to documents.
// ============================================================
app.get('/api/doc-categories', async (_, res) => {
  try {
    res.json(await readDocCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/doc-categories', requireAuth, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nama kategori wajib diisi' });
    const list = await readDocCategories();
    if (list.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Kategori sudah ada' });
    }
    const maxId    = list.reduce((m, c) => Math.max(m, c.id || 0), 0);
    const maxOrder = list.reduce((m, c) => Math.max(m, c.order || 0), 0);
    const item = { id: maxId + 1, name, order: maxOrder + 1 };
    if (USE_FB) {
      await _db.collection('docCategories').doc(String(item.id)).set(item);
    } else {
      writeLocalJSON(DOC_CATEGORIES_FILE, [...(readLocalJSON(DOC_CATEGORIES_FILE) || []), item]);
    }
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rename a doc category — cascades the new name to every document using the old one.
app.put('/api/doc-categories/:id', requireAuth, async (req, res) => {
  try {
    const id   = Number(req.params.id);
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nama kategori wajib diisi' });
    const list = await readDocCategories();
    const cat  = list.find(c => c.id === id);
    if (!cat) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    if (list.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'Kategori sudah ada' });
    }
    const oldName = cat.name;
    const updated = { ...cat, name };
    if (USE_FB) {
      await _db.collection('docCategories').doc(String(id)).set(updated);
      if (oldName !== name) {
        const docs = await _db.collection('documents').where('category', '==', oldName).get();
        if (!docs.empty) {
          const batch = _db.batch();
          docs.forEach(d => batch.update(d.ref, { category: name }));
          await batch.commit();
        }
      }
    } else {
      const cats = (readLocalJSON(DOC_CATEGORIES_FILE) || []).map(c => c.id === id ? updated : c);
      writeLocalJSON(DOC_CATEGORIES_FILE, cats);
      if (oldName !== name) {
        const docs = (readLocalJSON(DOCUMENTS_FILE) || []).map(d => d.category === oldName ? { ...d, category: name } : d);
        writeLocalJSON(DOCUMENTS_FILE, docs);
      }
    }
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/doc-categories/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      await _db.collection('docCategories').doc(String(id)).delete();
    } else {
      writeLocalJSON(DOC_CATEGORIES_FILE, (readLocalJSON(DOC_CATEGORIES_FILE) || []).filter(c => c.id !== id));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reorder — body: { ids: [orderedIds...] }. Sets each category's order to its index.
app.put('/api/doc-categories', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
    if (!ids) return res.status(400).json({ error: 'ids harus berupa array' });
    if (USE_FB) {
      const batch = _db.batch();
      ids.forEach((id, i) => batch.update(_db.collection('docCategories').doc(String(id)), { order: i + 1 }));
      await batch.commit();
    } else {
      const byId = new Map((readLocalJSON(DOC_CATEGORIES_FILE) || []).map(c => [c.id, c]));
      ids.forEach((id, i) => { const c = byId.get(id); if (c) c.order = i + 1; });
      writeLocalJSON(DOC_CATEGORIES_FILE, [...byId.values()]);
    }
    res.json(await readDocCategories());
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
// Upload video (hero background)
//
// In production on Firebase, the browser uploads the file *directly* to
// Cloud Storage via a signed URL. This bypasses the serverless function's
// 4.5MB request-body limit, which a typical MP4 would exceed.
//   1. POST /api/upload/video/init   -> { mode:'signed', uploadUrl, objectPath, contentType }
//   2. browser PUTs the file to uploadUrl
//   3. POST /api/upload/video/finalize { objectPath } -> { url } (sets public token)
//
// In local dev (no Firebase) it falls back to a normal multipart upload.
// ============================================================
app.post('/api/upload/video/init', requireAuth, async (req, res) => {
  try {
    if (!USE_FB) return res.json({ mode: 'direct' });
    const contentType = (req.body && req.body.contentType) || 'video/mp4';
    let ext = (req.body && req.body.ext) || '.mp4';
    if (!/^\.[a-z0-9]{2,5}$/i.test(ext)) ext = '.mp4';
    const objectPath = 'uploads/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
    const [uploadUrl] = await _bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action:  'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
    });
    res.json({ mode: 'signed', uploadUrl, objectPath, contentType });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload/video/finalize', requireAuth, async (req, res) => {
  try {
    if (!USE_FB) return res.status(400).json({ error: 'Tidak tersedia' });
    const objectPath = req.body && req.body.objectPath;
    if (!objectPath || !objectPath.startsWith('uploads/')) return res.status(400).json({ error: 'Path tidak valid' });
    const token = crypto.randomUUID();
    await _bucket.file(objectPath).setMetadata({ cacheControl: STORAGE_CACHE_CONTROL, metadata: { firebaseStorageDownloadTokens: token } });
    const url = `https://firebasestorage.googleapis.com/v0/b/${_bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Multipart fallback (local dev only — small enough for the function limit)
app.post('/api/upload/video', requireAuth, uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });
    if (USE_FB) {
      const ext = path.extname(req.file.originalname) || '.mp4';
      const { url } = await fbUploadFile(req.file.buffer, req.file.mimetype, 'uploads', ext);
      return res.json({ url });
    }
    const filename = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + (path.extname(req.file.originalname) || '.mp4');
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
    res.json(list.map(({ id, title, description, category, size, uploadedAt }) => ({ id, title, description, category: category || '', size, uploadedAt })));
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
      const item = { id: maxId + 1, title: req.body.title || req.file.originalname.replace('.pdf', ''), description: req.body.description || '', category: req.body.category || '', filename, size, uploadedAt: new Date().toISOString().slice(0, 10) };
      await _db.collection('documents').doc(String(item.id)).set(item);
      const { filename: _f, ...pub } = item;
      return res.status(201).json(pub);
    }

    const list     = readLocalJSON(DOCUMENTS_FILE) || [];
    const maxId    = list.reduce((m, d) => Math.max(m, d.id), 0);
    const diskFile = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(DOCS_DIR, diskFile), req.file.buffer);
    const item = { id: maxId + 1, title: req.body.title || req.file.originalname.replace('.pdf', ''), description: req.body.description || '', category: req.body.category || '', filename: diskFile, size, uploadedAt: new Date().toISOString().slice(0, 10) };
    list.push(item);
    writeLocalJSON(DOCUMENTS_FILE, list);
    const { filename: _f, ...pub } = item;
    res.status(201).json(pub);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Direct-to-storage PDF upload (production). Mirrors the video flow so PDFs
// larger than the serverless function's ~4.5MB request-body limit can be
// uploaded by PUTting straight to Cloud Storage via a signed URL.
//   1. POST /api/documents/init      -> { mode:'signed', uploadUrl, objectPath }
//   2. browser PUTs the PDF to uploadUrl (Content-Type: application/pdf)
//   3. POST /api/documents/finalize  { objectPath, title, description } -> doc
// In local dev (no Firebase) returns { mode:'direct' } and the browser falls
// back to the multipart POST /api/documents above.
app.post('/api/documents/init', requireAuth, async (_req, res) => {
  try {
    if (!USE_FB) return res.json({ mode: 'direct' });
    const filename   = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.pdf';
    const objectPath = 'docs/' + filename;
    const [uploadUrl] = await _bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action:  'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: 'application/pdf',
    });
    res.json({ mode: 'signed', uploadUrl, objectPath });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/documents/finalize', requireAuth, async (req, res) => {
  try {
    if (!USE_FB) return res.status(400).json({ error: 'Tidak tersedia' });
    const objectPath = req.body && req.body.objectPath;
    if (!objectPath || !objectPath.startsWith('docs/')) return res.status(400).json({ error: 'Path tidak valid' });
    const filename = objectPath.slice('docs/'.length);

    const file     = _bucket.file(objectPath);
    const [exists] = await file.exists();
    if (!exists) return res.status(400).json({ error: 'File belum terupload' });
    await file.setMetadata({ contentType: 'application/pdf', cacheControl: STORAGE_CACHE_CONTROL });
    const [meta] = await file.getMetadata();

    const bytes = Number(meta.size) || 0;
    const size  = bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    const snap  = await _db.collection('documents').get();
    const maxId = snap.empty ? 0 : Math.max(...snap.docs.map(d => d.data().id || 0));
    const item  = {
      id: maxId + 1,
      title: (req.body.title || '').trim() || filename.replace('.pdf', ''),
      description: (req.body.description || '').trim(),
      category: (req.body.category || '').trim(),
      filename, size,
      uploadedAt: new Date().toISOString().slice(0, 10),
    };
    await _db.collection('documents').doc(String(item.id)).set(item);
    const { filename: _f, ...pub } = item;
    res.status(201).json(pub);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Edit a document's metadata (title / description / category). The PDF itself
// isn't replaced here — re-upload for that.
app.put('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const patch = {};
    if (req.body.title !== undefined)       patch.title       = String(req.body.title);
    if (req.body.description !== undefined) patch.description = String(req.body.description);
    if (req.body.category !== undefined)    patch.category    = String(req.body.category);
    if (USE_FB) {
      const ref  = _db.collection('documents').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
      const updated = { ...snap.data(), ...patch, id };
      await ref.set(updated);
      const { filename: _f, ...pub } = updated;
      return res.json(pub);
    }
    const list = readLocalJSON(DOCUMENTS_FILE) || [];
    const idx  = list.findIndex(d => d.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    list[idx] = { ...list[idx], ...patch, id };
    writeLocalJSON(DOCUMENTS_FILE, list);
    const { filename: _f, ...pub } = list[idx];
    res.json(pub);
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
    await recordVerifiedPhone(normalized, 'download');
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
// Admin: verified contacts (phone + name from both OTP flows)
// ============================================================
app.get('/api/users', requireAuth, async (_req, res) => {
  try {
    let list;
    if (USE_FB) {
      const snap = await _db.collection('users').get();
      list = snap.docs.map(d => d.data());
    } else {
      list = readLocalJSON(USERS_FILE) || [];
    }
    list = list.map(u => ({
      phone:          u.phone || '',
      name:           u.name  || '',
      source:         u.source || '',
      createdAt:      u.createdAt || '',
      lastVerifiedAt: u.lastVerifiedAt || '',
    }));
    list.sort((a, b) =>
      String(b.lastVerifiedAt || b.createdAt).localeCompare(String(a.lastVerifiedAt || a.createdAt)));
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Homepage
// ============================================================
app.get('/api/homepage', async (_, res) => {
  try {
    if (USE_FB) {
      const snap = await _db.collection('config').doc('homepage').get();
      return res.json(withAlderonDefaults(snap.exists ? snap.data() : {}));
    }
    res.json(withAlderonDefaults(readLocalJSON(HOMEPAGE_FILE) || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/homepage', requireAuth, async (req, res) => {
  try {
    if (USE_FB) {
      const ref  = _db.collection('config').doc('homepage');
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      if (req.body.heroVideo !== undefined)    data.heroVideo    = req.body.heroVideo;
      if (req.body.heroPoster !== undefined)   data.heroPoster   = req.body.heroPoster;
      if (Array.isArray(req.body.heroImages))  data.heroImages   = req.body.heroImages;
      if (req.body.alderonImage !== undefined) data.alderonImage = req.body.alderonImage;
      if (req.body.alderonTitle !== undefined) data.alderonTitle = req.body.alderonTitle;
      if (req.body.alderonSub !== undefined)   data.alderonSub   = req.body.alderonSub;
      if (req.body.alderonDesc !== undefined)  data.alderonDesc  = req.body.alderonDesc;
      if (Array.isArray(req.body.alderonFeatures)) data.alderonFeatures = req.body.alderonFeatures;
      if (Array.isArray(req.body.portfolio))   data.portfolio    = req.body.portfolio;
      await ref.set(data);
      return res.json(data);
    }
    const data = readLocalJSON(HOMEPAGE_FILE) || {};
    if (req.body.heroVideo !== undefined)    data.heroVideo    = req.body.heroVideo;
    if (req.body.heroPoster !== undefined)   data.heroPoster   = req.body.heroPoster;
    if (Array.isArray(req.body.heroImages))  data.heroImages   = req.body.heroImages;
    if (req.body.alderonImage !== undefined) data.alderonImage = req.body.alderonImage;
    if (req.body.alderonTitle !== undefined) data.alderonTitle = req.body.alderonTitle;
    if (req.body.alderonSub !== undefined)   data.alderonSub   = req.body.alderonSub;
    if (req.body.alderonDesc !== undefined)  data.alderonDesc  = req.body.alderonDesc;
    if (Array.isArray(req.body.alderonFeatures)) data.alderonFeatures = req.body.alderonFeatures;
    if (Array.isArray(req.body.portfolio))   data.portfolio    = req.body.portfolio;
    writeLocalJSON(HOMEPAGE_FILE, data);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Projects (referensi proyek — each has a title + multiple images)
// ============================================================
app.get('/api/projects', async (_, res) => {
  try {
    if (USE_FB) {
      const snap = await _db.collection('projects').orderBy('id').get();
      return res.json(snap.docs.map(d => d.data()));
    }
    res.json(readLocalJSON(PROJECTS_FILE) || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const images     = Array.isArray(req.body.images) ? req.body.images : [];
    const productIds  = Array.isArray(req.body.productIds) ? req.body.productIds : [];
    const year        = req.body.year || '';
    const location    = req.body.location || '';
    const description = req.body.description || '';
    // A project is either a photo carousel OR a single autoplaying video.
    const mediaType   = req.body.mediaType === 'video' ? 'video' : 'carousel';
    const video       = req.body.video || '';
    const videoPoster = req.body.videoPoster || '';
    if (USE_FB) {
      const snap  = await _db.collection('projects').get();
      const maxId = snap.empty ? 0 : Math.max(...snap.docs.map(d => d.data().id || 0));
      const item  = { id: maxId + 1, title: req.body.title || '', year, location, description, mediaType, images, video, videoPoster, productIds };
      await _db.collection('projects').doc(String(item.id)).set(item);
      await mirrorProjectToProducts(item.id, item.productIds, []);
      return res.status(201).json(item);
    }
    const list  = readLocalJSON(PROJECTS_FILE) || [];
    const maxId = list.reduce((m, p) => Math.max(m, p.id), 0);
    const item  = { id: maxId + 1, title: req.body.title || '', year, location, description, mediaType, images, video, videoPoster, productIds };
    list.push(item);
    writeLocalJSON(PROJECTS_FILE, list);
    await mirrorProjectToProducts(item.id, item.productIds, []);
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const patch = {};
    if (req.body.title !== undefined)        patch.title       = req.body.title;
    if (req.body.year !== undefined)         patch.year        = req.body.year;
    if (req.body.location !== undefined)     patch.location    = req.body.location;
    if (req.body.description !== undefined)  patch.description = req.body.description;
    if (req.body.mediaType !== undefined)    patch.mediaType   = req.body.mediaType === 'video' ? 'video' : 'carousel';
    if (req.body.video !== undefined)        patch.video       = req.body.video;
    if (req.body.videoPoster !== undefined)  patch.videoPoster = req.body.videoPoster;
    if (Array.isArray(req.body.images))      patch.images   = req.body.images;
    if (Array.isArray(req.body.productIds))  patch.productIds = req.body.productIds;
    if (USE_FB) {
      const ref  = _db.collection('projects').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Proyek tidak ditemukan' });
      const prev    = snap.data();
      const updated = { ...prev, ...patch, id };
      await ref.set(updated);
      if (patch.productIds) await mirrorProjectToProducts(id, updated.productIds || [], prev.productIds || []);
      // Removed images: delete the actual files from Storage.
      if (patch.images !== undefined) {
        const gone = (prev.images || []).filter(u => !(updated.images || []).includes(u));
        for (const u of gone) await deleteImageByUrl(u);
      }
      // Drop the old video/poster from storage if they were replaced or removed.
      if (prev.video && prev.video !== updated.video) await deleteImageByUrl(prev.video);
      if (prev.videoPoster && prev.videoPoster !== updated.videoPoster) await deleteImageByUrl(prev.videoPoster);
      return res.json(updated);
    }
    const list = readLocalJSON(PROJECTS_FILE) || [];
    const idx  = list.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Proyek tidak ditemukan' });
    const prev    = list[idx];
    const prevIds = prev.productIds || [];
    list[idx] = { ...prev, ...patch, id };
    writeLocalJSON(PROJECTS_FILE, list);
    if (patch.productIds) await mirrorProjectToProducts(id, list[idx].productIds || [], prevIds);
    if (patch.images !== undefined) {
      const gone = (prev.images || []).filter(u => !(list[idx].images || []).includes(u));
      for (const u of gone) await deleteImageByUrl(u);
    }
    if (prev.video && prev.video !== list[idx].video) await deleteImageByUrl(prev.video);
    if (prev.videoPoster && prev.videoPoster !== list[idx].videoPoster) await deleteImageByUrl(prev.videoPoster);
    res.json(list[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      const ref  = _db.collection('projects').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Proyek tidak ditemukan' });
      const { productIds, images, video, videoPoster } = snap.data();
      await ref.delete();
      await mirrorProjectToProducts(id, [], productIds || []);
      for (const u of (images || [])) await deleteImageByUrl(u);
      await deleteImageByUrl(video);
      await deleteImageByUrl(videoPoster);
      return res.json({ ok: true });
    }
    const list = readLocalJSON(PROJECTS_FILE) || [];
    const item = list.find(p => p.id === id);
    if (!item) return res.status(404).json({ error: 'Proyek tidak ditemukan' });
    writeLocalJSON(PROJECTS_FILE, list.filter(p => p.id !== id));
    await mirrorProjectToProducts(id, [], item.productIds || []);
    for (const u of (item.images || [])) await deleteImageByUrl(u);
    await deleteImageByUrl(item.video);
    await deleteImageByUrl(item.videoPoster);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// News (berita — title, photo/video, description, date)
// ============================================================
function newsFields(body) {
  return {
    title:       body.title || '',
    mediaType:   body.mediaType === 'video' ? 'video' : 'image',
    media:       body.media || '',
    mediaPoster: body.mediaPoster || '',
    description: body.description || '',
    date:        body.date || new Date().toISOString().slice(0, 10),
  };
}

app.get('/api/news', async (req, res) => {
  try {
    // Pagination is opt-in: pass ?page=1&limit=4 to get a paginated envelope
    // ({ items, total, page, limit, hasMore }). Without these params the
    // endpoint returns the full array as before (used by the admin list).
    const paginate = req.query.page != null || req.query.limit != null;
    const limit    = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 4));
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset   = (page - 1) * limit;

    if (USE_FB) {
      const col = _db.collection('news').orderBy('date', 'desc');
      if (!paginate) {
        const snap = await col.get();
        return res.json(snap.docs.map(d => d.data()));
      }
      const total = (await _db.collection('news').count().get()).data().count;
      const snap  = await col.offset(offset).limit(limit).get();
      const items = snap.docs.map(d => d.data());
      return res.json({ items, total, page, limit, hasMore: offset + items.length < total });
    }

    const list = readLocalJSON(NEWS_FILE) || [];
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!paginate) return res.json(list);
    const items = list.slice(offset, offset + limit);
    res.json({ items, total: list.length, page, limit, hasMore: offset + items.length < list.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/news', requireAuth, async (req, res) => {
  try {
    if (USE_FB) {
      const snap  = await _db.collection('news').get();
      const maxId = snap.empty ? 0 : Math.max(...snap.docs.map(d => d.data().id || 0));
      const item  = { id: maxId + 1, ...newsFields(req.body) };
      await _db.collection('news').doc(String(item.id)).set(item);
      return res.status(201).json(item);
    }
    const list  = readLocalJSON(NEWS_FILE) || [];
    const maxId = list.reduce((m, n) => Math.max(m, n.id), 0);
    const item  = { id: maxId + 1, ...newsFields(req.body) };
    list.push(item);
    writeLocalJSON(NEWS_FILE, list);
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/news/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const patch = {};
    if (req.body.title !== undefined)       patch.title       = req.body.title;
    if (req.body.mediaType !== undefined)   patch.mediaType   = req.body.mediaType === 'video' ? 'video' : 'image';
    if (req.body.media !== undefined)       patch.media       = req.body.media;
    if (req.body.mediaPoster !== undefined) patch.mediaPoster = req.body.mediaPoster;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.date !== undefined)        patch.date        = req.body.date;
    if (USE_FB) {
      const ref  = _db.collection('news').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Berita tidak ditemukan' });
      const updated = { ...snap.data(), ...patch, id };
      await ref.set(updated);
      return res.json(updated);
    }
    const list = readLocalJSON(NEWS_FILE) || [];
    const idx  = list.findIndex(n => n.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    list[idx] = { ...list[idx], ...patch, id };
    writeLocalJSON(NEWS_FILE, list);
    res.json(list[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/news/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      const ref  = _db.collection('news').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Berita tidak ditemukan' });
      await ref.delete();
      // best-effort: remove this post's comments
      const cs = await _db.collection('comments').where('newsId', '==', id).get();
      const batch = _db.batch();
      cs.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      return res.json({ ok: true });
    }
    const list = readLocalJSON(NEWS_FILE) || [];
    if (!list.find(n => n.id === id)) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    writeLocalJSON(NEWS_FILE, list.filter(n => n.id !== id));
    const comments = readLocalJSON(COMMENTS_FILE) || [];
    writeLocalJSON(COMMENTS_FILE, comments.filter(c => c.newsId !== id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// FAQ (frequently asked questions — managed from the back office)
// Model: { id, question, answer, order }. `answer` is plain text; the homepage
// renders blank-line-separated blocks as paragraphs, "- " lines as bullet
// lists, and "1." lines as numbered lists (see renderAnswer in main.js).
// ============================================================
async function readFaq() {
  if (USE_FB) {
    const snap = await _db.collection('faq').get();
    return snap.docs.map(d => d.data()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  const list = readLocalJSON(FAQ_FILE) || [];
  return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

app.get('/api/faq', async (_, res) => {
  try {
    res.json(await readFaq());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/faq', requireAuth, async (req, res) => {
  try {
    const list     = await readFaq();
    const maxId    = list.reduce((m, f) => Math.max(m, f.id || 0), 0);
    const maxOrder = list.reduce((m, f) => Math.max(m, f.order || 0), 0);
    const item = { id: maxId + 1, question: req.body.question || '', answer: req.body.answer || '', order: maxOrder + 1 };
    if (USE_FB) {
      await _db.collection('faq').doc(String(item.id)).set(item);
    } else {
      writeLocalJSON(FAQ_FILE, [...(readLocalJSON(FAQ_FILE) || []), item]);
    }
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reorder — body: { ids: [orderedIds...] }. Sets each FAQ's order to its index.
app.put('/api/faq', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
    if (!ids) return res.status(400).json({ error: 'ids harus berupa array' });
    if (USE_FB) {
      const batch = _db.batch();
      ids.forEach((id, i) => batch.update(_db.collection('faq').doc(String(id)), { order: i + 1 }));
      await batch.commit();
    } else {
      const byId = new Map((readLocalJSON(FAQ_FILE) || []).map(f => [f.id, f]));
      ids.forEach((id, i) => { const f = byId.get(id); if (f) f.order = i + 1; });
      writeLocalJSON(FAQ_FILE, [...byId.values()]);
    }
    res.json(await readFaq());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/faq/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const patch = {};
    if (req.body.question !== undefined) patch.question = req.body.question;
    if (req.body.answer !== undefined)   patch.answer   = req.body.answer;
    if (USE_FB) {
      const ref  = _db.collection('faq').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'FAQ tidak ditemukan' });
      const updated = { ...snap.data(), ...patch, id };
      await ref.set(updated);
      return res.json(updated);
    }
    const list = readLocalJSON(FAQ_FILE) || [];
    const idx  = list.findIndex(f => f.id === id);
    if (idx === -1) return res.status(404).json({ error: 'FAQ tidak ditemukan' });
    list[idx] = { ...list[idx], ...patch, id };
    writeLocalJSON(FAQ_FILE, list);
    res.json(list[idx]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/faq/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (USE_FB) {
      await _db.collection('faq').doc(String(id)).delete();
    } else {
      writeLocalJSON(FAQ_FILE, (readLocalJSON(FAQ_FILE) || []).filter(f => f.id !== id));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Comment auth — phone OTP for website visitors who want to comment.
// Reuses the OTP store with a 'c:' key namespace so it doesn't clash with
// the document-download OTP flow. On success a 30-day phone-session token is
// issued; the visitor's display name is asked once and stored in `users`.
// ============================================================
app.post('/api/comment-auth/send', async (req, res) => {
  try {
    const normalized = normalizePhone(String(req.body.phone || ''));
    if (normalized.length < 10 || normalized.length > 15) return res.status(400).json({ error: 'Nomor HP tidak valid' });

    const key = 'c:' + normalized;
    const existing = otpStore.get(key);
    if (existing && existing.lastSent > Date.now() - 60_000) {
      const wait = Math.ceil((existing.lastSent + 60_000 - Date.now()) / 1000);
      return res.status(429).json({ error: `Tunggu ${wait} detik sebelum kirim ulang` });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(key, { otp, expires: Date.now() + 5 * 60_000, attempts: 0, lastSent: Date.now() });
    await sendWhatsApp(normalized, `Kode OTP komentar Inti Atap Anda:\n\n*${otp}*\n\nBerlaku 5 menit. Jangan bagikan kode ini ke siapapun.`);
    res.json({ ok: true, dev: !FONNTE_TOKEN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comment-auth/verify', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const normalized = normalizePhone(String(phone || ''));
    const key   = 'c:' + normalized;
    const entry = otpStore.get(key);
    if (!entry)                           return res.status(400).json({ error: 'OTP tidak ditemukan atau sudah kadaluarsa' });
    if (entry.expires < Date.now())       { otpStore.delete(key); return res.status(400).json({ error: 'OTP sudah kadaluarsa. Minta kode baru.' }); }
    if (entry.attempts >= 3)              return res.status(400).json({ error: 'Terlalu banyak percobaan. Minta kode baru.' });
    if (entry.otp !== String(otp || '').trim()) {
      entry.attempts++;
      otpStore.set(key, entry);
      return res.status(400).json({ error: `Kode salah. ${3 - entry.attempts} percobaan tersisa.` });
    }

    otpStore.delete(key);
    await recordVerifiedPhone(normalized, 'comment');
    const name  = await getUserName(normalized);
    const token = signUserToken(normalized, name);
    res.json({ ok: true, token, name, needName: !name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comment-auth/name', requireUser, async (req, res) => {
  try {
    const name = (req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
    await setUserName(req.user.phone, name);
    res.json({ ok: true, token: signUserToken(req.user.phone, name), name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// News comments
// ============================================================
function publicComment(c) {
  return { id: c.id, name: c.name, text: c.text, createdAt: c.createdAt, updatedAt: c.updatedAt || null };
}
async function newsExists(newsId) {
  if (USE_FB) return (await _db.collection('news').doc(String(newsId)).get()).exists;
  return (readLocalJSON(NEWS_FILE) || []).some(n => n.id === newsId);
}

app.get('/api/news/:id/comments', async (req, res) => {
  try {
    const newsId = Number(req.params.id);
    let list;
    if (USE_FB) {
      const snap = await _db.collection('comments').where('newsId', '==', newsId).get();
      list = snap.docs.map(d => d.data());
    } else {
      list = (readLocalJSON(COMMENTS_FILE) || []).filter(c => c.newsId === newsId);
    }
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    res.json(list.map(publicComment));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The signed-in visitor's own comment on this post (so the UI can prefill/edit)
app.get('/api/news/:id/my-comment', requireUser, async (req, res) => {
  try {
    const newsId = Number(req.params.id);
    if (USE_FB) {
      const snap = await _db.collection('comments').doc(newsId + '_' + req.user.phone).get();
      return res.json(snap.exists ? publicComment(snap.data()) : {});
    }
    const c = (readLocalJSON(COMMENTS_FILE) || []).find(x => x.newsId === newsId && x.phone === req.user.phone);
    res.json(c ? publicComment(c) : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create or update the visitor's single comment for this post
app.post('/api/news/:id/comments', requireUser, async (req, res) => {
  try {
    const newsId = Number(req.params.id);
    const text   = (req.body.text || '').trim().slice(0, 500);
    if (!text)          return res.status(400).json({ error: 'Komentar tidak boleh kosong' });
    if (!req.user.name) return res.status(400).json({ error: 'Nama diperlukan' });
    if (!(await newsExists(newsId))) return res.status(404).json({ error: 'Berita tidak ditemukan' });

    const now = new Date().toISOString();
    if (USE_FB) {
      const ref  = _db.collection('comments').doc(newsId + '_' + req.user.phone);
      const snap = await ref.get();
      const item = {
        id: newsId + '_' + req.user.phone,
        newsId, phone: req.user.phone, name: req.user.name, text,
        createdAt: snap.exists ? snap.data().createdAt : now,
        updatedAt: now,
      };
      await ref.set(item);
      return res.status(201).json(publicComment(item));
    }

    const list = readLocalJSON(COMMENTS_FILE) || [];
    const idx  = list.findIndex(c => c.newsId === newsId && c.phone === req.user.phone);
    let saved;
    if (idx >= 0) {
      list[idx] = { ...list[idx], name: req.user.name, text, updatedAt: now };
      saved = list[idx];
    } else {
      const maxId = list.reduce((m, c) => Math.max(m, typeof c.id === 'number' ? c.id : 0), 0);
      saved = { id: maxId + 1, newsId, phone: req.user.phone, name: req.user.name, text, createdAt: now };
      list.push(saved);
    }
    writeLocalJSON(COMMENTS_FILE, list);
    res.status(201).json(publicComment(saved));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: delete a single comment from a news post (back office moderation)
app.delete('/api/news/:newsId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const newsId    = Number(req.params.newsId);
    const commentId = String(req.params.commentId);
    if (USE_FB) {
      const ref  = _db.collection('comments').doc(commentId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Komentar tidak ditemukan' });
      await ref.delete();
      return res.json({ ok: true });
    }
    const list   = readLocalJSON(COMMENTS_FILE) || [];
    const before = list.length;
    const next   = list.filter(c => !(String(c.id) === commentId && c.newsId === newsId));
    if (next.length === before) return res.status(404).json({ error: 'Komentar tidak ditemukan' });
    writeLocalJSON(COMMENTS_FILE, next);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Seed Firestore and start server
// ============================================================
if (USE_FB) {
  seedFirestore().catch(console.error);
  ensureBucketCors().catch(console.error);
}

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
