'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'), vm=require('node:vm'), cp=require('node:child_process');
const {setup,chromium,app,block}=require('./intelligence-global-test-harness.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});});
after(async()=>browser?.close());
const bar=page=>page.locator('#intelligencePeriodBar');
const owner=page=>page.locator('[data-ai-card="owner"]');
async function select(page,mode){await bar(page).getByRole('radio',{name:mode,exact:true}).check();await page.clock.runFor(1500);}
async function surface(fn,options={}){const page=await setup(browser,options);try{await fn(page);}finally{await page.close();}}
function resolver(){const c={window:null,getLocalDateString:()=> '2025-06-18',console};c.window=c;vm.createContext(c);vm.runInContext(block(app,'// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS'),c);vm.runInContext(block(app,'// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD'),c);return c.ThurayaIntelligencePeriod;}
test('default is one immutable Monthly current MTD period',()=>{const p=resolver();assert.equal(p.get().mode,'monthly');assert.equal(p.get().startDate,'2025-06-01');assert.equal(p.get().endDate,'2025-06-18');assert.equal(p.get().days,18);assert.equal(p.get(),p.get());assert.ok(Object.isFrozen(p.get()));});
for(const [mode,input,start,end,days] of [
 ['monthly',{anchorDate:'2025-06-30'},'2025-06-01','2025-06-18',18],
 ['monthly',{anchorDate:'2024-02-17'},'2024-02-01','2024-02-29',29],
 ['daily',{anchorDate:'2025-05-10'},'2025-05-10','2025-05-10',1],
 ['weekly',{anchorDate:'2025-01-02'},'2024-12-27','2025-01-02',7],
 ['custom',{startDate:'2025-05-01',endDate:'2025-05-15'},'2025-05-01','2025-05-15',15]
])test('global resolver '+mode+' '+start,()=>{const p=resolver().resolve({mode,...input});assert.deepEqual([p.startDate,p.endDate,p.days],[start,end,days]);});
test('global custom rejects reversed dates',()=>assert.throws(()=>resolver().resolve({mode:'custom',startDate:'2025-06-20',endDate:'2025-06-19'})));
test('canonical filter excludes surrounding dates and never invents a timestamp',()=>{const p=resolver();assert.deepEqual(Array.from(p.filter([{dateString:'2025-05-31'},{dateString:'2025-06-01'},{dateString:'2025-06-18'},{dateString:'2025-06-19'},{}]),r=>r.dateString),['2025-06-01','2025-06-18']);});
async function consistent(page,start,end,total,leader){
 const state=await page.evaluate(()=>window.ThurayaIntelligencePeriod.get());assert.deepEqual([state.startDate,state.endDate],[start,end]);
 for(const selector of ['#intelligencePanel','[data-predictive-period]','[data-ai-range]']){const node=page.locator(selector);assert.equal(await node.getAttribute(selector==='#intelligencePanel'?'data-period-start':'data-start'),start);assert.equal(await node.getAttribute(selector==='#intelligencePanel'?'data-period-end':'data-end'),end);}
 for(const selector of ['#intelligencePanel','#phase62PredictiveOverview','[data-ai-card="owner"]'])assert.ok((await page.locator(selector).innerText()).includes(total.toFixed(2)+' GHC'),selector);
 for(const selector of ['#intelligencePanel','#phase62PredictiveOverview','[data-ai-card="technician"]'])assert.ok((await page.locator(selector).innerText()).includes(leader+' Tech'),selector);
 assert.ok((await page.locator('[data-ai-card="retention"]').innerText()).includes(leader+' Client'));
 assert.ok((await page.locator('#phase62PredictiveOverview [data-service-id]').first().innerText()).includes(leader+' Service'));
 assert.equal(await page.locator('[data-ai-card]').count(),6);assert.equal(await page.locator('#phase62PredictiveOverview').count(),1);
 assert.doesNotMatch(await page.locator('#intelligenceView').innerText(),/Lifetime|Future|Revenue Today|Last 7 Days Revenue|Total history analyzed/);
}
test('real Monthly -> Weekly -> Daily -> Custom changes every primary consumer together',()=>surface(async page=>{
 await consistent(page,'2025-06-01','2025-06-18',1800,'Monthly');
 assert.match(await bar(page).innerText(),/Month to Date/);
 await select(page,'Weekly');await consistent(page,'2025-06-12','2025-06-18',900,'Weekly');
 await select(page,'Daily');await consistent(page,'2025-06-18','2025-06-18',300,'Daily');
 await select(page,'Custom');await bar(page).getByLabel('Start Date',{exact:true}).fill('2025-05-20');await bar(page).getByLabel('End Date',{exact:true}).fill('2025-05-20');await bar(page).getByRole('button',{name:'Apply',exact:true}).click();await page.clock.runFor(1500);
 await consistent(page,'2025-05-20','2025-05-20',1200,'Custom');
}));
test('shared Refresh retains Custom and changes all consumers from a single fresh data read',()=>surface(async page=>{
 await select(page,'Custom');await bar(page).getByLabel('Start Date',{exact:true}).fill('2025-05-01');await bar(page).getByLabel('End Date',{exact:true}).fill('2025-05-31');await bar(page).getByRole('button',{name:'Apply',exact:true}).click();await page.clock.runFor(1000);
 const before=await page.locator('#intelligenceFreshness').getAttribute('datetime');
 await page.evaluate(()=>{window.__reads=[];const row=window.__jobs.find(r=>r.id==='Custom0');row.finalTotal=500;row.serviceLineItems[0].lineTotal=500;row.serviceLineItems[0].lineSubtotal=500;});
 await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();await page.clock.runFor(2000);
 await consistent(page,'2025-05-01','2025-05-31',1300,'Custom');
 assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.name==='Active_Jobs').length),1);assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.name==='Appointments').length),1);
 assert.ok(Date.parse(await page.locator('#intelligenceFreshness').getAttribute('datetime'))>Date.parse(before));
}));
test('dedupe precedes date filtering consistently for every recognized revenue consumer',()=>surface(async page=>{
 await page.evaluate(()=>window.__jobs.unshift({...window.__jobs.find(r=>r.id==='Monthly0'),id:'newerDuplicate',dateString:'2025-07-01'}));
 await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();await page.clock.runFor(1500);
 for(const selector of ['#intelligencePanel','#phase62PredictiveOverview','[data-ai-card="owner"]'])assert.match(await page.locator(selector).innerText(),/1500\.00 GHC/);
}));
test('current-month Refresh advances MTD at business-date rollover without changing selected mode',()=>surface(async page=>{
 await page.clock.setSystemTime(new Date('2025-06-19T12:00:00Z'));
 await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();await page.clock.runFor(1500);
 await consistent(page,'2025-06-01','2025-06-19',1800,'Monthly');
 assert.equal(await page.evaluate(()=>window.ThurayaIntelligencePeriod.get().days),19);
 assert.ok(await bar(page).getByRole('radio',{name:'Monthly',exact:true}).isChecked());
}));
test('VIP navigation uses exact canonical client identity, including persisted phone aliases',()=>surface(async page=>{
 await page.evaluate(()=>{for(const row of window.__jobs){if(row.id.startsWith('Monthly')||row.id.startsWith('Weekly'))row.clientName='Shared Client';if(row.id.startsWith('Monthly')){row.Tel_Number=row.clientPhone;delete row.clientPhone;}}});
 await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();await page.clock.runFor(1500);
 await page.locator('[data-ai-card="retention"]').getByRole('button',{name:'Open Client Intel',exact:true}).click();await page.clock.runFor(1500);
 assert.match(await page.locator('#cip_totalSpend').innerText(),/900\.00/);
 assert.equal(await page.locator('#cip_totalVisits').innerText(),'3');
 assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
},{routes:true}));
test('no-evidence VIP route cannot display the previously opened client as current analysis',()=>surface(async page=>{
 await page.locator('[data-ai-card="retention"]').getByRole('button',{name:'Open Client Intel',exact:true}).click();await page.clock.runFor(1500);
 await page.locator('label[for="nav_intelligence"]').click();await page.clock.runFor(3500);
 await select(page,'Daily');await bar(page).getByLabel('Analysis date',{exact:true}).fill('2025-05-01');await page.clock.runFor(1500);
 await page.locator('[data-ai-card="retention"]').getByRole('button',{name:'Open Client Intel',exact:true}).click();await page.clock.runFor(1500);
 assert.equal(await page.locator('#cip_panel').isVisible(),false);assert.ok(await page.locator('#cip_periodEmpty').isVisible());
 assert.match(await page.locator('#cip_periodEmpty').innerText(),/No qualifying client activity.*1 May 2025/);
 assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
},{routes:true}));
test('real Client Alerts and normal re-entry use the current global evidence window',()=>surface(async page=>{
 await page.locator('[data-ai-card="retention"]').getByRole('button',{name:'Open Client Intel',exact:true}).click();await page.clock.runFor(1500);
 await page.locator('.cip-tab').filter({hasText:'Alerts'}).click();
 assert.ok(await page.locator('#cip_predictiveBox').isVisible());assert.match(await page.locator('#cip_predictiveBox').innerText(),/900\.00 GHC/);
 assert.doesNotMatch(await page.locator('#cip_alertsList').innerText(),/lifetime/i);
 await page.locator('label[for="nav_intelligence"]').click();await page.clock.runFor(3500);await select(page,'Weekly');
 await page.locator('label[for="nav_client_intel"]').click();await page.clock.runFor(1500);
 assert.equal(await page.locator('#cip_panel').getAttribute('data-period-start'),'2025-06-12');assert.match(await page.locator('#cip_totalSpend').innerText(),/^0\.00/);
 await page.locator('.cip-tab').filter({hasText:'Alerts'}).click();assert.match(await page.locator('#cip_predictiveBox').innerText(),/No qualifying client activity/);
 assert.equal(await page.locator('#cip_predictiveBox').count(),1);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
},{routes:true}));
const actions=[['upsell','Open Sales & Promo','salesView','Create Promotion'],['retention','Open Client Intel','clientIntelView','Client'],['technician','Open HR & Finance','hrView','Payroll'],['promo','Open Sales & Promo','salesView','Create Promotion'],['menu','Open Service Menu','menuView','Fixture Service'],['owner','Open Reports','reportsView','Load Report']];
for(const [key,label,id,content] of actions)test('actual '+key+' action opens initialized nonblank '+id+' once',()=>surface(async page=>{
 await select(page,'Weekly');await page.evaluate(()=>{window.__navigations=[];});
 await page.locator(`[data-ai-card="${key}"]`).getByRole('button',{name:label,exact:true}).click();await page.clock.runFor(1500);
 assert.equal(await page.locator('#'+id).isVisible(),true);assert.ok((await page.locator('#'+id).innerText()).toLowerCase().includes(content.toLowerCase()),await page.locator('#'+id).innerText());
 assert.deepEqual(await page.evaluate(()=>window.__navigations),[id]);assert.deepEqual(await page.evaluate(()=>window.__errors),[]);assert.equal(await page.evaluate(()=>window.__writes),0);
 if(key==='retention'){assert.equal(await page.locator('#cip_panel').getAttribute('data-period-start'),'2025-06-12');assert.match(await page.locator('#cip_totalSpend').innerText(),/600\.00/);}
 await page.locator('label[for="nav_intelligence"]').click();await page.clock.runFor(5000);await consistent(page,'2025-06-12','2025-06-18',900,'Weekly');
},{routes:true}));
for(const width of [1280,768,390])test('global controls and all six routes usable at '+width,()=>surface(async page=>{
 await select(page,'Weekly');
 for(const [key,label,id] of actions){await page.locator(`[data-ai-card="${key}"]`).getByRole('button',{name:label,exact:true}).click();await page.clock.runFor(1200);assert.ok(await page.locator('#'+id).isVisible());await page.locator('label[for="nav_intelligence"]').click();await page.clock.runFor(3000);}
 await consistent(page,'2025-06-12','2025-06-18',900,'Weekly');
 const boxes=await bar(page).locator('input,button,[data-intelligence-range]').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>{const b=n.getBoundingClientRect();return[b.left,b.right];}));for(const [left,right]of boxes)assert.ok(left>=0&&right<=width+1);
 assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
},{routes:true,width}));
