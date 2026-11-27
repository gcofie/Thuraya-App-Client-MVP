'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { CAPABILITIES, VIEW } = require('./hubtel-diagnostics-backend/service');
async function fixture(check, width = 1280, capabilities = CAPABILITIES) {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const outbound = []; await page.route('**/*', route => { outbound.push(route.request().url()); return route.abort(); });
        await page.setContent('<!doctype html><html><body><main style="display:block"><nav id="topNavMenu" style="display:flex"></nav></main></body></html>');
        for (const file of ['styles.css', 'hubtel-diagnostics.css']) await page.addStyleTag({ content: fs.readFileSync(file, 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync('hubtel-diagnostics.js', 'utf8') });
        await page.evaluate(async capabilities => {
            window.commands = []; window.copied = [];
            window.switchModule = id => { document.getElementById(id).style.display = 'block'; };
            window.ThurayaHubtelDiagnostics.mount(document, { onAuthStateChanged: fn => { window.authChange = fn; } }, async data => {
                window.commands.push(data);
                if (data.command === 'capabilities') return { capabilities };
                if (window.failRun) throw { code: 'functions/unavailable' };
                const targets = data.command === 'runAll' ? ['Checkout', 'Status', 'Refund'] : data.command === 'compare' ? ['Checkout', 'Status', 'Refund', 'Custom'] : ['Custom'];
                return { environment: 'STAGING', executionPath: 'Firebase Functions v2 / thuraya-staging / us-central1 / hubtelNetworkDiagnostics', egressIp: '8.8.8.8', checkedAt: '2026-10-05T12:00:00.000Z', correlationId: 'synthetic-ui-correlation', services: targets.map(name => ({
                    name, safeTarget: 'public.example.org/[path-012345678901]', hostname: 'public.example.org', targetType: 'URL', method: name === 'Custom' ? data.target?.method : 'HEAD',
                    resolvedIpv4: ['8.8.8.8'], resolvedIpv6: ['2606:4700:4700::1111'], connectedIp: '8.8.8.8', dnsStatus: 'PASS', tcp443Status: 'PASS', tlsStatus: 'PASS', hostnameMatches: true,
                    certificateExpiry: '2030-01-01T00:00:00.000Z', httpsStatus: 'NETWORK_REACHABLE', httpStatus: 204, latencyMs: 125, checkedAt: '2026-10-05T12:00:00.000Z', sentAt: '2026-10-05T12:00:00.100Z'
                })) };
            }, { writeText: async value => window.copied.push(value) });
            await window.authChange({ uid: 'synthetic-ui' });
        }, capabilities);
        if (capabilities.includes(VIEW)) await page.getByText('Integrations', { exact: true }).click();
        await check(page); assert.deepEqual(outbound, []);
    } finally { await browser.close(); }
}
const done = page => page.getByText('Diagnostic run complete. Payment networking remains disabled.', { exact: true }).waitFor();
test('single predefined UI command contains exactly one preset', async () => fixture(async page => {
    await page.locator('#hd-profile').selectOption('HUBTEL_STATUS');
    await page.getByRole('button', { name: 'Run diagnostics', exact: true }).click(); await done(page);
    assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), { command: 'runTarget', target: { mode: 'PREDEFINED', profile: 'HUBTEL_STATUS' } });
}));
for (const [mode, value, method] of [['HOSTNAME', 'public.example.org', 'HEAD'], ['IP', '8.8.8.8', 'GET'], ['URL', 'https://public.example.org/synthetic', 'GET']])
    test('UI explicit custom selection ' + mode, async () => fixture(async page => {
        await page.locator('#hd-target-mode').selectOption(mode); await page.locator('#hd-custom-target').fill(value); await page.locator('#hd-method').selectOption(method);
        await page.getByRole('button', { name: 'Run diagnostics', exact: true }).click(); await done(page);
        assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), { command: 'runTarget', target: { mode, value, method } });
    }));
