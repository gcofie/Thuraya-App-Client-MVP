'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const current = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const engine = fs.readFileSync(__dirname + '/intelligence-engine-v1.js', 'utf8');
const parent = cp.execFileSync('git', ['show', 'cbac9925ed66660e85c8a1a898095bb824bac0d6:app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 20e6 }).replace(/\r\n/g, '\n');
function iife(source, marker) {
    const at = source.indexOf(marker), start = source.indexOf('(function () {', at), end = source.indexOf('\n})();', start);
    assert.ok(at >= 0 && start > at && end > start, marker);
    return source.slice(start, end + 7);
}
function scripts(source) {
    return [
        iife(source, '// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS'),
        ...(source===current?[iife(source,'// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD')]:[]),
        (source===current?engine:cp.execFileSync('git',['show','cbac9925ed66660e85c8a1a898095bb824bac0d6:intelligence-engine-v1.js'],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6})).replace('    window.thurayaRunIntelligenceEngine = run;', '    window.__dailyTest = { aggregateDay, render, STATE };\n    window.thurayaRunIntelligenceEngine = run;'),
        iife(source, '// THURAYA PHASE 6 — PREDICTIVE INTELLIGENCE').replace('    // Public controls', '    window.__legacyPredictive = p6_renderPredictivePanel;\n    // Public controls'),
        iife(source, '// THURAYA PHASE 6.2 — PERSISTENT PREDICTIVE OVERVIEW'),
        iife(source, '// THURAYA PHASE 6.3 — CLEAN MODE'),
        iife(source, '// THURAYA PHASE 6.4 — AI ACTION LAYER')
    ];
}
async function setup(page, source = current) {
    await page.route('**/*', route => route.abort());
    await page.clock.install({time:new Date('2025-06-18T12:00:00Z')});
    await page.setContent('<!doctype html><style>body{font-family:Arial;margin:12px}.intel54c-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.intel54c-kpi span,.intel54c-kpi strong{display:block}.module-box{margin:12px 0}td,th{text-align:left;padding:8px}</style><main id="intelligenceView" style="display:block"><div id="intelligencePanel"></div></main>');
    await page.evaluate(codes => {
        window.setTimeout = () => 0;
        window.__writes = 0;
        const now = new Date();
        const day = offset => { const date = new Date(now); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
        window.getLocalDateString=()=>day(0);
        const line = { menuItemId: 'canonical-test', name: 'Synthetic service', qty: 1, durationAtBooking: 30, lineTotal: 120, lineSubtotal: 100, taxAmount: 20, priceMode: 'inclusive' };
        window.__jobs = [0, -1, -7].map((offset, index) => ({ id: 'job-' + index, _collection: 'Active_Jobs', sourceAppointmentId: 'booking-' + index, status: 'Closed', dateString: day(offset), finalTotal: 120, taxTotal: 20, serviceLineItems: [line], assignedTechName: 'Synthetic Tech' }));
        window.__apps = [{ id: 'booking-0', _collection: 'Appointments', status: 'Scheduled', dateString: day(0), finalTotal: 120 }];
        const snapshot = rows => ({ size: rows.length, forEach(fn) { rows.forEach(row => fn({ id: row.id, data: () => row })); } });
        window.db = { collection(name) {
            const rows = name === 'Active_Jobs' ? window.__jobs : name === 'Appointments' ? window.__apps : [];
            return { get: async () => snapshot(rows), where: (field, op, value) => ({ get: async () => snapshot(rows.filter(row => row[field] === value)) }) };
        } };
        window.ThurayaCommissionV2 = { call: async () => ({ settings: [] }), refresh: async () => ({ persons: [{}] }) };
        codes.forEach(code => (0, eval)(code));
        window.ThurayaIntelligenceCanonical.readCollection = async name => name === 'Active_Jobs' ? window.__jobs : [];
        window.__dailyTest.aggregateDay([...window.__jobs.filter(row => row.dateString === day(0)), ...window.__apps], true);
        window.__dailyTest.render();
    }, scripts(source));
}
async function metrics(page) {
    return page.evaluate(() => {
        const labels = ['Revenue Today', 'Bookings Today', 'Last 7 Days Revenue', 'Avg Daily Revenue'];
        const mapped=window.ThurayaIntelligencePeriod?['Revenue - This Month','Bookings - This Month','Period Revenue','Avg Daily Revenue']:labels;
        return Object.fromEntries(labels.map((label,i) => {
            const nodes = [...document.querySelectorAll('span,div')].filter(node => node.children.length === 0 && node.textContent.trim() === mapped[i]);
            return [label, { count: nodes.length, values: nodes.map(node => node.nextElementSibling?.textContent.trim()) }];
        }));
    });
}
test('parent reproduces exact cleanup then delayed renderer replacement of daily cards', async () => {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        await setup(page, parent);
        assert.equal((await metrics(page))['Revenue Today'].count, 1);
        await page.evaluate(async () => {
            const legacy = document.createElement('div'); legacy.id = 'aiPredictiveContainer'; document.getElementById('intelligencePanel').appendChild(legacy);
            window.thurayaPhase63CleanMode();
            if (document.getElementById('aiPredictiveContainer')) throw Error('cleanup did not remove legacy target');
            await window.__legacyPredictive('aiPredictiveContainer');
        });
        assert.equal((await metrics(page))['Revenue Today'].count, 0);
        assert.equal((await metrics(page))['Bookings Today'].count, 0);
        assert.match(await page.locator('#intelligencePanel').innerText(), /Phase 6 Predictive Intelligence/);
    } finally { await browser.close(); }
});
test('daily cards survive predictive cleanup and asynchronous render in either completion order', async () => {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        for (const width of [1280, 768, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 } });
            await setup(page);
            for (const lateDaily of [false, true]) {
                await page.evaluate(async late => {
                    window.thurayaPhase63CleanMode();
                    if (!late) await window.thurayaRunIntelligenceEngine();
                    await window.__legacyPredictive('aiPredictiveContainer');
                    await window.thurayaPhase62Render();
                    await window.thurayaPhase64Render();
                    window.thurayaPhase63CleanMode();
                    if (late) await window.thurayaRunIntelligenceEngine();
                }, lateDaily);
                const values = await metrics(page);
                for (const result of Object.values(values)) assert.equal(result.count, 1, JSON.stringify(values));
                assert.deepEqual(values['Revenue Today'].values, ['360.00 GHC']);
                assert.deepEqual(values['Bookings Today'].values, ['3']);
                assert.deepEqual(values['Last 7 Days Revenue'].values, ['360.00 GHC']);
                assert.deepEqual(values['Avg Daily Revenue'].values, ['20.00 GHC']);
                assert.equal(await page.locator('#phase62PredictiveOverview').isVisible(), true);
                assert.match(await page.locator('#intelligenceView').innerText(), /AI Action Layer/);
                assert.equal(await page.locator('#phase62PredictiveOverview tr[data-service-id="canonical-test"]').count(), 1);
                assert.match(await page.locator('#phase62PredictiveOverview').innerText(), /Canonical Coverage\s+100.00%/);
            }
            await page.screenshot({ path: path.join(os.tmpdir(), `thuraya-intelligence-ranking-${width}.png`), fullPage: true });
            await page.close();
        }
    } finally { await browser.close(); }
});
test('refresh rerenders fresh values without duplicate KPI cards or losing predictive panels', async () => {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        const page = await browser.newPage(); await setup(page);
        for (let i = 1; i <= 3; i++) {
            await page.evaluate(async count => {
                window.__jobs[0].finalTotal = count * 120;
                window.__jobs[0].serviceLineItems = Array.from({ length: count }, () => ({ menuItemId: 'canonical-test', name: 'Synthetic service', qty: 1, lineTotal: 120, lineSubtotal: 100, taxAmount: 20, priceMode: 'inclusive' }));
                await window.thurayaRunIntelligenceEngine();
                await window.thurayaPhase62Render();
                window.thurayaPhase63CleanMode();
            }, i);
            const values = await metrics(page);
            for (const result of Object.values(values)) assert.equal(result.count, 1);
            assert.equal(values['Revenue Today'].values[0], (120 * (i + 2)).toFixed(2) + ' GHC');
            assert.equal(values['Last 7 Days Revenue'].values[0], (120 * (i + 2)).toFixed(2) + ' GHC');
        }
    } finally { await browser.close(); }
});
