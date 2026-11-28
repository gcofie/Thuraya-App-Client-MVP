'use strict';
const assert = require('node:assert/strict'), cp = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const MAIN = '303cb9011df29665e4eaa74c25b4f62550c998dd';
const CERTIFIED = 'acf0a7cf9d8bac6ccf4034ed2403229b4a49e512';
const generic = require('./network-diagnostics-manifest.json');
const files = Object.freeze([
    'HUBTEL-NETWORK-DIAGNOSTICS.md', 'firebase.hubtel-diagnostics.json',
    'hubtel-diagnostics-backend/.gitignore', 'hubtel-diagnostics-backend/index.js',
    'hubtel-diagnostics-backend/network.js', 'hubtel-diagnostics-backend/package.json',
    'hubtel-diagnostics-backend/pnpm-lock.yaml', 'hubtel-diagnostics-backend/pnpm-workspace.yaml',
    'hubtel-diagnostics-backend/service.js', 'hubtel-diagnostics-source-parity.cjs',
    'hubtel-diagnostics.css', 'hubtel-diagnostics.js', 'hubtel-diagnostics.test.cjs',
    'hubtel-diagnostics-packaging.test.cjs', 'hubtel-diagnostics-production-parity.cjs',
    'hubtel-diagnostics-production.test.cjs', 'index.html', 'quick-edit-service-edit-parity.cjs',
    'NETWORK-DIAGNOSTICS-ARCHITECTURE.md', 'NETWORK-DIAGNOSTICS-CERTIFICATION.md',
    'network-diagnostics-manifest.json', 'network-diagnostics.test.cjs', 'network-diagnostics-ui.test.cjs',
    'hubtel-diagnostics-backend/network-engine.js', 'hubtel-diagnostics-backend/profiles.js', 'hubtel-diagnostics-backend/target-policy.js'
]);
const certificationOnly = ['hubtel-diagnostics-packaging.test.cjs', 'hubtel-diagnostics-production-parity.cjs', 'hubtel-diagnostics-production.test.cjs',
    'hubtel-diagnostics.test.cjs', 'network-diagnostics.test.cjs', 'network-diagnostics-ui.test.cjs', 'network-diagnostics-manifest.json',
    'NETWORK-DIAGNOSTICS-ARCHITECTURE.md', 'NETWORK-DIAGNOSTICS-CERTIFICATION.md'];
const normalize = value => value.toString().replace(/\r\n/g, '\n');
const git = args => cp.execFileSync('git', args, { cwd: __dirname, maxBuffer: 40e6 });
const cache = new Map();
function source(sha, file) {
    const key = sha + ':' + file;
    if (!cache.has(key)) cache.set(key, git(['show', key]));
    return cache.get(key);
}
function expectedHtml() {
    let value = normalize(source(MAIN, 'index.html'));
    const p = require('./hubtel-diagnostics-source-parity.cjs');
    for (const [anchor, addition] of [
        ['    <link rel="stylesheet" href="styles.css?v=staff-golive-tax-mode-hf16-20260509">\n', p.css],
        ['<script src="intelligence-engine-v1.js?v=phase-5-4-final2"></script>\n', p.script]
    ]) {
        assert.equal(value.split(anchor).length, 2);
        value = value.replace(anchor, anchor + addition);
    }
    return value;
}
function workingTree() {
    const names = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))];
    return new Map(names.map(file => [file, fs.readFileSync(path.join(__dirname, file))]));
}
function assertTree(view = workingTree()) {
    const baseline = git(['ls-tree', '-r', '--name-only', MAIN]).toString().trim().split('\n');
    const policy = 'hubtel-diagnostics-backend/pnpm-workspace.yaml';
    assert.ok(view.has(policy), 'Reviewed packaging policy required');
    assert.equal(normalize(view.get(policy)), 'strictDepBuilds: true\nallowBuilds:\n  protobufjs@7.6.6: true\n', 'Only exact reviewed protobufjs build approval');
    assert.deepEqual([...view.keys()].sort(), [...new Set([...baseline, ...files])].sort(), 'Exact union manifest; no extra runtime/config/secret or Refund R0 files');
    for (const file of view.keys()) {
        if (certificationOnly.includes(file)) continue;
        if (Object.hasOwn(generic.runtimeSha256, file)) {
            assert.equal(require('node:crypto').createHash('sha256').update(normalize(view.get(file))).digest('hex'), generic.runtimeSha256[file], 'Exact reviewed generic diagnostic source: ' + file);
            continue;
        }
        if (file === 'index.html') {
            assert.equal(normalize(view.get(file)), expectedHtml(), 'Only two exact diagnostic asset includes');
            continue;
        }
        const expected = source(files.includes(file) ? CERTIFIED : MAIN, file);
        const actual = view.get(file);
        if (expected.includes(0)) assert.ok(actual.equals(expected), 'Protected binary: ' + file);
        else assert.equal(normalize(actual), normalize(expected),
            'Exact reviewed Functions Framework packaging / diagnostic or protected source: ' + file);
    }
    return true;
}
module.exports = { MAIN, CERTIFIED, files, source, expectedHtml, workingTree, assertTree };
