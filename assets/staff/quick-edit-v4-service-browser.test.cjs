'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const begin = source.indexOf('   Expected Today Quick Edit V4');
const finish = source.indexOf('/* === END THURAYA STAFF — GO-LIVE HOTFIX 10 === */', begin);
assert.ok(begin >= 0 && finish > begin);
const block = source.slice(begin, finish);
const iife = block.slice(block.indexOf('(function(){'), block.lastIndexOf('})();') + 5)
    .replace('window.thOpenExpectedTodayQuickEditV4 = openQuickEditV4;',
        'window.thOpenExpectedTodayQuickEditV4 = openQuickEditV4; window.__testQuickEditV4 = { ensureModal, populateServices };');

const services = [
    { id: 'gel-feet', serviceName: 'Gel Polish Only Service (+Tidying)', department: 'Feet', category: 'Polish', duration: 45, price: 195 },
    { id: 'biab-hands', serviceName: 'BIAB Extensions Removal & Nail Tidying', department: 'Hand', category: 'Removal', duration: 60, price: 250 },
    { id: 'massage', serviceName: 'Massage', department: 'Body', category: 'Relaxation', duration: 30, price: 100 }
];

test('Quick Edit V4 searchable selector works by keyboard and mouse across layouts', async () => {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        for (const width of [1280, 768, 390]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            await page.setContent('<!doctype html><html><body style="margin:0;font-family:Arial,sans-serif"></body></html>');
            await page.evaluate(async ({ code, rows }) => {
                window.db = { collection(name) {
                    if (name !== 'Menu_Settings_V2') throw new Error('Unexpected collection ' + name);
                    return { get: async () => ({ forEach(fn) {
                        rows.forEach(row => fn({ id: row.id, data: () => row }));
                    } }) };
                } };
                (0, eval)(code);
                const modal = window.__testQuickEditV4.ensureModal();
                modal.style.display = 'flex';
                await window.__testQuickEditV4.populateServices();
            }, { code: iife, rows: services });

            const search = page.locator('#thQeV4ServiceSearch');
            const selector = page.locator('#thQeV4Service');
            const results = page.locator('#thQeV4ServiceResults');
            await search.fill('bIaB');
            assert.deepEqual(await results.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.serviceId)), ['biab-hands']);
            await search.press('ArrowDown');
            await page.keyboard.press('Enter');
            assert.equal(await selector.inputValue(), 'biab-hands');
            await page.locator('#thQeV4Qty').fill('2');
            await page.locator('#thQeV4Add').click();
            assert.match(await page.locator('#thQeV4Items').innerText(), /BIAB Extensions Removal/);
            assert.equal(await page.locator('#thQeV4Amount').inputValue(), '500.00');
            assert.equal(await page.locator('#thQeV4Duration').inputValue(), '120');

            await search.fill('feet');
            await results.locator('button[data-service-id="gel-feet"]').click();
            assert.equal(await selector.inputValue(), 'gel-feet');
            await search.fill('not-a-service');
            assert.equal(await selector.inputValue(), '');
            assert.match(await page.locator('#thQeV4ServiceCount').innerText(), /No matching service\/add-on/);
            await search.fill('');
            assert.equal(await results.locator('button').count(), services.length);

            for (const locator of [search, results, page.locator('#thQeV4Add')]) {
                const box = await locator.boundingBox();
                assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `Control exceeds ${width}px viewport`);
            }
            await page.screenshot({ path: path.join(os.tmpdir(), `thuraya-rc2-service-selector-${width}.png`) });
            await page.close();
        }
    } finally {
        await browser.close();
    }
});
