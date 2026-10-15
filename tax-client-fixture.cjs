'use strict';
const vm = require('node:vm');
const schedule = require('./schedule-client-fixture.cjs');
const { read, section } = schedule;
const rates = [{ name: 'VAT', rate: 15 }, { name: 'NHIL', rate: 2.5 }, { name: 'GETFund', rate: 2.5 }];
const policy = { pricingMode: 'inclusive', taxPricingMode: 'inclusive', rates };
function taxHarness(config = policy, group = false) {
    const h = group ? schedule.withGroup(schedule.harness(), '2026-09-28') : schedule.withConfirmation(schedule.harness());
    h.bk_selectedServices = [{ id: 'cert-base', name: 'Synthetic base', price: 225, dur: 60, qty: 1 }];
    h.bk_menuServices = h.bk_selectedServices.map(row => ({ ...row, duration: row.dur, version: 'menu-v1' }));
    h.bk_taxPolicy = config ? h.ThurayaClientTax.read(config) : null;
    if (group) {
        h.grp_members.forEach(m => { m.selectedServices = h.bk_selectedServices.map(row => ({ ...row })); });
        h.grp_memberLabel = index => h.grp_members[index].name;
    }
    for (const id of ['conf_services', 'conf_tech', 'conf_date', 'conf_time', 'conf_duration', 'conf_priceBreakdown', 'conf_total',
        'suc_services', 'suc_tech', 'suc_datetime', 'suc_total', 'grp_conf_date', 'grp_conf_time', 'grp_conf_size', 'grp_conf_members']) {
        h.elements[id] = { textContent: '', innerHTML: '', insertAdjacentHTML() {} };
    }
    h.bk_showSlotHoldNotice = () => {};
    vm.runInContext(section(read('app.js'), 'function th_refEscape(', 'function th_priceLabel('), h);
    vm.runInContext(section(read('app.js'), 'function populateConfirmScreen()', '// ── Promo code'), h);
    vm.runInContext(section(read('app.js'), 'function populateSuccessScreen(', '// ── Add to Calendar'), h);
    const collection = h.db.collection;
    h.db.collection = name => name === 'Tax_Settings' ? { doc(id) {
        if (id !== 'current_taxes') throw Error('Unexpected tax document');
        return { onSnapshot(next, error) { h.taxNext = next; h.taxError = error; return () => {}; } };
    } } : collection(name);
    vm.runInContext(section(read('app.js'), 'function loadTaxConfig()', 'const CATEGORY_ALIASES'), h);
    h.loadTaxConfig();
    return h;
}
module.exports = { taxHarness, policy, rates, read, section };
