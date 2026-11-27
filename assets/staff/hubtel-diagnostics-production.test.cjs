'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const parity = require('./hubtel-diagnostics-production-parity.cjs');
const { createService, CAPABILITIES } = require('./hubtel-diagnostics-backend/service');
const { PROFILES } = require('./hubtel-diagnostics-backend/profiles');
const PROJECT = 'thuraya-client-telling';
const request = (command = 'run') => ({ auth: { uid: 'synthetic-production-staff', token: {
    email: 'synthetic@fixture.invalid', aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT
} }, data: { projectId: PROJECT, command } });
function fixture(role = 'Manager') {
    const calls = [], audits = [];
    const service = createService({ projectId: PROJECT,
        readStaff: async email => { calls.push(['profile-read', email]); return { roles: [role], active: true }; },
        transport: {
            egress: async () => { calls.push(['egress']); return '8.8.8.8'; },
            resolve: async host => { calls.push(['dns', host]); return { ipv4: ['8.8.8.8'], ipv6: [] }; },
            tcp: async host => { calls.push(['tcp', host]); },
            tls: async host => { calls.push(['tls', host]); return { certificateValid: true, hostnameMatches: true }; },
            https: async host => { calls.push(['https', host]); return { httpStatus: 403 }; }
        }, audit: async event => audits.push(event) });
    return { service, calls, audits };
}
test('exact production-only manifest and certified diagnostic source parity', () => assert.equal(parity.assertTree(), true));
for (const file of ['refunds-v1.js', 'refunds-v1.css', 'functions/refunds/refund-endpoint.js', 'staging-integration-source-parity.cjs']) {
    test('production manifest rejects staging-only artifact: ' + file, () => {
        const view = parity.workingTree(); view.set(file, Buffer.from('forbidden'));
        assert.throws(() => parity.assertTree(view), /Exact union manifest/);
    });
}
for (const file of ['app.js', 'hubtel-diagnostics.js', 'hubtel-diagnostics-backend/network.js', 'functions/index.js']) {
    test('production parity rejects runtime drift: ' + file, () => {
        const view = parity.workingTree(); view.set(file, Buffer.concat([view.get(file), Buffer.from('\n// unreviewed')]));
        assert.throws(() => parity.assertTree(view), /Exact reviewed/);
    });
}
test('production HTML excludes Refund assets and exactly preserves existing includes', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.doesNotMatch(html, /refunds-v1|refundEvidence|refund-r0/i);
    assert.equal(require('./hubtel-diagnostics-source-parity.cjs').baselineSource('index.html', html), parity.source(parity.MAIN, 'index.html').toString().replace(/\r\n/g, '\n'));
});
for (const role of ['Manager', 'Admin', 'System Admin']) test('production local capability smoke: ' + role, async () => {
    const f = fixture(role), result = await f.service(request('capabilities'));
    assert.deepEqual(result, { capabilities: CAPABILITIES, environment: 'PRODUCTION', profiles: PROFILES });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.audits, []);
});
for (const role of ['Technician', 'Assistant Manager', '']) test('production unauthorized role has no probe: ' + (role || 'none'), async () => {
    const f = fixture(role); await assert.rejects(f.service(request()), { code: 'permission-denied' });
    assert.equal(f.calls.length, 1); assert.deepEqual(f.audits, []);
});
test('production anonymous denial precedes even profile reads', async () => {
    const f = fixture(); await assert.rejects(f.service({ ...request(), auth: null }), { code: 'unauthenticated' });
    assert.deepEqual(f.calls, []); assert.deepEqual(f.audits, []);
});
test('staging identity cannot authorize production diagnostics', async () => {
    const f = fixture(), r = request(); r.auth.token.aud = 'thuraya-staging';
    await assert.rejects(f.service(r), { code: 'permission-denied' }); assert.deepEqual(f.calls, []);
});
test('production synthetic local result retains safe payload, no payment authority or business writes', async () => {
    const f = fixture(), result = await f.service(request());
    assert.equal(result.environment, 'PRODUCTION'); assert.equal(result.projectId, PROJECT);
    assert.equal(result.executionPath, 'Firebase Functions v2 / thuraya-client-telling / us-central1 / hubtelNetworkDiagnostics');
    assert.equal(result.hubtelNetworkEnabled, false); assert.equal(result.allowlistConfirmation, 'NOT_CONFIRMED');
    assert.equal(result.services.length, 3); assert.equal(f.audits.length, 1);
    assert.ok(f.calls.every(([operation]) => ['profile-read', 'egress', 'dns', 'tcp', 'tls', 'https'].includes(operation)));
    assert.doesNotMatch(JSON.stringify(result), /synthetic@|password|Bearer|clientSecret|merchantAccount/);
});
test('production entrypoint reads only projected Staff identity and uses log-only audit', async () => {
    let handlerOptions, readStaff, audit;
    const operations = [];
    const query = {};
    for (const name of ['where', 'select', 'limit']) query[name] = (...args) => { operations.push([name, ...args]); return query; };
    query.get = async () => ({ empty: false, docs: [{ data: () => ({ roles: ['Manager'] }) }] });
    const firestore = () => ({ collection: name => { operations.push(['collection', name]); return query; } });
    firestore.FieldPath = { documentId: () => '__name__' };
    vm.runInNewContext(fs.readFileSync('hubtel-diagnostics-backend/index.js', 'utf8'), {
        exports: {}, process: { env: { GCLOUD_PROJECT: PROJECT } }, require(name) {
            if (name === 'firebase-admin') return { initializeApp() {}, firestore };
            if (name === 'firebase-functions/v2/https') return { onCall: options => { handlerOptions = options; }, HttpsError: Error };
            if (name === 'firebase-functions') return { logger: { info: (...args) => operations.push(['audit', ...args]) } };
            if (name === './network') return { createTransport: () => ({}) };
            if (name === './service') return { createService: options => { assert.equal(options.projectId, PROJECT); ({ readStaff, audit } = options); }, DiagnosticError: Error };
            throw new Error('Unexpected dependency');
        }
    });
    await readStaff('synthetic@fixture.invalid'); await audit({ event: 'SYNTHETIC' });
    assert.equal(handlerOptions.region, 'us-central1');
    assert.deepEqual(operations, [ ['collection', 'Users'], ['where', '__name__', '==', 'synthetic@fixture.invalid'],
        ['select', 'roles', 'role', 'active', 'disabled', 'status', 'uid'], ['limit', 1], ['audit', 'SYNTHETIC', { event: 'SYNTHETIC' }] ]);
});
