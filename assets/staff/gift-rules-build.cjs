'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = __dirname;
const fragment = fs.readFileSync(root + '/gift-security-rules.fragment', 'utf8').replace(/\r\n/g,'\n');
function build(source) {
    const baseline = source.replace(/\r\n/g,'\n');
    const appt = '    match /Appointments/{docId} {\n      allow read, create: if true;\n      allow update, delete: if request.auth != null;\n    }';
    assert.ok(baseline.includes(appt));
    let rules = baseline.replace(appt, '    match /Appointments/{docId} {\n      allow read: if true;\n      allow create: if !hasGiftEvidence(request.resource.data);\n      allow update: if request.auth != null && giftSafeUpdate();\n      allow delete: if request.auth != null && !hasGiftEvidence(resource.data);\n    }');
    rules = rules.replace('    match /{collection}/{document=**} {', fragment + '\n    match /{collection}/{document=**} {');
    const denyList = '["Commission_Rules", "Commission_Settings", "Commission_Locks", "Commission_Records"]';
    assert.equal(rules.split(denyList).length, 3);
    rules = rules.replaceAll(denyList, '["Commission_Rules", "Commission_Settings", "Commission_Locks", "Commission_Records", "Gift_Cards", "Gift_Card_Redemptions", "Gift_Checkouts", "Active_Jobs", "Appointments"]');
    return rules;
}
for (const [baseline, target] of [['firestore.production-commission.rules','firestore.production-gift.rules'], ['firestore.rules','firestore.staging-gift.rules']]) {
    const content = build(fs.readFileSync(root + '/' + baseline, 'utf8'));
    if (process.argv.includes('--check')) assert.equal(fs.readFileSync(root + '/' + target, 'utf8').replace(/\r\n/g,'\n'), content);
    else fs.writeFileSync(root + '/' + target, content);
    console.log(target + ' ' + crypto.createHash('sha256').update(content).digest('hex'));
}
module.exports = { build };
