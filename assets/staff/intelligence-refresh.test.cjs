'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const { chromium } = require('playwright');
const PARENT = 'e3bb221bd5e6aa762b4209f53687bb28eff8fbb5';
const read = file => fs.readFileSync(__dirname + '/' + file, 'utf8').replace(/\r\n/g, '\n');
const atParent = file => cp.execFileSync('git', ['show', `${PARENT}:${file}`], { cwd: __dirname, encoding: 'utf8', maxBuffer: 20e6 }).replace(/\r\n/g, '\n');
const app = read('app.js'), engine = read('intelligence-engine-v1.js'), html = read('index.html');
const oldApp = atParent('app.js'), oldEngine = atParent('intelligence-engine-v1.js');
const markers = [
    '// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS',
    '// THURAYA PHASE 5.4C PATCH',
    '// THURAYA PHASE 5.4C REAL DATA INTELLIGENCE ENGINE',
    '// THURAYA PHASE 6 — PREDICTIVE INTELLIGENCE',
    '// THURAYA PHASE 6.1 — OVERVIEW EMBED + REFRESH BUTTON FIX',
    '// THURAYA PHASE 6.2 — PERSISTENT PREDICTIVE OVERVIEW',
    '// THURAYA PHASE 6.3 — CLEAN MODE',
    '// THURAYA PHASE 6.4 — AI ACTION LAYER'
];
function block(source, marker) {
    const at = source.indexOf(marker), start = source.indexOf('(function () {', at), end = source.indexOf('\n})();', start);
    assert.ok(at >= 0 && start > at && end > start, marker);
    return source.slice(start, end + 7);
}
function scripts(source, daily) {
    const codes = markers.map(marker => block(source, marker));
    const start = source.indexOf('window.thurayaPhase6LoadPredictive = async function () {', source.indexOf('THURAYA PHASE 6.3B'));
    const end = source.indexOf('// ============================================================================', start);
    assert.ok(start > 0 && end > start);
    codes.splice(7, 0, source.slice(start, end));
    if(source.includes('// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD')) codes.splice(1,0,block(source,'// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD'));
    codes.push(daily);
    return codes;
}

