'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { SERVICES, category, publicAddress, parseEgress, createTransport, probeService } = require('./hubtel-diagnostics-backend/network');
const { CAPABILITIES, authorize, createService } = require('./hubtel-diagnostics-backend/service');
const PROJECT = 'thuraya-staging';
const auth = { uid: 'staff-fixture', token: { email: 'staff@fixture.invalid', aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT } };
const request = (command = 'run') => ({ auth, data: { projectId: PROJECT, command } });
const profile = { roles: ['Manager'], active: true };
const error = code => Object.assign(new Error('secret raw payload MUST NOT LEAK'), { code });
const fake = (overrides = {}) => ({
    egress: async () => '8.8.8.8', resolve: async () => ({ ipv4: ['8.8.8.8', '1.1.1.1'], ipv6: ['2606:4700:4700::1111'] }),
    tcp: async () => ({}), tls: async () => ({ certificateValid: true, hostnameMatches: true, certificateExpiry: '2030-01-01T00:00:00.000Z', tlsVersion: 'TLSv1.3' }),
    https: async () => ({ httpStatus: 404 }), ...overrides
});
for (const role of ['Admin', 'Manager', 'System Admin']) test('RBAC allows explicit capability for ' + role, async () => {
    assert.deepEqual((await authorize(request(), PROJECT, async () => ({ roles: [role] }))).capabilities, CAPABILITIES);
});
for (const role of ['Technician', 'Assistant Manager', 'Superadmin', 'Client', '']) test('RBAC denies ' + (role || 'missing role'), async () => {
    await assert.rejects(authorize(request(), PROJECT, async () => ({ roles: [role] })), { code: 'permission-denied' });
});
for (const [label, change, staff] of [
    ['missing auth', { auth: null }, profile], ['token role cannot override Staff profile', { auth: { ...auth, token: { ...auth.token, roles: ['Admin'] } } }, { roles: ['Technician'] }],
    ['wrong environment', { auth: { ...auth, token: { ...auth.token, aud: 'thuraya-client-telling' } } }, profile],
    ['wrong issuer', { auth: { ...auth, token: { ...auth.token, iss: 'evil' } } }, profile],
    ['profile inactive', {}, { ...profile, active: false }], ['profile disabled', {}, { ...profile, disabled: true }],
    ['profile terminated', {}, { ...profile, status: 'Terminated' }], ['profile uid mismatch', {}, { ...profile, uid: 'other' }],
    ['missing profile', {}, null], ['path substitution', { auth: { ...auth, token: { ...auth.token, email: 'Users/other' } } }, profile]
]) test('authorization: ' + label, async () => {
    await assert.rejects(authorize({ ...request(), ...change }, PROJECT, async () => staff));
});
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) test('egress parser accepts public ' + ip, () => assert.equal(parseEgress(' ' + ip + '\n'), ip));
for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', '2001:db8::1', 'not ip', '<script>']) test('egress rejects private/reserved/malformed ' + ip, () => {
    assert.equal(publicAddress(ip), false); assert.throws(() => parseEgress(ip));
});
for (const status of [200, 301, 401, 403, 404, 405, 500]) test('HTTPS ' + status + ' proves network, not application success', async () => {
    const result = await probeService(SERVICES[0], fake({ https: async () => ({ httpStatus: status }) }));
    assert.equal(result.httpsReachable, true); assert.equal(result.httpStatus, status); assert.equal(result.httpsStatus, 'NETWORK_REACHABLE');
});
for (const [phase, field, code, expected] of [
    ['resolve', 'dnsStatus', 'ENOTFOUND', 'DNS_FAILURE'], ['resolve', 'dnsStatus', 'TIMEOUT', 'TIMEOUT'],
    ['tcp', 'tcp443Status', 'ECONNREFUSED', 'CONNECTION_REFUSED'], ['tcp', 'tcp443Status', 'TIMEOUT', 'TIMEOUT'],
    ['tls', 'tlsStatus', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS_CERTIFICATE_INVALID'],
    ['tls', 'tlsStatus', 'ERR_TLS_CERT_ALTNAME_INVALID', 'TLS_HOSTNAME_MISMATCH'],
    ['https', 'httpsStatus', 'TIMEOUT', 'TIMEOUT'], ['https', 'httpsStatus', 'UNKNOWN_SECRET', 'NETWORK_ERROR']
]) test(phase + ' failure safely classified: ' + code, async () => {
    const result = await probeService(SERVICES[0], fake({ [phase]: async () => { throw error(code); } }));
    assert.equal(result.errorCategory, expected); assert.equal(result[field], expected === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL');
    assert.equal(result.httpsReachable, false); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('safe error redaction does not preserve arbitrary provider messages', () => assert.equal(category(error('secret')), 'NETWORK_ERROR'));
test('multiple IPv4 and IPv6 answers are retained, selected probe address explicit', async () => {
    const result = await probeService(SERVICES[0], fake());
    assert.equal(result.resolvedIpv4.length, 2); assert.equal(result.resolvedIpv6.length, 1); assert.equal(result.probedDestinationIp, '8.8.8.8');
});
function networkHarness(options = {}) {
    const calls = [], sockets = [];
    class Resolver {
        async resolve4(host) { calls.push(['dns4', host]); if (options.dnsFail) throw error('ENOTFOUND'); if (options.dnsHang) return new Promise(() => {}); return options.addresses || ['8.8.8.8', '1.1.1.1']; }
        async resolve6() { if (options.dnsFail) throw error('ENODATA'); return []; }
        cancel() { calls.push(['cancel']); }
    }
    function socket(secure, config) {
        calls.push([secure ? 'tls' : 'tcp', config]);
        const s = new EventEmitter(); s.destroy = () => { s.destroyed = true; }; s.authorized = options.authorized !== false; s.remoteAddress = config.host;
        s.getPeerCertificate = () => ({ subjectaltname: 'DNS:' + (options.wrongHost ? 'wrong.invalid' : SERVICES[0].hostname), valid_to: options.expired ? 'Jan 1 2000' : 'Jan 1 2035' });
        s.getProtocol = () => 'TLSv1.3'; sockets.push(s);
        if (!options.hang) queueMicrotask(() => s.emit(options.socketError ? 'error' : secure ? 'secureConnect' : 'connect', options.socketError ? error(options.socketError) : undefined));
        return s;
    }
    function request(config, callback) {
        calls.push(['https', config]);
        const req = new EventEmitter(); req.destroy = () => { req.destroyed = true; }; req.end = () => {
            if (options.httpHang) return;
            queueMicrotask(() => {
                if (options.httpError) return req.emit('error', error(options.httpError));
                const res = new EventEmitter(); res.statusCode = options.status || 200; res.destroy = () => {};
                res.socket = { remoteAddress: '8.8.8.8', authorized: true,
                    getPeerCertificate: () => ({ subjectaltname: 'DNS:' + config.hostname, valid_to: 'Jan 1 2035' }), getProtocol: () => 'TLSv1.3' };
                req.emit('finish');
                callback(res);
                if (config.method === 'GET') { res.emit('data', Buffer.from(options.body || '8.8.8.8')); res.emit('end'); }
            });
        }; return req;
    }
    return { transport: createTransport({ Resolver, connect: config => socket(false, config), secureConnect: config => socket(true, config), request, timeoutMs: 15 }), calls, sockets };
}
test('transport rejects unknown host and private resolved addresses', async () => {
    const { transport } = networkHarness({ addresses: ['127.0.0.1'] });
    await assert.rejects(transport.resolve('evil.invalid'), { code: 'HOST_NOT_ALLOWED' });
    await assert.rejects(transport.resolve(SERVICES[0].hostname), { code: 'UNSAFE_ADDRESS' });
    assert.throws(() => transport.tcp(SERVICES[0].hostname, '127.0.0.1'));
});
test('DNS timeout cancels resolver with no retry', async () => {
    const { transport, calls } = networkHarness({ dnsHang: true });
    await assert.rejects(transport.resolve(SERVICES[0].hostname), { code: 'TIMEOUT' });
    assert.equal(calls.filter(call => call[0] === 'cancel').length, 1);
});
test('DNS failure rejects', async () => await assert.rejects(networkHarness({ dnsFail: true }).transport.resolve(SERVICES[0].hostname), { code: 'ENOTFOUND' }));
test('TCP success destroys socket', async () => {
    const h = networkHarness(); await h.transport.tcp(SERVICES[0].hostname, '8.8.8.8'); assert.equal(h.sockets[0].destroyed, true);
});
for (const options of [{ hang: true }, { socketError: 'ECONNREFUSED' }]) test('TCP bounded failure ' + JSON.stringify(options), async () => {
    const h = networkHarness(options); await assert.rejects(h.transport.tcp(SERVICES[0].hostname, '8.8.8.8')); assert.equal(h.sockets[0].destroyed, true);
});
test('TLS strict SNI hostname, CA validation, expiry, minimum version', async () => {
    const h = networkHarness(); const result = await h.transport.tls(SERVICES[0].hostname, '8.8.8.8');
    assert.equal(result.hostnameMatches, true); assert.equal(result.certificateValid, true);
    assert.equal(h.calls[0][1].rejectUnauthorized, true); assert.equal(h.calls[0][1].servername, SERVICES[0].hostname); assert.equal(h.calls[0][1].minVersion, 'TLSv1.2');
});
for (const options of [{ authorized: false }, { wrongHost: true }, { expired: true }, { socketError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }]) test('TLS rejects ' + JSON.stringify(options), async () => {
    await assert.rejects(networkHarness(options).transport.tls(SERVICES[0].hostname, '8.8.8.8'));
});
test('Hubtel HTTP request is credential-free HEAD root only; pinned public address; no redirects', async () => {
    const h = networkHarness({ status: 302 }); const result = await h.transport.https(SERVICES[0].hostname, '8.8.8.8');
    const config = h.calls[0][1]; assert.equal(config.method, 'HEAD'); assert.equal(config.path, '/'); assert.equal(config.rejectUnauthorized, true); assert.equal(result.httpStatus, 302);
    assert.equal(config.auth, undefined); assert.equal(config.headers.Authorization, undefined); assert.equal(config.headers.Cookie, undefined); assert.equal(h.calls.length, 1);
    config.lookup('ignored', {}, (err, ip) => { assert.equal(err, null); assert.equal(ip, '8.8.8.8'); });
});
test('IP echo originates from same server transport and is bounded', async () => {
    const h = networkHarness(); assert.equal(await h.transport.egress(), '8.8.8.8'); assert.equal(h.calls.at(-1)[1].hostname, 'api.ipify.org');
    await assert.rejects(networkHarness({ body: 'x'.repeat(1025) }).transport.egress(), { code: 'PAYLOAD_LIMIT' });
});
test('HTTP timeout fails without retries', async () => await assert.rejects(networkHarness({ httpHang: true }).transport.https(SERVICES[0].hostname, '8.8.8.8'), { code: 'TIMEOUT' }));
function serviceFixture(overrides = {}) {
    const events = [], probes = [];
    const service = createService({ projectId: PROJECT, readStaff: async () => profile,
        transport: fake({ egress: async () => { probes.push('egress'); return '8.8.8.8'; } }),
        audit: async event => events.push(event), ...overrides });
    return { service, events, probes };
}
test('capabilities request grants only diagnostics and makes zero network/audit calls', async () => {
    const f = serviceFixture(); assert.deepEqual((await f.service(request('capabilities'))).capabilities, CAPABILITIES); assert.equal(f.probes.length, 0); assert.equal(f.events.length, 0);
});
test('diagnostic audit is safe and payment network false; allowlist not confirmed', async () => {
    const f = serviceFixture(); const result = await f.service(request());
    assert.equal(result.hubtelNetworkEnabled, false); assert.equal(result.allowlistConfirmation, 'NOT_CONFIRMED'); assert.equal(result.services.length, 3);
    assert.ok(result.executionPath.includes(PROJECT)); assert.equal(f.events[0].event, 'NETWORK_DIAGNOSTIC_RUN'); assert.equal(f.events[0].actor, auth.uid);
    assert.equal(f.events[0].correlationId, result.correlationId); assert.ok(!JSON.stringify(f.events).includes('staff@')); assert.ok(!JSON.stringify(f.events).includes('certificate'));
});
for (const extra of [{ url: 'https://evil.invalid' }, { hostname: SERVICES[0].hostname }, { credentials: 'secret' }, { transactionId: 'x' }, { allowlistConfirmation: 'CONFIRMED' }, { projectId: 'thuraya-client-telling' }, { command: 'pay' }]) test('request cannot introduce inputs ' + Object.keys(extra).join(','), async () => {
    const f = serviceFixture(); await assert.rejects(f.service({ ...request(), data: { ...request().data, ...extra } }), { code: 'invalid-argument' }); assert.equal(f.probes.length, 0);
});
test('unauthorized request never probes', async () => {
    const f = serviceFixture({ readStaff: async () => ({ role: 'Technician' }) }); await assert.rejects(f.service(request())); assert.equal(f.probes.length, 0);
});
test('repeated/concurrent runs are bounded, no automatic retries', async () => {
    const f = serviceFixture(); const first = f.service(request()); await assert.rejects(f.service(request()), { code: 'resource-exhausted' }); await first;
    await assert.rejects(f.service(request()), { code: 'resource-exhausted' }); assert.equal(f.events.length, 1);
});
test('egress failure does not invent source IP or prevent host diagnostics', async () => {
    const f = serviceFixture({ transport: fake({ egress: async () => { throw error('TIMEOUT'); } }) }); const result = await f.service(request());
    assert.equal(result.egressIp, null); assert.equal(result.expectedHubtelSourceIp, null); assert.equal(result.egressErrorCategory, 'TIMEOUT'); assert.equal(result.services[0].dnsStatus, 'PASS');
});
test('no business collections, secrets, legacy backend imports or transaction endpoints', () => {
    const files = ['index.js', 'network.js', 'network-engine.js', 'target-policy.js', 'profiles.js', 'service.js'].map(file => fs.readFileSync('hubtel-diagnostics-backend/' + file, 'utf8')).join('\n');
    assert.doesNotMatch(files, /Appointments|Active_Jobs|Sales|Commission|Orders|Payments|Refunds|Customer|Gift|Basic |Bearer |items\/initiate|transactions\/|refund\/|CLIENT_SECRET|API_KEY/);
    assert.match(files, /collection\('Users'\)/);
    assert.doesNotMatch(fs.readFileSync('hubtel-diagnostics-backend/index.js', 'utf8'), /\.set\(|\.update\(|\.delete\(|\.add\(|\.doc\(/);
});
test('browser has no direct HTTP probe and renders dynamic values as text only', () => {
    const source = fs.readFileSync('hubtel-diagnostics.js', 'utf8');
    assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|https:\/\/|\.innerHTML|\.outerHTML|insertAdjacentHTML/);
    assert.match(source, /httpsCallable\('hubtelNetworkDiagnostics'\)/);
});
test('existing Quick Edit and financial runtime remain byte-exact', () => {
    const before = cp.execFileSync('git', ['show', '303cb901:app.js'], { maxBuffer: 20e6 }).toString().replace(/\r\n/g, '\n');
    assert.equal(fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n'), before);
});
test('diagnostic HTML projection only accepts exact known insertions', () => {
    const parity = require('./hubtel-diagnostics-source-parity.cjs'); const html = fs.readFileSync('index.html', 'utf8');
    const projected = parity.baselineSource('index.html', html);
    assert.ok(!projected.includes('hubtel-diagnostics')); assert.throws(() => parity.baselineSource('index.html', html.replace('network-diagnostics-1', 'evil')));
    assert.throws(() => parity.baselineSource('index.html', html + parity.script));
});
test('egress stability distinguishes dynamic, insufficient, observed stable but never static', () => {
    const window = { document: { readyState: 'loading', addEventListener() {} } };
    vm.runInNewContext(fs.readFileSync('hubtel-diagnostics.js', 'utf8'), { window });
    const fn = window.ThurayaHubtelDiagnostics.stability;
    assert.equal(fn([{ egressIp: '8.8.8.8' }]), 'INSUFFICIENT_OBSERVATIONS');
    assert.equal(fn(Array(3).fill({ egressIp: '8.8.8.8' })), 'OBSERVED_STABLE_ACROSS_TEST_RUNS');
    assert.equal(fn([{ egressIp: '8.8.8.8' }, { egressIp: '1.1.1.1' }]), 'DYNAMIC_EGRESS');
});
test('browser capability gate, safe rendering, copy, signout race and four responsive widths', async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        const result = await serviceFixture().service(request());
        for (const width of [390, 662, 768, 1280]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 } });
            const outbound = []; await page.route('**/*', route => { outbound.push(route.request().url()); return route.abort(); });
            await page.setContent('<!doctype html><html><body style="margin:0;font-family:Arial"><main><nav id="topNavMenu"></nav></main></body></html>');
            await page.addStyleTag({ content: fs.readFileSync('hubtel-diagnostics.css', 'utf8') });
            await page.addScriptTag({ content: fs.readFileSync('hubtel-diagnostics.js', 'utf8') });
            await page.evaluate(async ({ result, capability }) => {
                window.copied = []; window.calls = []; window.switchModule = id => { document.getElementById(id).style.display = 'block'; };
                window.ThurayaHubtelDiagnostics.mount(document, { onAuthStateChanged: fn => { window.authListener = fn; } }, async ({ command }) => {
                    window.calls.push(command); return command === 'capabilities' ? { capabilities: capability } : result;
                }, { writeText: async text => window.copied.push(text) });
                await window.authListener({ uid: 'fixture' });
            }, { result, capability: CAPABILITIES });
            await page.getByText('Integrations', { exact: true }).click();
            await page.getByRole('button', { name: 'Run diagnostics', exact: true }).click();
            await page.getByText('Diagnostic run complete. Payment networking remains disabled.', { exact: true }).waitFor();
            assert.equal(await page.locator('tbody tr').count(), 3);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.getByRole('button', { name: 'Copy egress IP', exact: true }).click();
            assert.deepEqual(await page.evaluate(() => window.copied), ['8.8.8.8']);
            assert.deepEqual(outbound, []);
            if (process.env.HUBTEL_DIAGNOSTIC_SCREENSHOTS) await page.screenshot({ path: require('node:path').join(process.env.HUBTEL_DIAGNOSTIC_SCREENSHOTS, `hubtel-diagnostics-${width}.png`), fullPage: true });
            await page.evaluate(() => window.authListener(null));
            assert.equal(await page.locator('#tabHubtelDiagnostics').isVisible(), false);
            assert.equal(await page.locator('.hd-output').innerText(), '');
            await page.close();
        }
        const page = await browser.newPage(); await page.setContent('<main><nav id="topNavMenu"></nav></main>');
        await page.addScriptTag({ content: fs.readFileSync('hubtel-diagnostics.js', 'utf8') });
        const staleAllowed = await page.evaluate(async capability => {
            let listener, complete;
            const mounted = window.ThurayaHubtelDiagnostics.mount(document, { onAuthStateChanged: fn => { listener = fn; } },
                () => new Promise(resolve => { complete = resolve; }), {});
            const waiting = listener({ uid: 'fixture' }); await listener(null); complete({ capabilities: capability }); await waiting;
            return mounted.tab.style.display;
        }, CAPABILITIES);
        assert.equal(staleAllowed, 'none');
        assert.doesNotMatch(fs.readFileSync('hubtel-diagnostics.js', 'utf8'), /innerHTML|outerHTML/);
    } finally { await browser.close(); }
});

async function navigationFixture(role, check, width = 1280) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const outbound = [];
        await page.route('**/*', route => { outbound.push(route.request().url()); return route.abort(); });
        await page.setContent('<!doctype html><html><body><main id="appDashboard" style="display:block"><nav id="topNavMenu" style="display:flex"><div class="nav-tab" id="existingAllowed" style="display:flex">Existing allowed</div><div class="nav-tab" id="existingDenied">Existing denied</div></nav></main></body></html>');
        await page.addStyleTag({ content: fs.readFileSync('styles.css', 'utf8') });
        await page.addStyleTag({ content: fs.readFileSync('hubtel-diagnostics.css', 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync('hubtel-diagnostics.js', 'utf8') });
        let capabilities = [];
        try { capabilities = (await authorize(request(), PROJECT, async () => ({ roles: [role] }))).capabilities; }
        catch (error) { assert.equal(error.code, 'permission-denied'); }
        await page.evaluate(async capabilities => {
            window.navigationCalls = []; window.callableCommands = []; window.fixtureCapabilities = capabilities;
            window.switchModule = id => { window.navigationCalls.push(id); document.getElementById(id).style.display = 'block'; };
            window.ThurayaHubtelDiagnostics.mount(document, { onAuthStateChanged: fn => { window.fixtureAuth = fn; } }, async ({ command }) => {
                window.callableCommands.push(command);
                if (window.fixtureReject) throw Object.assign(new Error('Denied'), { code: 'functions/permission-denied' });
                return { capabilities: window.fixtureCapabilities };
            }, { writeText: async () => {} });
            await window.fixtureAuth({ uid: 'synthetic-navigation-fixture' });
        }, capabilities);
        await check(page);
        assert.deepEqual(outbound, []);
    } finally { await browser.close(); }
}

for (const role of ['Manager', 'Admin']) test('full Staff CSS: ' + role + ' capability reveals diagnostic navigation', async () => {
    await navigationFixture(role, async page => {
        assert.equal(await page.getByText('Integrations', { exact: true }).isVisible(), true);
        assert.equal(await page.locator('#tabHubtelDiagnostics').evaluate(el => getComputedStyle(el).display), 'flex');
        await page.getByText('Integrations', { exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true }).isEnabled(), true);
        assert.deepEqual(await page.evaluate(() => window.callableCommands), ['capabilities']);
    });
});

test('full Staff CSS: unauthorized capability keeps diagnostic navigation hidden', async () => {
    await navigationFixture('Technician', async page => {
        assert.equal(await page.locator('#tabHubtelDiagnostics').isVisible(), false);
        assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true, includeHidden: true }).isEnabled(), false);
    });
});

