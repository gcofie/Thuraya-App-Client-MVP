const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { check } = require('./commission-deployment-check.cjs');
const read = file => fs.readFileSync(require('node:path').join(__dirname, file), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const live = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    match /Clients/{docId} {
      allow read, create, update: if true;
      allow delete: if request.auth != null;
    }

    match /Appointments/{docId} {
      allow read, create: if true;
      allow update, delete: if request.auth != null;
    }

    match /Bookings/{docId} {
      allow read, create: if true;
      allow update, delete: if request.auth != null;
    }

    match /{document=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}`;
test('production Commission overlay reverses exactly to captured live rules', () => {
    assert.equal(crypto.createHash('sha256').update(live).digest('hex').toUpperCase(), 'AFE4B845D53F25065759F0BE6A9AEA0FA5F8919D1863063CE212EECD3DABAC46');
    const prod = read('firestore.production-commission.rules');
    const stage = read('firestore.rules');
    const start = prod.indexOf('    // Commission configuration');
    const fallback = prod.indexOf('    match /{collection}/{document=**}');
    const overlay = prod.slice(start, fallback);
    assert.ok(stage.includes(overlay), 'Commission protections exactly match certified staging source');
    const reversed = prod.slice(0, start) + live.slice(live.indexOf('    match /{document=**}'));
    assert.equal(reversed, live);
    assert.equal(prod.includes('Approval_Pin_Secrets'), false);
    assert.equal(prod.includes('Approval_Audit'), false);
    assert.ok(stage.includes('Approval_Pin_Secrets') && stage.includes('Approval_Audit'));
});
test('rules deployment profiles reject cross-project or unapproved production invocation', () => {
    assert.doesNotThrow(() => check('staging', { GCLOUD_PROJECT: 'thuraya-staging' }));
    assert.throws(() => check('staging', { GCLOUD_PROJECT: 'thuraya-client-telling' }), /staging-only/);
    assert.throws(() => check('production', { GCLOUD_PROJECT: 'thuraya-staging' }), /project/);
    assert.throws(() => check('production', { GCLOUD_PROJECT: 'thuraya-client-telling' }), /SHA-256/);
    assert.throws(() => check('production', { GCLOUD_PROJECT: 'thuraya-client-telling', THURAYA_COMMISSION_PRODUCTION_RULES_SHA256: '0'.repeat(64) }), /differ/);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname, 'firestore.production-commission.rules'))).digest('hex');
    assert.doesNotThrow(() => check('production', { GCLOUD_PROJECT: 'thuraya-client-telling', THURAYA_COMMISSION_PRODUCTION_RULES_SHA256: sha }));
});
test('dedicated production config deploys rules only and default config guards broader rules', () => {
    const production = JSON.parse(read('firebase.production-commission.json'));
    const normal = JSON.parse(read('firebase.json'));
    assert.deepEqual(Object.keys(production), ['firestore']);
    assert.equal(production.firestore.rules, 'firestore.production-commission.rules');
    assert.match(production.firestore.predeploy[0], /check.cjs production$/);
    assert.match(normal.firestore.predeploy[0], /check.cjs staging$/);
});
module.exports = { live };
