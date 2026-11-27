'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const {setup,chromium,app,html,read}=require('./intelligence-global-test-harness.cjs');
const PARENT='63259fee70ac453a4a1042ae8ddada656e956a2f';
const parentFile=file=>cp.execFileSync('git',['show',PARENT+':'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6}).replace(/\r\n/g,'\n');
const parentApp=parentFile('app.js');
const source=process.env.CLIENT_LABEL_PARENT==='1'?parentApp:app;
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});});
after(async()=>browser?.close());
async function surface(fn,selectedSource=source){
    const page=await setup(browser,{routes:true,source:selectedSource});
    try {await fn(page);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);assert.equal(await page.evaluate(()=>window.__writes),0);}
    finally {await page.close();}
}
const metric=page=>page.locator('.cip-metric').filter({has:page.locator('#cip_thisYear')});
const bar=page=>page.locator('#intelligencePeriodBar');
async function select(page,mode){
    await bar(page).getByRole('radio',{name:mode,exact:true}).check();
    await page.clock.runFor(1500);
    if(mode==='Custom'){
        await bar(page).getByLabel('Start Date',{exact:true}).fill('2025-05-01');
        await bar(page).getByLabel('End Date',{exact:true}).fill('2025-05-31');
        await bar(page).getByRole('button',{name:'Apply',exact:true}).click();
        await page.clock.runFor(1500);
    }
}
async function openClient(page){
    await page.evaluate(()=>{window.__navigations=[];});
    await page.locator('[data-ai-card="retention"]').getByRole('button',{name:'Open Client Intel',exact:true}).click();
    await page.clock.runFor(1500);
    assert.deepEqual(await page.evaluate(()=>window.__navigations),['clientIntelView']);
    assert.ok(await page.locator('#clientIntelView').isVisible());
    assert.ok(await page.locator('#cip_panel').isVisible());
}
async function back(page){
    await page.locator('label[for="nav_intelligence"]').click();
    await page.clock.runFor(3500);
}
async function check(page,value,label,start,end){
    assert.equal(await page.locator('#cip_thisYear').innerText(),value.toFixed(2)+' GHC');
    assert.equal((await metric(page).locator('.cip-metric-lbl').textContent()).trim(),label);
    assert.equal((await metric(page).locator('.cip-metric-lbl').innerText()).toLowerCase(),label.toLowerCase());
    assert.equal(await metric(page).locator('.cip-metric-lbl').count(),1);
    assert.equal(await page.locator('#cip_thisYear').count(),1);
    assert.equal(await page.locator('#cip_panel').count(),1);
    assert.equal(await page.locator('#cip_panel').getAttribute('data-period-start'),start);
    assert.equal(await page.locator('#cip_panel').getAttribute('data-period-end'),end);
    assert.doesNotMatch(await metric(page).innerText(),/this year/i);
}

test('exact parent reproduces correct selected-period value with stale label in real Client Intel markup',()=>surface(async page=>{
    assert.equal(require('./scheduling-source-parity.cjs').baselineSource('index.html',html),parentFile('index.html'));
    assert.equal(read('intelligence-engine-v1.js'),parentFile('intelligence-engine-v1.js'));
    await openClient(page);
    assert.equal(await page.locator('#cip_thisYear').innerText(),'900.00 GHC');
    assert.equal((await metric(page).locator('.cip-metric-lbl').textContent()).trim(),'This Year');
    assert.deepEqual(await page.locator('#cip_thisYear').evaluate(el=>({previous:el.previousElementSibling?.className||null,next:el.nextElementSibling.className,parent:el.parentElement.className})),{previous:null,next:'cip-metric-lbl',parent:'cip-metric'});
},parentApp));

for(const [mode,value,label,start,end] of [
    ['Monthly',900,'This Month','2025-06-01','2025-06-18'],
    ['Weekly',600,'Selected Week','2025-06-12','2025-06-18'],
    ['Daily',300,'Selected Day','2025-06-18','2025-06-18'],
    ['Custom',1200,'Selected Period','2025-05-01','2025-05-31']
])test('actual '+mode+' action binds selected-period value and label',()=>surface(async page=>{
    await select(page,mode);await openClient(page);await check(page,value,label,start,end);
}));

test('historical Monthly uses Selected Month from the shared period helper',()=>surface(async page=>{
    await bar(page).getByLabel('Analysis date',{exact:true}).fill('2025-05-20');await page.clock.runFor(1500);
    await openClient(page);await check(page,1200,'Selected Month','2025-05-01','2025-05-31');
}));

