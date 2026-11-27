'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true }); });
after(async () => { await browser?.close(); });
const card = {
    code: 'THGC-AB23-CD45', amount: 250, remainingBalance: 250, status: 'Active',
    totalAllowedUses: 3, remainingUses: 3, usedCount: 0, expiryDate: '2099-12-31',
    issuedAt: '2026-09-09T12:00:00Z', recipientName: 'Long Recipient '.repeat(8).trim(),
    purchaserName: 'Long Sender '.repeat(8).trim(), message: 'A complete message that must remain readable. '.repeat(20).trim()
};
async function surface(width = 390, timezoneId = 'Africa/Accra') {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent('<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}p{color:#333}:root{--primary:#333;--border:#ddd}</style><nav id="topNavMenu"></nav><main id="appDashboard"></main><button id="opener">Preview</button>');
    await page.addScriptTag({ path: path.join(__dirname, 'gift-card-model.js') });
    await page.addScriptTag({ path: path.join(__dirname, 'sales-promo-v1.js') });
    await page.locator('#opener').focus();
    await page.evaluate(card => sales_openGiftCardPreview(card), card);
    return { context, page };
}
async function inspect(page) {
    return page.locator('.thuraya-gift-preview-final').evaluate(el => {
        const box = el.getBoundingClientRect();
        return {
            cardWidth: box.width, viewport: innerWidth, overflow: el.scrollWidth > el.clientWidth + 2,
            messageColor: getComputedStyle(el.querySelector('.th-gift-message')).color,
            purchasedColor: getComputedStyle(el.querySelector('.th-gift-purchased')).color,
            recipientColor: getComputedStyle(el.querySelector('.th-gift-recipient')).color,
            clipped: [...el.querySelectorAll('dd,p,.th-gift-code,.th-gift-amount')].some(e => e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2),
            hidden: [...el.querySelectorAll('*')].some(e => ['hidden','clip'].includes(getComputedStyle(e).overflowY)),
            text: el.textContent
        };
    });
}
for (const width of [390, 430, 768, 1440, 1920]) test(`preview ${width}px: all long fields wrap without clipping`, async () => {
    const { context, page } = await surface(width);
    try {
        const state = await inspect(page);
        assert.ok(state.cardWidth <= width); assert.equal(state.overflow, false); assert.equal(state.clipped, false); assert.equal(state.hidden, false);
        assert.equal(state.messageColor, 'rgb(255, 255, 255)');
        assert.equal(state.purchasedColor, 'rgb(255, 255, 255)');
        assert.equal(state.recipientColor, 'rgb(255, 255, 255)');
        for (const value of [card.code, card.recipientName, card.purchaserName, card.message, '250.00', '09 Sep 2026', '31 Dec 2099', 'Max 3 uses', 'Uses remaining', 'THURAYA']) assert.ok(state.text.includes(value), value);
        await page.locator('.th-gift-terms').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.th-gift-terms').isVisible(), true);
    } finally { await context.close(); }
});
test('long historical code remains fully accessible; orientation can change', async () => {
    const { context, page } = await surface();
    try {
        const code = 'THGC-' + 'LEGACYLONGCODE'.repeat(7);
        await page.evaluate(card => sales_openGiftCardPreview(card), { ...card, code });
        assert.equal((await inspect(page)).clipped, false);
        assert.ok((await inspect(page)).text.includes(code));
        await page.setViewportSize({ width: 844, height: 390 });
        assert.equal((await inspect(page)).overflow, false);
    } finally { await context.close(); }
});
test('dialog label, keyboard focus containment and restoration', async () => {
    const { context, page } = await surface();
    try {
        assert.equal(await page.getByRole('dialog', { name: 'Gift Card Preview' }).count(), 1);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Done');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'opener');
    } finally { await context.close(); }
});
test('export has an independent content-sized layout at mobile width', async () => {
    const { context, page } = await surface();
    try {
        await page.evaluate(() => {
            window.html2canvas = async (el, options) => {
                window.exportLayout = { width: el.clientWidth, height: el.clientHeight, scrollHeight: el.scrollHeight, text: el.textContent, options, messageColor: getComputedStyle(el.querySelector('.th-gift-message')).color };
                const canvas = document.createElement('canvas'); canvas.width = el.clientWidth; canvas.height = el.clientHeight; return canvas;
            };
        });
        await page.locator('[data-gift-image]').click();
        await page.waitForFunction(() => window.exportLayout);
        const layout = await page.evaluate(() => window.exportLayout);
        assert.ok(layout.width > 900); assert.ok(layout.scrollHeight <= layout.height + 2); assert.equal(layout.options.windowWidth, 1000);
        assert.equal(layout.messageColor, 'rgb(255, 255, 255)');
        for (const value of [card.message, card.purchaserName, card.recipientName, card.code, '31 Dec 2099']) assert.ok(layout.text.includes(value));
        await page.waitForFunction(() => !document.querySelector('.th-gift-export-host'));
    } finally { await context.close(); }
});
test('share text contains full parties, code, dates, message and uses', async () => {
    const { context, page } = await surface();
    try {
        await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => { window.shared = payload; } }));
        await page.locator('[data-gift-share]').click();
        await page.waitForFunction(() => window.shared);
        const payload = await page.evaluate(() => window.shared);
        for (const value of [card.code, card.purchaserName, card.recipientName, card.message, '09 Sep 2026', '31 Dec 2099', 'Allowed uses: 3']) assert.ok(payload.text.includes(value));
    } finally { await context.close(); }
});
for (const timezoneId of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) test(`fresh Accra midnight while browser is ${timezoneId}`, async () => {
    const { context, page } = await surface(390, timezoneId);
    try {
        await page.clock.install({ time: new Date('2026-09-09T23:59:59Z') });
        const data = { ...card, expiryDate: '2026-09-09' };
        assert.equal(await page.evaluate(c => ThurayaGiftCard.classify(c).state, data), 'VALID');
        await page.clock.fastForward(2000);
        assert.equal(await page.evaluate(c => ThurayaGiftCard.classify(c).state, data), 'EXPIRED');
        await page.evaluate(c => sales_openGiftCardPreview(c), data);
        assert.equal(await page.locator('.th-gift-state').innerText(), 'Expired');
    } finally { await context.close(); }
});

