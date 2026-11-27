'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function check(mode, env = process.env) {
    if (mode === 'staging') {
        if (env.GCLOUD_PROJECT !== 'thuraya-staging') throw new Error('Broader repository rules are staging-only. Production Commission deployment requires its dedicated config.');
        return;
    }
    if (mode !== 'production' || env.GCLOUD_PROJECT !== 'thuraya-client-telling') throw new Error('Commission rules deployment project does not match the explicit profile.');
    const expected = env.THURAYA_COMMISSION_PRODUCTION_RULES_SHA256;
    if (!/^[a-fA-F0-9]{64}$/.test(expected || '')) throw new Error('Separate owner-approved production rules SHA-256 is required.');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'firestore.production-commission.rules'))).digest('hex');
    if (actual !== expected.toLowerCase()) throw new Error('Production Commission rules differ from the approved SHA-256.');
}
if (require.main === module) {
    try { check(process.argv[2]); console.log('Commission rules deployment profile verified.'); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { check };