test('Run All never includes a populated custom URL or POST consent', async () => fixture(async page => {
    await page.locator('#hd-target-mode').selectOption('URL'); await page.locator('#hd-custom-target').fill('https://public.example.org/secret-path');
    await page.locator('#hd-method').selectOption('EMPTY_POST');
    await page.getByRole('button', { name: 'Run all Hubtel presets', exact: true }).click(); await done(page);
    assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), { command: 'runAll' });
    assert.equal(await page.locator('tbody tr').count(), 3);
}));
test('comparison requires deliberate custom URL and one-use empty POST consent', async () => fixture(async page => {
    const compare = page.getByRole('button', { name: 'Compare Hubtel presets with custom URL', exact: true });
    assert.equal(await compare.isEnabled(), false);
    await page.locator('#hd-target-mode').selectOption('URL'); await page.locator('#hd-custom-target').fill('https://public.example.org/secret-path');
    await page.locator('#hd-method').selectOption('EMPTY_POST'); assert.equal(await compare.isEnabled(), false);
    await page.locator('#hd-empty-post-consent').check(); await compare.click(); await done(page);
    assert.deepEqual(await page.evaluate(() => window.commands.at(-1)), { command: 'compare', target: { mode: 'URL', value: 'https://public.example.org/secret-path', method: 'EMPTY_POST' }, confirmEmptyPost: true });
    assert.equal(await page.locator('tbody tr').count(), 4); assert.equal(await compare.isEnabled(), false);
    assert.doesNotMatch(await page.locator('.hd-output').innerText(), /secret-path/);
    await page.getByRole('button', { name: 'Copy diagnostic summary' }).click();
    assert.doesNotMatch(await page.evaluate(() => window.copied[0]), /secret-path/);
}));
test('target change revokes POST consent', async () => fixture(async page => {
    await page.locator('#hd-target-mode').selectOption('URL'); await page.locator('#hd-custom-target').fill('https://public.example.org/a');
    await page.locator('#hd-method').selectOption('EMPTY_POST'); await page.locator('#hd-empty-post-consent').check();
    await page.locator('#hd-custom-target').fill('https://public.example.org/b');
    assert.equal(await page.locator('#hd-empty-post-consent').isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true }).isEnabled(), false);
}));
test('unknown POST outcome is not automatically retried', async () => fixture(async page => {
    await page.evaluate(() => { window.failRun = true; });
    await page.locator('#hd-target-mode').selectOption('URL'); await page.locator('#hd-custom-target').fill('https://public.example.org/synthetic');
    await page.locator('#hd-method').selectOption('EMPTY_POST'); await page.locator('#hd-empty-post-consent').check();
    await page.getByRole('button', { name: 'Run diagnostics', exact: true }).click();
    await page.getByText('Diagnostic outcome unavailable. No automatic retry.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.commands.length), 2);
    assert.equal(await page.getByRole('button', { name: 'Run diagnostics', exact: true }).isEnabled(), false);
}));
test('view capability alone cannot run any probe', async () => fixture(async page => {
    assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), true);
    assert.equal(await page.locator('#hubtelDiagnosticsView button').evaluateAll(nodes => nodes.every(n => n.disabled)), true);
    assert.equal(await page.evaluate(() => window.commands.length), 1);
}, 1280, [VIEW]));
test('unauthorized user has no visible panel or enabled control', async () => fixture(async page => {
    assert.equal(await page.locator('#hubtelDiagnosticsView').isVisible(), false);
    assert.equal(await page.locator('#tabHubtelDiagnostics').isVisible(), false);
    assert.equal(await page.locator('#hubtelDiagnosticsView button').evaluateAll(nodes => nodes.every(n => n.disabled)), true);
}, 1280, []));
for (const width of [390, 662, 768, 1280]) test('comparison responsive controls and output ' + width, async () => fixture(async page => {
    await page.locator('#hd-target-mode').selectOption('URL'); await page.locator('#hd-custom-target').fill('https://public.example.org/synthetic');
    await page.getByRole('button', { name: 'Compare Hubtel presets with custom URL', exact: true }).click(); await done(page);
    assert.equal(await page.locator('tbody tr').count(), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#hubtelDiagnosticsView button').evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth + 1)), true);
    if (process.env.HUBTEL_DIAGNOSTIC_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.HUBTEL_DIAGNOSTIC_SCREENSHOTS, 'network-comparison-' + width + '.png'), fullPage: true });
}, width));
