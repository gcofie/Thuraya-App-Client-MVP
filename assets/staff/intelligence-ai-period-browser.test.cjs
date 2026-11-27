'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {setup,chromium}=require('./intelligence-global-test-harness.cjs');
const layer=page=>page.locator('#phase64AiActionLayer');
const control=page=>page.locator('#intelligencePeriodBar');
const card=(page,key)=>layer(page).locator(`[data-ai-card="${key}"]`);
async function panels(page){
    for(const label of ['Period Revenue','Avg Daily Revenue'])assert.equal(await page.getByText(label,{exact:true}).count(),1);
    assert.equal(await page.locator('#intelligencePanel').count(),1);
    assert.equal(await page.locator('#phase62PredictiveOverview').count(),1);assert.equal(await layer(page).count(),1);
    assert.equal(await layer(page).locator('[data-ai-card]').count(),6);
    assert.equal(await control(page).locator('input[type=radio]:checked').count(),1);
}
async function select(page,name){await control(page).getByRole('radio',{name,exact:true}).check();await page.clock.runFor(1200);}
async function range(page,mode,start,end){
    assert.equal(await layer(page).locator('[data-ai-range]').getAttribute('data-mode'),mode);
    assert.equal(await layer(page).locator('[data-ai-range]').getAttribute('data-start'),start);
    assert.equal(await layer(page).locator('[data-ai-range]').getAttribute('data-end'),end);
    assert.deepEqual(await layer(page).locator('[data-ai-card]').evaluateAll(nodes=>nodes.map(n=>[n.dataset.periodStart,n.dataset.periodEnd])),Array.from({length:6},()=>[start,end]));
    await panels(page);
}
async function browserTest(fn){const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});try{await fn(browser);}finally{await browser.close();}}
test('parent real initialization has no period control and lifetime leaders; settled action duplication not reproduced',()=>browserTest(async browser=>{
    const page=await setup(browser,{old:true});
    assert.equal(await layer(page).locator('input[type=date]').count(),0);
    assert.match(await layer(page).innerText(),/Lifetime Tech/);assert.match(await layer(page).innerText(),/History analyzed/);
    await page.evaluate(()=>{window.ThurayaActions.openHRFinance=()=>window.__actions.push('hr');});
    await layer(page).getByRole('button',{name:'Open HR & Finance',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__actions.length),1);
}));
test('real Daily -> Weekly -> Monthly -> Custom switching updates all six cards and surrounding KPIs',()=>browserTest(async browser=>{
    const page=await setup(browser);
    await select(page,'Daily');
    const dailyKpis=await page.locator('#intelligencePanel').innerText();
    await range(page,'daily','2025-06-18','2025-06-18');assert.match(await card(page,'owner').innerText(),/300\.00 GHC/);
    for(const [mode,start,tech,total] of [['Weekly','2025-06-12','Weekly',900],['Monthly','2025-06-01','Monthly',1800]]){
        await page.evaluate(()=>{window.__reads=[];});await select(page,mode);
        await range(page,mode.toLowerCase(),start,'2025-06-18');
        for(const [key,expected] of [['upsell',tech+' Service'],['retention',tech+' Client'],['technician',tech+' Tech']])assert.ok((await card(page,key).innerText()).includes(expected));
        assert.ok((await card(page,'owner').innerText()).includes(total.toFixed(2)+' GHC'));
        assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.ai).length),1);
        assert.doesNotMatch(await layer(page).innerText(),/Lifetime|Future/);
    }
    await select(page,'Custom');
    await control(page).getByLabel('Start Date',{exact:true}).fill('2025-05-20');await control(page).getByLabel('End Date',{exact:true}).fill('2025-05-20');
    await control(page).getByRole('button',{name:'Apply',exact:true}).click();await page.clock.runFor(1200);
    await range(page,'custom','2025-05-20','2025-05-20');
    assert.match(await card(page,'owner').innerText(),/1200\.00 GHC/);assert.match(await card(page,'upsell').innerText(),/Custom Service/);assert.match(await card(page,'retention').innerText(),/Custom Client/);assert.match(await card(page,'technician').innerText(),/Custom Tech/);
    assert.notEqual(await page.locator('#intelligencePanel').innerText(),dailyKpis);
    assert.match(await page.locator('#intelligencePanel').innerText(),/1200\.00 GHC/);
    assert.equal(await page.evaluate(()=>window.__writes),0);
}));
test('invalid reversed custom range has no read and does not replace committed cards',()=>browserTest(async browser=>{
    const page=await setup(browser);await select(page,'Custom');const previous=await card(page,'owner').innerText();
    await page.evaluate(()=>{window.__reads=[];});
    await control(page).getByLabel('Start Date',{exact:true}).fill('2025-06-19');await control(page).getByLabel('End Date',{exact:true}).fill('2025-06-18');
    await control(page).getByRole('button',{name:'Apply',exact:true}).click();await page.clock.runFor(1000);
    assert.match(await control(page).getByRole('alert').innerText(),/End date must not be before start date/);
    assert.equal(await card(page,'owner').innerText(),previous);assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.ai).length),0);
    assert.equal(await control(page).getByRole('button',{name:'Apply',exact:true}).isEnabled(),true);
}));
test('shared Refresh preserves selected period, fetches once, updates cards and completes freshness',()=>browserTest(async browser=>{
    const page=await setup(browser);await select(page,'Weekly');
    const before=await page.locator('#intelligenceFreshness').getAttribute('datetime');
    await page.evaluate(()=>{window.__reads=[];window.__hold=new Promise(resolve=>{window.__release=resolve;});window.__jobs.find(r=>r.id==='Weekly0').finalTotal=1000;window.__jobs.find(r=>r.id==='Weekly0').serviceLineItems[0].lineTotal=1000;window.__jobs.find(r=>r.id==='Weekly0').serviceLineItems[0].lineSubtotal=1000;});
    await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();
    assert.equal(await page.locator('[data-intelligence-refresh]').innerText(),'Refreshing…');
    assert.equal(await page.locator('#intelligenceFreshness').getAttribute('datetime'),before);
    await page.evaluate(()=>{window.__hold=null;window.__release();});await page.clock.runFor(2000);
    await range(page,'weekly','2025-06-12','2025-06-18');assert.match(await card(page,'owner').innerText(),/1700\.00 GHC/);
    assert.ok(Date.parse(await page.locator('#intelligenceFreshness').getAttribute('datetime'))>Date.parse(before));
    assert.equal(await page.locator('[data-intelligence-refresh]').innerText(),'Refresh Intelligence');
    assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.ai).length),1);
}));
test('slow period read hides stale cards, prevents overlapping controls, restores committed state on failure and retries',()=>browserTest(async browser=>{
    const page=await setup(browser);const previous=await card(page,'owner').innerText();
    await page.evaluate(()=>{window.__hold=new Promise(resolve=>{window.__release=resolve;});window.__fail=true;});
    await control(page).getByRole('radio',{name:'Weekly',exact:true}).check();
    assert.equal(await control(page).getAttribute('aria-busy'),'true');assert.equal(await card(page,'owner').isVisible(),false);
    assert.equal(await control(page).getByRole('radio',{name:'Monthly',exact:true}).isDisabled(),true);
    await page.evaluate(()=>{window.__hold=null;window.__release();});await page.clock.runFor(1200);
    assert.equal(await card(page,'owner').innerText(),previous);assert.equal(await card(page,'owner').isVisible(),true);
    assert.equal(await control(page).getAttribute('aria-busy'),'false');assert.match(await page.locator('#intelligenceRefreshError').innerText(),/Synthetic AI read failure/);
    await range(page,'monthly','2025-06-01','2025-06-18');
    await page.evaluate(()=>{window.__fail=false;});await select(page,'Weekly');await range(page,'weekly','2025-06-12','2025-06-18');
    assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
}));
test('tab re-entry and repeated renders preserve selection without stacking control handlers',()=>browserTest(async browser=>{
    const page=await setup(browser);await select(page,'Monthly');
    await page.evaluate(()=>{window.switchModule('otherView');window.switchModule('intelligenceView');});await page.clock.runFor(7000);
    await range(page,'monthly','2025-06-01','2025-06-18');
    for(let i=0;i<3;i++){
        await page.evaluate(()=>window.thurayaPhase64Render());await page.clock.runFor(1200);
        await panels(page);
    }
    await page.evaluate(()=>{window.__reads=[];});await select(page,'Daily');assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.ai).length),1);
}));
test('empty period clears stale recommendations and legacy assisted-action fallback context',()=>browserTest(async browser=>{
    const page=await setup(browser);await control(page).getByLabel('Analysis date',{exact:true}).fill('2025-08-01');await control(page).getByLabel('Analysis date',{exact:true}).press('Tab');await page.clock.runFor(1500);
    assert.match(await card(page,'owner').innerText(),/No recognized revenue/);assert.doesNotMatch(await layer(page).innerText(),/Daily Client|Daily Tech|Daily Service/);
    await page.evaluate(()=>{window.bestService='stale lifetime';window.topClient='stale client';window.ThurayaActions.openSalesPromo=()=>window.__actions.push({service:window.bestService,client:window.topClient});});
    await card(page,'upsell').getByRole('button').click();assert.deepEqual(await page.evaluate(()=>({service:window.bestService,client:window.topClient})),{service:'',client:''});
}));
for(const width of [1280,768,390])test('responsive controls and cards at '+width,()=>browserTest(async browser=>{
    const page=await setup(browser,{width});await select(page,'Custom');
    await control(page).getByLabel('Start Date',{exact:true}).fill('2025-05-20');await control(page).getByLabel('End Date',{exact:true}).fill('2025-06-18');await control(page).getByRole('button',{name:'Apply',exact:true}).click();await page.clock.runFor(1200);
    const bounds=await layer(page).evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,controls:[...el.querySelectorAll('input,button,[data-ai-range]')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width};})}));
    assert.ok(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));for(const r of bounds.controls){assert.ok(r.left>=0&&r.right<=width+1,JSON.stringify(r));assert.ok(r.width>0);}
    await panels(page);await layer(page).screenshot({path:path.join(os.tmpdir(),`thuraya-ai-period-${width}.png`)});
}));
test('default date follows existing local operational timezone, not UTC today',()=>browserTest(async browser=>{
    for(const [timezoneId,expected] of [['Pacific/Kiritimati','2025-06-19'],['America/Los_Angeles','2025-06-18']]){
        const page=await setup(browser,{timezoneId});await range(page,'monthly','2025-06-01',expected);await page.close();
    }
}));
