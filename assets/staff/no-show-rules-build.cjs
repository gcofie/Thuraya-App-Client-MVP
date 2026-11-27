'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict');
const fragment = `
    // No Show transitions and their idempotency receipts are server-owned.
    match /No_Show_Commands/{document=**} { allow read, write: if false; }
    function noShowStatus(value) {
      return value is string && value.lower().matches('[ \\t\\n\\r]*no[ _\\t\\n\\r-]*show[ \\t\\n\\r]*');
    }
    function noShowState(data) {
      return noShowStatus(data.get('status', '')) || noShowStatus(data.get('serviceStatus', ''));
    }
    function noShowCreateSafe() {
      return !noShowState(request.resource.data)
        && !request.resource.data.keys().hasAny(['noShowAt', 'noShowBy'])
        && request.resource.data.get('autoNoShow', false) != true;
    }
    function noShowUpdateSafe() {
      return (noShowState(resource.data) || noShowState(request.resource.data))
        ? request.resource.data.diff(resource.data).affectedKeys().hasOnly(['notes', 'internalNotes', 'updatedAt'])
        : !request.resource.data.diff(resource.data).affectedKeys().hasAny(['noShowAt', 'noShowBy', 'autoNoShow']);
    }
`;
for (const profile of ['production', 'staging']) {
    const base = fs.readFileSync(`${__dirname}/firestore.${profile}-gift.rules`, 'utf8').replace(/\r\n/g, '\n');
    let next = base.replace('    // Gift credentials,', fragment + '\n    // Gift credentials,');
    assert.notEqual(next, base);
    next = next.replace('allow create: if !hasGiftEvidence(request.resource.data);', 'allow create: if !hasGiftEvidence(request.resource.data) && noShowCreateSafe();')
        .replaceAll('allow create: if request.auth != null && !hasGiftEvidence(request.resource.data);', 'allow create: if request.auth != null && !hasGiftEvidence(request.resource.data) && noShowCreateSafe();')
        .replaceAll('allow update: if request.auth != null && giftSafeUpdate();', 'allow update: if request.auth != null && giftSafeUpdate() && noShowUpdateSafe();')
        .replaceAll('allow delete: if request.auth != null && !hasGiftEvidence(resource.data);', 'allow delete: if request.auth != null && !hasGiftEvidence(resource.data) && !noShowState(resource.data);')
        .replaceAll('"Gift_Checkouts", "Active_Jobs"', '"Gift_Checkouts", "No_Show_Commands", "Active_Jobs"');
    const file = `${__dirname}/firestore.${profile}-noshow.rules`;
    if (process.argv.includes('--check')) assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), next);
    else fs.writeFileSync(file, next);
}
console.log('No Show rules profiles match Gift baseline plus lifecycle boundary');
