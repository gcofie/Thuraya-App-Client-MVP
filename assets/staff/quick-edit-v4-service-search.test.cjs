'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const start = source.indexOf('   Expected Today Quick Edit V4');
const end = source.indexOf('/* === END THURAYA STAFF — GO-LIVE HOTFIX 10 === */', start);
assert.ok(start >= 0 && end > start);
const v4 = source.slice(start, end);

function section(from, to) {
    const a = v4.indexOf(from);
    const b = v4.indexOf(to, a + from.length);
    assert.ok(a >= 0 && b > a, `Missing Quick Edit V4 section: ${from}`);
    return v4.slice(a, b);
}

function harness(rows) {
    const elements = {
        thQeV4ServiceSearch: { value: '' },
        thQeV4Service: { value: '' },
        thQeV4ServiceResults: { innerHTML: '' },
        thQeV4ServiceCount: { textContent: '' },
        thQeV4Qty: { value: '1' }
    };
    const calls = { collections: [], totals: 0, items: 0, slots: 0 };
    const context = {
        elements, calls,
        db: { collection(name) {
            calls.collections.push(name);
            return { get: async () => ({ forEach(fn) {
                rows.forEach(row => fn({ id: row.id, data: () => row }));
            } }) };
        } },
        window: {}, console, Date, Math
    };
    const script = `
        const MENU_COLLECTION = 'Menu_Settings_V2';
        let serviceCache = [];
        let selectedItems = [];
        function q(id) { return elements[id]; }
        function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function num(v, fallback=0) { const n = Number(String(v ?? '').replace(/,/g,'')); return Number.isFinite(n) ? n : fallback; }
        function statusActive(s) { return String(s || 'active').trim().toLowerCase() !== 'inactive'; }
        function setMsg() {}
        function syncTotalsFromItems() { calls.totals++; }
        function renderItems() { calls.items++; }
        function clearSelectedTime() {}
        function renderSlots() { calls.slots++; }
        ${section('    function svcName(s)', '    function serviceNameKey(value)')}
        ${section('    function svcSort(a,b)', '    function techList()')}
        ${section('    async function loadV2Services()', '    function ensureModal()')}
        ${section('    async function populateServices()', '    function buildInitialItems(appt)')}
        ${section('    function addSelectedService()', '    window.thQeV4RemoveItem')}
        globalThis.api = { populateServices, renderServiceOptions, serviceSearchRank, addSelectedService,
            getItems: () => selectedItems, getServices: () => serviceCache };
    `;
    vm.runInNewContext(script, context);
    return { elements, calls, api: context.api };
}

const rows = [
    { id: 'gel-feet', serviceName: 'Gel Polish Only Service (+Tidying)', department: 'Feet', category: 'Polish', subCategory: 'Nails', duration: 45, price: 195, status: 'active' },
    { id: 'biab-hands', serviceName: 'BIAB Extensions Removal & Nail Tidying', department: 'Hand', category: 'Removal', duration: 60, price: 250, status: 'active' },
    { id: 'massage', serviceName: 'Massage', department: 'Body', category: 'Relaxation', duration: 30, price: 100, status: 'active' },
    { id: 'inactive', serviceName: 'Inactive Gel Polish', duration: 30, price: 195, status: 'inactive' }
];

function resultIds(html) {
    return [...html.matchAll(/data-service-id="([^"]+)"/g)].map(match => match[1]);
}

test('Menu_Settings_V2 is the only service source; search filters metadata and ranks names', async () => {
    const { api, elements, calls } = harness(rows);
    await api.populateServices();
    assert.deepEqual(calls.collections, ['Menu_Settings_V2']);
    assert.deepEqual(resultIds(elements.thQeV4ServiceResults.innerHTML), ['biab-hands', 'gel-feet', 'massage']);
    for (const [query, expected] of [
        ['GeL PoLiSh', ['gel-feet']], ['BIAB', ['biab-hands']], ['removal', ['biab-hands']],
        ['feet', ['gel-feet']], ['tidying', ['biab-hands', 'gel-feet']],
        ['nails', ['gel-feet']], ['45', ['gel-feet']], ['195', ['gel-feet']]
    ]) {
        elements.thQeV4ServiceSearch.value = query;
        api.renderServiceOptions();
        assert.deepEqual(resultIds(elements.thQeV4ServiceResults.innerHTML), expected, query);
    }
    elements.thQeV4ServiceSearch.value = 'not-a-service';
    api.renderServiceOptions();
    assert.match(elements.thQeV4ServiceResults.innerHTML, /No matching service\/add-on/);
    elements.thQeV4ServiceSearch.value = '';
    api.renderServiceOptions();
    assert.deepEqual(resultIds(elements.thQeV4ServiceResults.innerHTML), ['biab-hands', 'gel-feet', 'massage']);
});

test('filtered choice keeps canonical ID and existing Add path owns qty, price and duration', async () => {
    const { api, elements, calls } = harness(rows);
    await api.populateServices();
    elements.thQeV4ServiceSearch.value = 'gel polish';
    api.renderServiceOptions();
    api.renderServiceOptions();
    assert.deepEqual(resultIds(elements.thQeV4ServiceResults.innerHTML), ['gel-feet']);
    assert.equal(api.getItems().length, 0, 'search does not add a service');
    elements.thQeV4Service.value = 'gel-feet';
    elements.thQeV4Qty.value = '3';
    api.addSelectedService();
    const [item] = api.getItems();
    assert.equal(api.getItems().length, 1);
    assert.equal(item.id, 'gel-feet');
    assert.equal(item.qty, 3);
    assert.equal(item.price, 195);
    assert.equal(item.duration, 45);
    assert.equal(item.name, rows[0].serviceName);
    assert.equal(elements.thQeV4Qty.value, '1');
    assert.equal(elements.thQeV4Service.value, '');
    assert.equal(elements.thQeV4ServiceSearch.value, '');
    assert.equal(calls.totals, 1);
    assert.equal(calls.items, 1);
    assert.equal(calls.slots, 1);
    api.addSelectedService();
    assert.equal(api.getItems().length, 1, 'empty selection cannot duplicate an item');
});

test('selector stays wired to existing add handler and keyboard/mouse result list', () => {
    assert.match(v4, /<input id="thQeV4ServiceSearch" type="search"/);
    assert.match(v4, /<input id="thQeV4Service" type="hidden"/);
    assert.match(v4, /<div id="thQeV4ServiceResults" role="listbox"/);
    assert.match(v4, /q\('thQeV4Add'\)\.addEventListener\('click', addSelectedService\)/);
    assert.match(v4, /e\.key !== 'ArrowDown' && e\.key !== 'Enter'/);
    assert.match(v4, /const id = q\('thQeV4Service'\)\?\.value \|\| ''/);
    assert.match(v4, /const s = serviceCache\.find\(x => String\(x\.id\) === String\(id\)\)/);
    assert.match(v4, /buildQuickEditV4CanonicalFinancials/);
});