const referenceCard = { ...card, amount: 550, recipientName: 'Synthetic Recipient', purchaserName: '', message: 'Experience THURAYA' };
for (const width of [390, 430, 768, 1440, 1920]) test(`premium reference composition ${width}px retains all landmarks`, async () => {
    const { context, page } = await surface(width);
    try {
        await page.evaluate(c => sales_openGiftCardPreview(c), referenceCard);
        const result = await page.locator('.thuraya-gift-preview-final').evaluate(el => {
            const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
            const selectors = ['.th-gift-purchased','.th-gift-recipient','.th-gift-amount','.th-gift-brand-area','.th-gift-code','.th-gift-message','.th-gift-dates','.th-gift-signature','.th-gift-terms'];
            const boxes = Object.fromEntries(selectors.map(s => [s,rect(el.querySelector(s))]));
            const c = getComputedStyle(el), stage = getComputedStyle(el.firstElementChild);
            return { card:rect(el), boxes, black:c.backgroundColor, border:stage.borderTopColor, radius:c.borderTopLeftRadius, columns:stage.gridTemplateColumns, watermark:el.querySelector('.th-gift-watermark').textContent, hidden:el.querySelector('.th-gift-watermark').getAttribute('aria-hidden'), text:el.textContent };
        });
        assert.equal(result.black, 'rgb(3, 3, 3)'); assert.equal(result.border, 'rgb(118, 101, 66)'); assert.equal(result.radius, '32px');
        assert.equal(result.watermark, 'gift'); assert.equal(result.hidden, 'true'); assert.equal(result.columns.split(' ').length, 2);
        assert.ok(result.card.width > result.card.height, 'ordinary recipient card remains landscape');
        if (width >= 1440) assert.ok(Math.abs(result.card.width/result.card.height - 1180/650) < 0.04, 'reference aspect ratio');
        for (const [name,r] of Object.entries(result.boxes)) { assert.ok(r.x >= result.card.x && r.right <= result.card.right + 1, name); assert.ok(r.y >= result.card.y && r.bottom <= result.card.bottom + 1, name); }
        assert.ok(result.boxes['.th-gift-purchased'].x < result.boxes['.th-gift-recipient'].x);
        assert.ok(result.boxes['.th-gift-amount'].y < result.boxes['.th-gift-brand-area'].y);
        assert.ok(result.boxes['.th-gift-code'].y < result.boxes['.th-gift-message'].y);
        assert.ok(result.boxes['.th-gift-signature'].x > result.boxes['.th-gift-code'].right);
        for (const label of ['GHC 550.00','Only for use at','THURAYA','Nail Bar - Accra','Redemption code','Experience THURAYA','Valid until','Max 3 uses','The HAUTE Address for Cosmopolitan Nails']) assert.ok(result.text.includes(label), label);
        assert.equal(await page.locator('.th-gift-sender').count(), 0, 'no invented sender');
    } finally { await context.close(); }
});

