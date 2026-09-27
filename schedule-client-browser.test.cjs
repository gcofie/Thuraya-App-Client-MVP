'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { source, read } = require('./schedule-client-fixture.cjs');
for (const width of [390,662,768,1280]) {
    test('Client actual slot UI excludes Sunday Matilda; explicit and Any at ' + width, async () => {
        const browser = await chromium.launch({ channel: 'msedge', headless: true });
        try {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors = [], requests = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
            await page.setContent('<main><h1>Booking</h1><label for="bk_date">Date</label><input id="bk_date" value="2026-09-27"><label for="bk_techMode">Preference</label><select id="bk_techMode"><option value="specific">Specific technician</option><option value="any">Any Technician</option></select><label for="bk_techEmail">Technician</label><input id="bk_techEmail" value="matilda@example.test"><input id="bk_time"><div id="bk_slotsContainer"><div id="bk_slots"></div></div><button id="btnToConfirm">Continue</button></main>');
            await page.addStyleTag({ content: read('styles.css') });
            await page.addStyleTag({ content: read('brand.css') });
            await page.evaluate(() => {
                const main = document.querySelector('main'); main.id = 'app';
                const screen = document.createElement('section'); screen.className = 'screen active'; screen.id = 'screen-datetime';
                const inner = document.createElement('div'); inner.className = 'screen-inner';
                while (main.firstChild) inner.appendChild(main.firstChild);
                screen.appendChild(inner); main.appendChild(screen);
                document.getElementById('bk_slotsContainer').className = 'slots-container';
                document.getElementById('bk_slots').className = 'slots-grid';
            });
            await page.addScriptTag({ content: source });
            await page.evaluate(() => bk_generateSlots());
            assert.equal(await page.locator('#bk_slots .slot-btn').count(), 0);
            assert.match(await page.locator('#bk_slots').innerText(), /No available/);
            await page.locator('#bk_slots').scrollIntoViewIfNeeded();
            assert.equal(await page.locator('#bk_slots').isVisible(),true);
            if (process.env.SCHEDULE_SCREENSHOTS) await page.screenshot({ path: require('node:path').join(process.env.SCHEDULE_SCREENSHOTS,'client-sunday-'+width+'.png'),fullPage:true,animations:'disabled' });
            await page.selectOption('#bk_techMode', 'any'); await page.evaluate(() => bk_generateSlots());
            assert.ok(await page.locator('#bk_slots .slot-btn').count());
            for (const value of await page.locator('#bk_slots .slot-btn').evaluateAll(nodes => nodes.map(n => n.dataset.techs))) assert.deepEqual(JSON.parse(value), ['other@example.test']);
            await page.selectOption('#bk_techMode','specific'); await page.fill('#bk_date','2026-09-28'); await page.evaluate(() => bk_generateSlots());
            assert.ok(await page.locator('#bk_slots .slot-btn').count());
            assert.ok((await page.locator('#bk_slots .slot-btn').first().getAttribute('data-techs')).includes('matilda@example.test'));
            assert.deepEqual(errors, []); assert.deepEqual(requests, []);
            assert.equal(await page.evaluate(() => fixture.writes.length), 0);
        } finally { await browser.close(); }
    });
}
