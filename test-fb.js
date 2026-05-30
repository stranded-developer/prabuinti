const admin = require('firebase-admin');
const serviceAccount = require('./prabu-inti-firebase-adminsdk-fbsvc-14b033157e.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log('SDK init OK, project:', serviceAccount.project_id);
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore(admin.app(), '(default)');
db.settings({ preferRest: true });
console.log('Firestore instance created, attempting write...');

db.collection('test').doc('ping').set({ ok: true })
  .then(() => { console.log('Write OK'); process.exit(0); })
  .catch(e => { console.error('Write failed:', e.code, e.message); process.exit(1); });

setTimeout(() => { console.error('Timed out after 10s'); process.exit(1); }, 10000);