// Only the transport is synthetic. DOM, initialization, timers, observers,
// legacy rebinding and the real browser click all execute application code.
function mockTransport() {
    window.__reads = [];
    window.__writes = 0;
    window.__errors = [];
    window.addEventListener('error', event => window.__errors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.__errors.push(String(event.reason)));
    const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
    window.__today = day(0);
    window.getLocalDateString=()=>day(0);
    const line = { menuItemId: 'synthetic-canonical', name: 'Synthetic service', qty: 1, durationAtBooking: 30, lineTotal: 120, lineSubtotal: 100, taxAmount: 20, priceMode: 'inclusive' };
    window.__jobs = [0, -1, -7].map((offset, index) => ({ id: 'job-' + index, sourceAppointmentId: 'booking-' + index, status: 'Closed', dateString: day(offset), finalTotal: 120, taxTotal: 20, serviceLineItems: [{ ...line }], assignedTechName: 'Synthetic Tech' }));
    window.__apps = [{ id: 'booking-0', status: 'Scheduled', dateString: day(0), finalTotal: 120 }];
    const snap = rows => ({ size: rows.length, empty: !rows.length, docs: rows.map(row => ({ id: row.id, data: () => ({ ...row }) })), forEach(fn) { this.docs.forEach(fn); } });
    const mutation = () => { window.__writes++; throw Error('Test forbids all writes'); };
    const ref = (name, filters = [], ordered = false) => ({
        where: (field, op, value) => ref(name, [...filters, { field, op, value }], ordered),
        orderBy: () => ref(name, filters, true), limit: () => ref(name, filters, ordered),
        doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: mutation, update: mutation, delete: mutation }),
        set: mutation, update: mutation, add: mutation, delete: mutation,
        async get() {
            const daily = new Error().stack.includes('getDocsForDate') || (!!window.ThurayaIntelligencePeriod && name==='Active_Jobs' && !filters.length);
            const history = name === 'Active_Jobs' && !filters.length;
            window.__reads.push({ name, filters, ordered, daily, history });
            if (window.__hold && (daily || history || name === 'Appointments')) await window.__hold;
            if (history && window.__historyDelay) await new Promise(resolve => setTimeout(resolve, window.__historyDelay));
            if ((window.__fail === 'daily' && (window.ThurayaIntelligencePeriod ? name==='Appointments' : daily)) || (window.__fail === 'history' && history) ||
                (window.__fail === 'ai' && history && new Error().stack.includes('p64_get'))) throw Error('Synthetic read failure');
            const rows = name === 'Active_Jobs' ? window.__jobs : name === 'Appointments' ? window.__apps : [];
            return snap(rows.filter(row => filters.every(f => f.op === '==' ? row[f.field] === f.value : true)));
        }
    });
    window.db = { collection: name => ref(name), runTransaction: mutation, batch: mutation };
    window.ThurayaCommissionV2 = { call: async () => ({ settings: [] }), refresh: async () => ({ persons: [{}] }) };
    window.switchModule = id => { document.getElementById('intelligenceView').style.display = id === 'intelligenceView' ? 'block' : 'none'; };
    document.getElementById('intelligenceView').style.display = 'block';
}
async function setup(browser, parent = false, width = 1280) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.route('**/*', route => route.abort());
    await page.clock.install({ time: new Date('2025-06-18T12:00:00Z') });
    await page.clock.pauseAt(new Date('2025-06-18T12:00:01Z'));
    const start = html.indexOf('<div id="intelligenceView"'), end = html.indexOf('<div id="clientsView"', start);
    assert.ok(start > 0 && end > start);
    assert.ok(html.indexOf('src="app.js') < html.indexOf('src="intelligence-engine-v1.js'));
    const codes = [`(${mockTransport.toString()})();`, ...scripts(parent ? oldApp : app, parent ? oldEngine : engine)];
    await page.setContent('<!doctype html><style>body{font-family:Arial} .intel54c-kpi span,.intel54c-kpi strong{display:block}</style><input id="nav_intelligence" type="radio" checked>' + html.slice(start, end) + codes.map(code => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`).join(''));
    await page.clock.runFor(7000);
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
    if(!parent) await page.evaluate(()=>{const original=window.thurayaPhase64Render;window.thurayaPhase64Render=function(options){if(window.__fail==='ai')throw Error('Synthetic read failure');return original(options);};});
    assert.match(await page.locator('#intelligencePanel').innerText(), parent ? /Revenue Today/i : /Revenue - This Month/i);
    await assertPanels(page);
    return page;
}
async function assertPanels(page) {
    const labels=await page.evaluate(()=>window.ThurayaIntelligencePeriod?['Revenue - This Month','Bookings - This Month','Period Revenue','Avg Daily Revenue']:['Revenue Today','Bookings Today','Last 7 Days Revenue','Avg Daily Revenue']);
    for (const label of labels) {
        const element = page.getByText(label, { exact: true });
        assert.equal(await element.count(), 1, label);
        assert.equal(await element.isVisible(), true, label);
    }
    for (const id of ['phase62PredictiveOverview', 'phase64AiActionLayer']) {
        assert.equal(await page.locator('#' + id).count(), 1);
        assert.equal(await page.locator('#' + id).isVisible(), true);
    }
    assert.equal(await page.getByRole('button', { name: /Refresh/ }).count(), 1);
}
const button = page => page.locator('#intelligencePanel button').filter({ hasText: /Refresh/ });
const timestamp = page => page.locator('#intelligenceFreshness').getAttribute('datetime');
async function reads(page) {
    return page.evaluate(() => ({
        dailyRuns: window.__reads.filter(r => r.daily && r.name === 'Active_Jobs' && (window.ThurayaIntelligencePeriod || r.filters.some(f => f.field === 'dateString' && f.value === window.__today))).length,
        history: window.__reads.filter(r => r.history).length,
        writes: window.__writes,
        stamps: window.__stamps?.size
    }));
}
async function hold(page, fail = null) {
    await page.evaluate(failure => {
        window.__reads = [];
        window.__fail = failure;
        window.__hold = new Promise(resolve => { window.__release = resolve; });
        window.__stamps = new Set();
        window.__stampObserver?.disconnect();
        window.__stampObserver = new MutationObserver(() => {
            const value = document.getElementById('intelligenceFreshness')?.dateTime;
            if (value && value !== window.__oldStamp) window.__stamps.add(value);
        });
        window.__oldStamp = document.getElementById('intelligenceFreshness')?.dateTime;
        window.__stampObserver.observe(document.getElementById('intelligencePanel'), { childList: true, subtree: true });
    }, fail);
}
async function release(page) {
    await page.evaluate(() => { window.__hold = null; window.__release(); });
    await page.clock.runFor(1200);
}
async function withBrowser(fn) {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try { await fn(browser); } finally { await browser.close(); }
}

test('parent actual initialization reproduces legacy onclick override, stale timestamp and stuck label', () => withBrowser(async browser => {
    const page = await setup(browser, true);
    await page.evaluate(() => { window.switchModule('otherView'); window.switchModule('intelligenceView'); });
    await page.clock.runFor(4000);
    assert.equal(await page.locator('#intel54cRevenueToday').count(), 0);
    assert.equal(await button(page).evaluate(el => el._p61Bound && el._p62CaptureBound), true);
    assert.match(await button(page).evaluate(el => el.onclick.toString()), /thurayaLoadIntelligenceRealData54C/);
    const old = (await page.locator('#intelligencePanel').innerText()).match(/Last updated: (.+)/)[1];
    await page.evaluate(() => { window.__reads = []; window.__historyDelay = 1500; });
    await button(page).click({ force: true });
    await page.clock.runFor(6000);
    assert.equal((await reads(page)).dailyRuns, 0);
    assert.equal((await page.locator('#intelligencePanel').innerText()).match(/Last updated: (.+)/)[1], old);
    assert.equal(await button(page).innerText(), 'Refreshing…');
    await assertPanels(page);
}));

test('actual button performs one fresh canonical cycle, advances freshness after reads, restores state and panels', () => withBrowser(async browser => {
    for (const width of [1280, 768, 390]) {
        const page = await setup(browser, false, width);
        const old = await timestamp(page);
        await hold(page);
        await page.evaluate(() => {
            window.__jobs[0].finalTotal = 240;
            window.__jobs[0].serviceLineItems[0] = { ...window.__jobs[0].serviceLineItems[0], lineTotal: 240, lineSubtotal: 200, taxAmount: 40 };
        });
        await button(page).click({ force: true });
        assert.equal(await button(page).innerText(), 'Refreshing…');
        assert.equal(await button(page).isDisabled(), true);
        assert.equal(await timestamp(page), old);
        await assertPanels(page);
        await release(page);
        assert.ok(Date.parse(await timestamp(page)) > Date.parse(old));
        assert.equal(await button(page).innerText(), 'Refresh Intelligence');
        assert.equal(await button(page).isDisabled(), false);
        assert.equal(await button(page).getAttribute('onclick'), null);
        assert.match(await page.locator('#intelligencePanel').innerText(), /480\.00 GHC/);
        assert.match(await page.locator('#phase62PredictiveOverview').innerText(), /480\.00 GHC/);
        assert.deepEqual(await reads(page), { dailyRuns: 1, history: 1, writes: 0, stamps: 1 });
        await assertPanels(page);
        await page.close();
    }
}));

test('re-entry, repeated initialization and delayed predictive initialization preserve sole click owner', () => withBrowser(async browser => {
    const page = await setup(browser);
    for (const mode of ['reentry', 'rebind', 'predictive', 'engine-reinit']) {
        if (mode === 'engine-reinit') await page.addScriptTag({ content: engine });
        else await page.evaluate(async value => {
            if (value === 'reentry') { window.switchModule('otherView'); window.switchModule('intelligenceView'); }
            if (value === 'rebind') for (let i = 0; i < 4; i++) { window.thurayaPhase61BindRefresh(); window.thurayaPhase62BindRefresh(); }
            if (value === 'predictive') { await window.thurayaPhase61RenderOverview(); await window.thurayaPhase62Render(); await window.thurayaPhase64Render(); }
        }, mode);
        await page.clock.runFor(7000);
        const old = await timestamp(page);
        await hold(page);
        await button(page).click({ force: true });
        // Rebinding while busy and a second dispatched event must join, not stack.
        await page.evaluate(() => { window.thurayaPhase61BindRefresh(); window.thurayaPhase62BindRefresh(); document.querySelector('[data-intelligence-refresh]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        assert.equal(await button(page).isDisabled(), true);
        await release(page);
        assert.ok(Date.parse(await timestamp(page)) > Date.parse(old), mode);
        assert.deepEqual(await reads(page), { dailyRuns: 1, history: 1, writes: 0, stamps: 1 }, mode);
        assert.equal(await button(page).innerText(), 'Refresh Intelligence');
        await assertPanels(page);
    }
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
}));

test('slow predictive and AI reads keep the actual click busy until the complete current refresh finishes', () => withBrowser(async browser => {
    const page = await setup(browser);
    const old = await timestamp(page);
    await hold(page);
    await page.evaluate(() => { window.__historyDelay = 3000; });
    await button(page).click({ force: true });
    await page.evaluate(() => { window.__hold = null; window.__release(); });
    await page.clock.runFor(2000);
    assert.equal(await button(page).innerText(), 'Refreshing…');
    assert.equal(await timestamp(page), old);
    await assertPanels(page);
    await page.clock.runFor(2000);
    assert.equal(await button(page).innerText(), 'Refresh Intelligence');
    assert.ok(Date.parse(await timestamp(page)) > Date.parse(old));
    assert.deepEqual(await reads(page), { dailyRuns: 1, history: 1, writes: 0, stamps: 1 });
    await assertPanels(page);
}));

for (const failure of ['daily', 'history', 'ai']) test(`${failure} read failure restores retry, preserves DOM and cannot claim freshness`, () => withBrowser(async browser => {
    const page = await setup(browser);
    const old = await timestamp(page);
    const predictive = await page.locator('#phase62PredictiveOverview').innerHTML();
    const ai = await page.locator('#phase64AiActionLayer').innerHTML();
    await hold(page, failure);
    await button(page).click({ force: true });
    assert.equal(await button(page).innerText(), 'Refreshing…');
    await release(page);
    assert.equal(await timestamp(page), old);
    assert.equal(await button(page).innerText(), 'Refresh Intelligence');
    assert.equal(await button(page).isDisabled(), false);
    assert.match(await page.locator('#intelligenceRefreshError').innerText(), /Synthetic read failure.*retry/);
    assert.equal(await page.locator('#phase62PredictiveOverview').innerHTML(), predictive);
    assert.equal(await page.locator('#phase64AiActionLayer').innerHTML(), ai);
    assert.equal((await reads(page)).stamps, 0);
    await assertPanels(page);
    await hold(page);
    await button(page).click({ force: true });
    await release(page);
    assert.ok(Date.parse(await timestamp(page)) > Date.parse(old));
    assert.equal(await page.locator('#intelligenceRefreshError').count(), 0);
    assert.deepEqual(await reads(page), { dailyRuns: 1, history: 1, writes: 0, stamps: 1 });
    assert.deepEqual(await page.evaluate(() => window.__errors), []);
}));

test('canonical model and refresh binding remain unchanged; reviewed global-period scope is exact', () => {
    assert.equal(block(app, markers[0]), block(oldApp, markers[0]));
    const slice=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
    assert.equal(slice(engine,'    function bindRefresh()','    async function refreshCurrentPanels'),slice(cp.execFileSync('git',['show','098702a4b4c37d9aad25a7730781b16547904a18:intelligence-engine-v1.js'],{cwd:__dirname,encoding:'utf8'}).replace(/\r\n/g,'\n') , '    function bindRefresh()', '    async function refreshCurrentPanels'));
    require('./scheduling-source-parity.cjs').legacyParity('intelligence-global-source-parity.cjs').check();
});