test('large amount and long code remain complete in preview and export', async () => {
    const { context, page } = await surface();
    try {
        const long = { ...card, amount: 1250000.55, code: 'THGC-' + 'LEGACYLONGCODE'.repeat(7) };
        await page.evaluate(c => sales_openGiftCardPreview(c), long);
        assert.equal((await inspect(page)).clipped, false);
        assert.ok((await inspect(page)).text.includes('1,250,000.55'));
        await page.evaluate(() => { window.html2canvas = async el => {
            window.premiumExport = { text:el.textContent, width:el.clientWidth, clipped:[...el.querySelectorAll('p,strong')].some(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2), background:getComputedStyle(el).backgroundColor, wordmark:el.querySelector('.th-gift-wordmark').textContent };
            const canvas=document.createElement('canvas'); canvas.width=el.clientWidth; canvas.height=el.clientHeight; return canvas;
        }; });
        await page.locator('[data-gift-image]').click(); await page.waitForFunction(()=>window.premiumExport);
        const out=await page.evaluate(()=>window.premiumExport);
        assert.equal(out.clipped,false); assert.ok(out.width>1100); assert.equal(out.background,'rgb(3, 3, 3)'); assert.equal(out.wordmark,'THURAYA');
        for (const value of [long.code,long.recipientName,long.purchaserName,long.message,'1,250,000.55','31 Dec 2099']) assert.ok(out.text.includes(value));
    } finally { await context.close(); }
});

test('visual restoration leaves all security and business integration source unchanged', () => {
    const fs=require('node:fs'), cp=require('node:child_process');
    const base='5415107744b7244dfc8301e0b00cde2b826a03b4';
    const strip=source=>source.replace(/\r\n/g,'\n')
        .replace(/            \.thuraya-gift-preview-final \{[\s\S]*?(?=\n            @media \(max-width:1000px\))/,'VISUAL CSS')
        .replace(/    function giftCardDigitalHtml\(card\) \{[\s\S]*?(?=    function buildGiftShareText\(card\))/,'VISUAL MARKUP');
    assert.equal(strip(fs.readFileSync(path.join(__dirname,'sales-promo-v1.js'),'utf8')),strip(cp.execFileSync('git',['show',base+':sales-promo-v1.js'],{cwd:__dirname,encoding:'utf8'})));
    // Full Gift modules stay pinned; cross-feature hosts have separate scoped parity coverage.
    for (const file of ['gift-card-api.js','gift-card-model.js','functions/gift-service.js','functions/gift-authorization.js','functions/gift-checkout-policy.generated.js','firestore.staging-gift.rules','firestore.production-gift.rules']) {
        assert.equal(fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show',base+':'+file],{cwd:__dirname,maxBuffer:10e6,encoding:'utf8'}).replace(/\r\n/g,'\n'),file);
    }
});
