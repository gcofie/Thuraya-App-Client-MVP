'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const parent = '31b4b8c1f9243e8a43aa4a4a50a4869b0d4df8bd';
const normalize = text => text.replace(/\r\n/g, '\n');
let original;
function parentSource() {
    if (!original) original = normalize(cp.execFileSync('git', ['show', parent + ':app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 20e6 }));
    return original;
}
function section(text) {
    const start = text.indexOf('    function quickEditV4FinancialContext(');
    const end = text.indexOf('    function quickEditV4RecordState(', start);
    assert.ok(start >= 0 && end > start);
    return text.slice(start, end);
}
function replaceOnce(text, before, after) {
    assert.equal(text.split(before).length, 2, 'Exact approved plumbing must occur once: ' + before);
    return text.replace(before, after);
}
// Reconstruct the certified production source from only the exact reviewed helper
// and six explicit argument/read changes. All remaining bytes must equal parent.
function baselineSource(file, text) {
    text = require('./hubtel-diagnostics-source-parity.cjs').baselineSource(file, text);
    if (file !== 'app.js') return text;
    text = normalize(text);
    if (text === parentSource()) return text;
    assert.equal(crypto.createHash('sha256').update(section(text)).digest('hex'),
        '9763d07cebf99e2fba6b4d19724021cdbcb49326f117e77a6da780496a65ddd3', 'Exact reviewed service-edit evidence helper');
    text = text.replace(section(text), section(parentSource()));
    for (const [before, after] of [
        ['function buildQuickEditV4CanonicalFinancials(services, duration, amount, linkedEvidence)', 'function buildQuickEditV4CanonicalFinancials(services, duration, amount)'],
        ['quickEditV4FinancialContext(activeAppointmentData, linkedEvidence)', 'quickEditV4FinancialContext(activeAppointmentData)'],
        ["            const linkedEvidence = await quickEditV4ReadLinkedEvidence(activeAppointmentId, activeAppointmentData);\n", ''],
        ["const latest = await db.collection('Appointments').doc(activeAppointmentId).get({ source: 'server' });", "const latest = await db.collection('Appointments').doc(activeAppointmentId).get();"],
        ['!latest.exists || latest.metadata?.fromCache || quickEditV4RecordState', '!latest.exists || quickEditV4RecordState'],
        ['buildQuickEditV4CanonicalFinancials(services, duration, amount, linkedEvidence);', 'buildQuickEditV4CanonicalFinancials(services, duration, amount);']
    ]) text = replaceOnce(text, before, after);
    assert.equal(text, parentSource(), 'No source changes outside reviewed Quick Edit eligibility/read plumbing');
    return text;
}
module.exports = { baselineSource, parentSource, parent };
