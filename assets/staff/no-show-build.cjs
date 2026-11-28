'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = __dirname, app = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const start = app.indexOf('    const APPOINTMENT_ALLOWED', app.indexOf('(function thurayaNoShowActiveJobReconciliationPatch2'));
const end = app.indexOf('    function noShowError', start);
assert.ok(start > 0 && end > start);
const individual = "'use strict';\n// Generated from the certified individual No Show evaluator.\nfunction isArchivedRecord(row) { return row?.archived === true; }\n" + app.slice(start, end) + '\nmodule.exports = { evaluateNoShow };\n';
const files = { 'functions/no-show-individual.generated.js': individual, 'functions/no-show-model.generated.js': fs.readFileSync(path.join(root, 'no-show-model.js'), 'utf8').replace(/\r\n/g, '\n') };
for (const [file, body] of Object.entries(files)) {
    const target = path.join(root, file);
    if (process.argv.includes('--check')) assert.equal(fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'), body, file);
    else fs.writeFileSync(target, body);
}
console.log('No Show generated-source parity PASS');
