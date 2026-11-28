'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { source, read, section } = require('./schedule-staff-fixture.cjs');
const quick = section(read('app.js'),'   Expected Today Quick Edit V4','/* === END THURAYA STAFF');
async function surface(width, fn) {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => route.abort());
        await page.setContent('<main><h1>Staff Booking</h1><div id="sched_serviceMenu"><label><input class="sched-service-item" type="checkbox" checked>Synthetic service</label></div><span id="sched_totalDuration">60</span><label for="sched_date">Date</label><input id="sched_date" value="2026-09-27"><div class="form-group"><label for="sched_techSelect">Technician</label><select id="sched_techSelect"><option value="matilda@example.test">Matilda.HT</option><option value="other@example.test">Other technician</option></select></div><input id="sched_time"><div id="sched_timeSlots"></div><div id="thQeV4Msg" role="status"></div></main>');
        await page.addStyleTag({ content: read('styles.css') });
        await page.addStyleTag({ content: read('brand.css') });
        await page.addScriptTag({ content: source });
        await fn(page);
        assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => fixture.writes.length), 0);
    } finally { await browser.close(); }
}
for (const width of [390,662,768,1280]) {
    test('Staff actual slot UI: Sunday OFF, Any excludes Matilda, weekday retained at ' + width, () => surface(width, async page => {
        await page.evaluate(() => generateTimeSlots());
        assert.equal(await page.locator('#sched_timeSlots .th-avail-slot').count(), 0);
        assert.match(await page.locator('#sched_timeSlots').innerText(), /No available slots/);
        if (process.env.SCHEDULE_SCREENSHOTS) await page.screenshot({ path: require('node:path').join(process.env.SCHEDULE_SCREENSHOTS,'staff-sunday-'+width+'.png'),fullPage:true });
        assert.match(await page.locator('[data-tech-email="matilda@example.test"]').innerText(), /Off schedule/i);
        await page.selectOption('#sched_techSelect','__ANY_AVAILABLE_TECH__'); await page.evaluate(() => generateTimeSlots());
        assert.ok(await page.locator('#sched_timeSlots .th-avail-slot').count());
        assert.equal(await page.locator('#sched_timeSlots [data-tech-email="matilda@example.test"]').count(), 0);
        await page.selectOption('#sched_techSelect','matilda@example.test'); await page.fill('#sched_date','2026-09-28'); await page.evaluate(() => generateTimeSlots());
        assert.ok(await page.locator('#sched_timeSlots [data-tech-email="matilda@example.test"]').count());
    }));
}
for (const [name, extra, identity, message] of [
    ['safe Individual booker', { paymentStatus: 'unpaid' }, 'INDIVIDUAL', 'INDIVIDUAL'],
    ['ambiguous Individual payment', { paymentStatus: 'pending_or_paid_by_booker' }, 'INDIVIDUAL', 'Payment status cannot be safely determined'],
    ['true group', { groupId: 'synthetic-group', paymentStatus: 'unpaid' }, 'GROUP_OR_ALLOCATED', 'group or allocated billing'],
    ['historical ambiguity', { groupRole: 'unknown' }, 'REVIEW_REQUIRED', 'historical billing evidence is incomplete']
]) {
    test('actual Quick Edit identity/guard message: ' + name, () => surface(662, async page => {
        await page.addScriptTag({ content: `
            const selectedItems = [];
            function q(id) { return document.getElementById(id); }
            ${section(quick,'    function quickEditV4BillingIdentity(','    function quickEditV4RecordState(')}
            ${section(quick,'    function setMsg(','    function ')}
            window.thNormalizeTaxPricingModeValue = value => value;
            window.thCanonicalTaxRatesFromBreakdown = rows => rows;
            window.inspectFixture = record => {
                const identity = quickEditV4BillingIdentity(record);
                try { quickEditV4FinancialContext(record); setMsg(identity, 'success'); }
                catch(e) { setMsg(e.reviewMessage || e.message, 'error'); }
                return identity;
            };
        ` });
        const actual = await page.evaluate(extra => inspectFixture({ status:'Scheduled', isGroupBooking:false, groupId:'', groupSize:1, groupMemberIndex:0, paymentResponsibility:'booker', taxPricingMode:'inclusive', taxBreakdown:[{name:'VAT',rate:20,amount:20}], ...extra }), extra);
        assert.equal(actual, identity);
        assert.ok((await page.locator('#thQeV4Msg').innerText()).includes(message));
        if (identity === 'INDIVIDUAL') assert.doesNotMatch(await page.locator('#thQeV4Msg').innerText(), /group or allocated/i);
    }));
}