test('real Monthly -> Weekly -> Daily -> Custom -> Monthly switches value and label together without duplication',()=>surface(async page=>{
    await page.evaluate(()=>{for(const row of window.__jobs){row.clientName='Continuing Client';row.clientPhone='same-synthetic-client';}});
    await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();await page.clock.runFor(1500);
    for(const [mode,value,label,start,end] of [
        ['Monthly',1800,'This Month','2025-06-01','2025-06-18'],
        ['Weekly',900,'Selected Week','2025-06-12','2025-06-18'],
        ['Daily',300,'Selected Day','2025-06-18','2025-06-18'],
        ['Custom',1200,'Selected Period','2025-05-01','2025-05-31'],
        ['Monthly',1800,'This Month','2025-06-01','2025-06-18']
    ]){await select(page,mode);await openClient(page);await check(page,value,label,start,end);assert.match(await page.locator('#cip_panel').innerText(),/continuing client/i);await back(page);}
    assert.equal(await page.locator('[data-ai-card]').count(),6);
    assert.equal(await page.locator('#phase62PredictiveOverview').count(),1);
}));

test('actual Custom refresh preserves label, fetches fresh value once, restores button and advances freshness',()=>surface(async page=>{
    await select(page,'Custom');await openClient(page);await check(page,1200,'Selected Period','2025-05-01','2025-05-31');await back(page);
    const before=await page.locator('#intelligenceFreshness').getAttribute('datetime');
    await page.evaluate(()=>{
        window.__reads=[];
        const row=window.__jobs.find(r=>r.id==='Custom0');row.finalTotal=500;row.serviceLineItems[0].lineTotal=500;row.serviceLineItems[0].lineSubtotal=500;
        window.__hold=new Promise(resolve=>{window.__release=resolve;});
    });
    await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();
    assert.match(await page.locator('[data-intelligence-refresh]').innerText(),/^Refreshing/);
    assert.ok(await page.locator('[data-intelligence-refresh]').isDisabled());
    assert.equal(await page.locator('#intelligenceFreshness').getAttribute('datetime'),before);
    await page.evaluate(()=>{window.__release();window.__hold=null;});await page.clock.runFor(2000);
    assert.ok(await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).isEnabled());
    assert.ok(Date.parse(await page.locator('#intelligenceFreshness').getAttribute('datetime'))>Date.parse(before));
    assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.name==='Active_Jobs').length),1);
    assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.name==='Appointments').length),1);
    assert.equal(await page.evaluate(()=>window.ThurayaIntelligencePeriod.get().mode),'custom');
    await openClient(page);await check(page,1300,'Selected Period','2025-05-01','2025-05-31');
    await back(page);assert.equal(await page.locator('[data-intelligence-refresh]').count(),1);
}));

test('normal navigation re-entry preserves Weekly period and selected-period client label',()=>surface(async page=>{
    await select(page,'Weekly');await openClient(page);await check(page,600,'Selected Week','2025-06-12','2025-06-18');await back(page);
    assert.equal(await page.evaluate(()=>window.ThurayaIntelligencePeriod.get().mode),'weekly');
    await page.locator('label[for="nav_client_intel"]').click();await page.clock.runFor(1500);
    await check(page,600,'Selected Week','2025-06-12','2025-06-18');
}));

test('runtime delta is exactly the reviewed Client Intel label binding; calculations and real HTML are unchanged',()=>{
    const before="        const yearMetric=document.getElementById('cip_thisYear');\n        if (yearMetric?.previousElementSibling) yearMetric.previousElementSibling.textContent='Selected Period';";
    const after="        const periodLabel=document.getElementById('cip_thisYear')?.closest('.cip-metric')?.querySelector('.cip-metric-lbl');\n        if (periodLabel) periodLabel.textContent=window.ThurayaIntelligencePeriod.label();";
    assert.equal(parentApp.split(before).length,2);
    const { baselineSource }=require('./scheduling-source-parity.cjs');
    assert.equal(hash(baselineSource('app.js',app)),hash(parentApp.replace(before,after)),'Only the two reviewed runtime lines may change outside fingerprint-reviewed scheduling integration');
    assert.equal(baselineSource('index.html',html),parentFile('index.html'));
    assert.equal(read('intelligence-engine-v1.js'),parentFile('intelligence-engine-v1.js'));
});
