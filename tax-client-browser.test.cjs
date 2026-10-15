'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { read, section, source, confirmSetup, confirm } = require('./schedule-client-fixture.cjs');
const app = read('app.js'), group = read('group-booking.js');
const browserSource = [source, '(' + confirmSetup.toString() + ')();', read('tax-policy.js'),
    'globalThis.bk_taxPolicy = null;',
    section(app, 'function applyTaxes(', "document.addEventListener('DOMContentLoaded'"),
    section(app, 'function th_refEscape(', 'function th_priceLabel('),
    section(app, 'function loadTaxConfig()', 'const CATEGORY_ALIASES'),
    section(app, 'function populateConfirmScreen()', '// ── Promo code'), confirm].join('\n');
const html = read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '')
    .replace('src="thuraya-monogram.jpg"', 'src="data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'thuraya-monogram.jpg')).toString('base64') + '"');
async function setup(page, mode) {
    await page.setContent(html); await page.addStyleTag({ content: read('styles.css') }); await page.addStyleTag({ content: read('brand.css') });
    await page.addScriptTag({ content: browserSource });
    await page.addScriptTag({ content: section(app, 'function populateSuccessScreen(', '// ── Add to Calendar') });
    await page.evaluate(mode => {
        bk_selectedServices = [{ id: 'cert-base', name: 'Synthetic base', price: 225, dur: 60, qty: 1 }];
        globalThis.bk_menuServices = bk_selectedServices.map(row => ({ ...row, duration: 60 }));
        const collection = db.collection;
        db.collection = name => name === 'Tax_Settings' ? { doc: () => ({ onSnapshot(next, error) {
            globalThis.taxNext = next; globalThis.taxError = error; return () => {};
        } }) } : collection(name);
        globalThis.bk_showSlotHoldNotice = () => {};
        document.querySelectorAll('.screen').forEach(node => node.classList.remove('active'));
        document.getElementById('screen-confirm').classList.add('active');
        const values = { bk_techEmail: fixture.email, bk_techName: 'Synthetic technician', bk_date: '2026-09-28', bk_time: '15:00' };
        Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = value; });
        loadTaxConfig();
        taxNext({ exists: true, data: () => ({ pricingMode: mode, rates: [{ name: 'VAT', rate: 15 }, { name: 'NHIL', rate: 2.5 }, { name: 'GETFund', rate: 2.5 }] }) });
        populateConfirmScreen();
    }, mode);
}
for (const width of [390, 1280]) for (const mode of ['inclusive', 'exclusive', 'unknown']) {
    test('offline real Client summary/commit UI ' + mode + ' at ' + width, async () => {
        const browser = await chromium.launch({ channel: 'msedge', headless: true });
        try {
            const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [], requests = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
            await setup(page, mode);
            const expected = mode === 'inclusive' ? '225.00 GHC' : mode === 'exclusive' ? '270.00 GHC' : 'Unavailable';
            assert.equal(await page.locator('#conf_total').innerText(), expected);
            assert.equal(await page.locator('#btnConfirmBooking').isDisabled(), mode === 'unknown');
            if (mode !== 'unknown') {
                await page.locator('#btnConfirmBooking').click();
                await page.waitForFunction(() => fixture.commits === 1);
                const record = await page.evaluate(() => fixture.writes[0].data);
                assert.equal(record.amountDue, mode === 'inclusive' ? 225 : 270);
                assert.equal(await page.locator('#suc_total').textContent(), expected);
            } else assert.equal(await page.evaluate(() => fixture.commits), 0);
            const bounds = await page.locator('#conf_total').boundingBox();
            assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
            if (process.env.TAX_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.TAX_SCREENSHOTS, 'client-tax-' + mode + '-' + width + '.png'), fullPage: true });
            assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        } finally { await browser.close(); }
    });
}
for (const width of [390, 1280]) {
    test('offline real group summary and cent-allocation UI at ' + width, async () => {
        const browser = await chromium.launch({ channel: 'msedge', headless: true });
        try {
            const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = [], requests = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
            await setup(page, 'inclusive');
            await page.addScriptTag({ content: section(group, 'function grp_memberLabel(', 'async function grp_ensureTechs(') + '\n' +
                section(group, 'function grp_billingOptionsHtml()', 'async function grp_preAssignSameTimeIfNeeded(') + '\n' +
                section(group, 'function grp_computeBillingForMember(', 'window.grp_bookAgain') });
            await page.evaluate(() => {
                globalThis.grp_members = [
                    { name: 'Synthetic lead', assignedTechEmail: fixture.email, selectedServices: [{ id: 'a', name: 'Synthetic base', price: 225.01, dur: 60 }] },
                    { name: 'Synthetic member', assignedTechEmail: fixture.other, selectedServices: [{ id: 'b', name: 'Synthetic base', price: 225, dur: 60 }] }
                ];
                globalThis.grp_selectedPlan = { type: 'same', dateStr: '2026-09-28', timeStr: '15:00' };
                globalThis.bk_menuServices = [];
                globalThis.grp_formatDate = value => value; globalThis.grp_formatTime = value => value;
                globalThis.grp_preAssignSameTimeIfNeeded = async () => {};
                globalThis.grp_baseGoToStep = () => {};
                document.getElementById('grp_date').value = '2026-09-28'; document.getElementById('grp_time').value = '15:00';
                document.querySelectorAll('.screen').forEach(node => node.classList.remove('active'));
                document.getElementById('screen-group-confirm').classList.add('active');
                grp_populateConfirm();
            });
            const share = page.locator('input[value="split_equally"]');
            await page.locator('label').filter({ has: share }).click();
            assert.equal(await share.isChecked(), true);
            assert.match(await page.locator('#grp_billingPanel').innerText(), /225.01 GHC/);
            assert.match(await page.locator('#grp_billingPanel').innerText(), /225.00 GHC/);
            assert.equal(await page.locator('.group-share-amount').count(), 2);
            assert.equal(await page.locator('.group-share-amount').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth)), true);
            await page.locator('#grp_btnConfirm').click(); await page.waitForFunction(() => fixture.commits === 1);
            const records = await page.evaluate(() => fixture.writes.map(row => row.data));
            assert.deepEqual(records.map(row => row.amountDue), [225.01, 225]);
            assert.deepEqual(records.map(row => row.grandTotal), [225.01, 225]);
            assert.match(await page.locator('#grp_suc_members').textContent(), /Synthetic base/);
            if (process.env.TAX_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.TAX_SCREENSHOTS, 'client-tax-group-' + width + '.png'), fullPage: true });
            await page.evaluate(() => { taxError(Error('unavailable')); grp_populateSuccess(); });
            assert.match(await page.locator('#grp_suc_members').textContent(), /Synthetic base/);
            assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        } finally { await browser.close(); }
    });
}