test('full Staff CSS: capability removal hides the open diagnostic panel', async () => {
    await navigationFixture('Manager', async page => {
        await page.getByText('Integrations', { exact: true }).click();
        await page.evaluate(async () => { window.fixtureCapabilities = []; await window.fixtureAuth({ uid: 'synthetic-navigation-fixture' }); });
        assert.equal(await page.locator('#tabHubtelDiagnostics').isVisible(), false);
        assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), false);
        assert.equal(await page.locator('.hd-output').textContent(), '');
    });
});

test('full Staff CSS: authorized direct radio navigation opens diagnostics', async () => {
    await navigationFixture('Manager', async page => {
        await page.locator('#nav_hubtel_diagnostics').evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        assert.deepEqual(await page.evaluate(() => window.navigationCalls), ['hubtelDiagnosticsView']);
        assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), true);
    });
});

test('full Staff CSS: unauthorized direct radio navigation remains denied', async () => {
    await navigationFixture('Technician', async page => {
        await page.locator('#nav_hubtel_diagnostics').evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        assert.deepEqual(await page.evaluate(() => window.navigationCalls), []);
        assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), false);
    });
});

test('full Staff CSS: default nav-tab rule is unchanged', async () => {
    await navigationFixture('Manager', async page => {
        assert.equal(await page.locator('#existingDenied').evaluate(el => getComputedStyle(el).display), 'none');
        assert.equal(fs.readFileSync('styles.css', 'utf8').replace(/\r\n/g, '\n'), cp.execFileSync('git', ['show', '88437106:styles.css'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'));
    });
});

test('full Staff CSS: other protected tabs are unaffected by diagnostics authorization', async () => {
    await navigationFixture('Manager', async page => {
        const before = await page.locator('#existingAllowed, #existingDenied').evaluateAll(nodes => nodes.map(n => n.outerHTML));
        await page.evaluate(() => window.fixtureAuth(null));
        assert.deepEqual(await page.locator('#existingAllowed, #existingDenied').evaluateAll(nodes => nodes.map(n => n.outerHTML)), before);
        assert.equal(await page.locator('#existingAllowed').isVisible(), true);
        assert.equal(await page.locator('#existingDenied').isVisible(), false);
    });
});

test('full Staff CSS: unauthorized diagnostic panel exposes no result or operation', async () => {
    await navigationFixture('Technician', async page => {
        assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), false);
        assert.equal(await page.locator('.hd-output').textContent(), '');
        assert.deepEqual(await page.evaluate(() => window.callableCommands), ['capabilities']);
        assert.equal(await page.locator('#hubtelDiagnosticsView button').evaluateAll(nodes => nodes.every(n => n.disabled)), true);
    });
});

test('full Staff CSS: backend capability rejection cannot be bypassed by prior Manager visibility', async () => {
    await navigationFixture('Manager', async page => {
        await page.evaluate(async () => { window.fixtureReject = true; await window.fixtureAuth({ uid: 'synthetic-navigation-fixture' }); });
        assert.equal(await page.locator('#tabHubtelDiagnostics').isVisible(), false);
        assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), false);
        assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true, includeHidden: true }).isEnabled(), false);
    });
});

test('full Staff CSS: existing RBAC hide pass cannot erase an authorized diagnostic tab', async () => {
    await navigationFixture('Manager', async page => {
        await page.locator('#tabHubtelDiagnostics').evaluate(el => { el.style.display = 'none'; });
        await page.waitForFunction(() => getComputedStyle(document.getElementById('tabHubtelDiagnostics')).display === 'flex');
        assert.equal(await page.locator('#existingDenied').isVisible(), false);
    });
});

for (const width of [390, 662, 768, 1280]) test('full Staff CSS: diagnostic entry and controls remain visible at ' + width, async () => {
    await navigationFixture('Manager', async page => {
        await page.getByText('Integrations', { exact: true }).click();
        assert.equal(await page.getByRole('heading', { name: 'Network Diagnostics', exact: true }).isVisible(), true);
        assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true }).isVisible(), true);
        assert.deepEqual(await page.locator('#hubtelDiagnosticsView button').allTextContents(), ['Run diagnostics', 'Run all Hubtel presets', 'Compare Hubtel presets with custom URL', 'Copy egress IP', 'Copy diagnostic summary']);
    }, width);
});
