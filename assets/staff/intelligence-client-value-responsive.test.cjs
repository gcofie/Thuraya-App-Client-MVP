'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {setup,chromium,read,app,html,styles}=require('./intelligence-global-test-harness.cjs');
const PARENT='f4095d5a6bbec73f0e1a750c35fd6100e58348f7';
const parentFile=file=>cp.execFileSync('git',['show',PARENT+':'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6}).replace(/\r\n/g,'\n');
const moneyIds=['cip_totalSpend','cip_avgSpend','cip_thisYear'];
const values=[0,60,225,8938.80,22785.60,132342.20,999999999999.99];
const correction=`/* Keep Client Intel amounts readable without changing other metric values. */
.cip-metric:has(> :is(#cip_totalSpend, #cip_avgSpend, #cip_thisYear)) {
    flex: 1 1 12rem;
    min-width: min(100%, 12rem);
    max-width: 100%;
}
:is(#cip_totalSpend, #cip_avgSpend, #cip_thisYear) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
}
`;
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});});
after(async()=>browser?.close());
async function surface(width,fn,parentStyle=false){
    const page=await setup(browser,{width,routes:true});
    try{
        if(parentStyle||process.env.CLIENT_VALUE_PARENT==='1'){
            await page.locator('style').first().evaluate((el,css)=>{el.textContent=css;},styles.replace(read('styles.css'),parentFile('styles.css')));
        }
        await fn(page);
        assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
        assert.equal(await page.evaluate(()=>window.__writes),0);
    }finally{await page.close();}
}
async function snapshot(page,name){
    if(!process.env.CLIENT_VALUE_SCREENSHOTS)return;
    fs.mkdirSync(process.env.CLIENT_VALUE_SCREENSHOTS,{recursive:true});
    await page.locator('#cip_panel').screenshot({path:path.join(process.env.CLIENT_VALUE_SCREENSHOTS,name+'.png')});
}
async function refresh(page){
    await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();
    await page.clock.runFor(2000);
}
async function back(page){
    await page.locator('label[for="nav_intelligence"]').click();
    await page.clock.runFor(3500);
}
async function openAction(page){
    await page.evaluate(()=>{window.__navigations=[];});
    await page.locator('[data-ai-card="retention"]').getByRole('button',{name:'Open Client Intel',exact:true}).click();
    await page.clock.runFor(1500);
    assert.deepEqual(await page.evaluate(()=>window.__navigations),['clientIntelView']);
    assert.ok(await page.locator('#cip_panel').isVisible());
}
async function singleClient(page,value){
    await page.evaluate(amount=>{
        const row={...window.__jobs[0],id:'responsive-synthetic',sourceAppointmentId:'responsive-synthetic',clientName:'Responsive Client',clientPhone:'responsive-client',finalTotal:amount};
        row.serviceLineItems=[{...row.serviceLineItems[0],lineTotal:amount,lineSubtotal:amount}];
        window.__jobs=[row];window.__apps=[];
    },value);
    await refresh(page);await openAction(page);
}
async function select(page,mode){
    const bar=page.locator('#intelligencePeriodBar');
    await bar.getByRole('radio',{name:mode,exact:true}).check();await page.clock.runFor(1500);
    if(mode==='Custom'){
        await bar.getByLabel('Start Date',{exact:true}).fill('2025-05-01');
        await bar.getByLabel('End Date',{exact:true}).fill('2025-05-31');
        await bar.getByRole('button',{name:'Apply',exact:true}).click();await page.clock.runFor(1500);
    }
}
async function readable(page,id,expected){
    const value=page.locator('#'+id);
    assert.equal((await value.textContent()).trim(),expected,id+' formatting');
    assert.equal((await value.innerText()).replace(/\s+/g,' ').trim(),expected,id+' visible text');
    assert.equal(await value.count(),1);
    const info=await value.evaluate(el=>{
        const rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
        const box=el.getBoundingClientRect(),cell=el.closest('.cip-metric').getBoundingClientRect();
        const label=el.closest('.cip-metric').querySelector('.cip-metric-lbl');
        const style=getComputedStyle(el),chars=[];
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
            const node=walker.currentNode;
            for(let i=0;i<node.length;i++)if(/\S/.test(node.textContent[i])){
                const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
                chars.push(...Array.from(range.getClientRects(),rect));
            }
        }
        return{box:rect(box),cell:rect(cell),label:rect(label.getBoundingClientRect()),chars,textOverflow:style.textOverflow,
            overflow:style.overflow,whiteSpace:style.whiteSpace,fontSize:parseFloat(style.fontSize),
            scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,hidden:!!el.closest('[aria-hidden="true"],[hidden]')};
    });
    assert.notEqual(info.textOverflow,'ellipsis',id+' must not ellipsize');
    assert.equal(info.hidden,false,id+' accessible plain text');
    assert.ok(info.fontSize>=18,id+' retains readable existing type size');
    assert.ok(info.chars.length>0&&info.box.height>0,id+' nonblank');
    assert.ok(info.scrollWidth<=info.clientWidth+1,id+' no internal horizontal overflow');
    for(const r of info.chars){
        assert.ok(r.width>0&&r.height>0,id+' character is rendered');
        assert.ok(r.left>=info.box.left-1&&r.right<=info.box.right+1,id+' character fits value');
        assert.ok(r.top>=info.box.top-2&&r.bottom<=info.box.bottom+2,id+' character fits vertically');
    }
    assert.ok(info.box.bottom<=info.label.top+1,id+' does not overlap label');
    assert.ok(info.label.bottom<=info.cell.bottom+1,id+' label fits cell');
    assert.ok(info.label.left>=info.cell.left&&info.label.right<=info.cell.right,id+' label fits horizontally');
}
async function layout(page){
    const result=await page.locator('#cip_panel .cip-metric').evaluateAll(nodes=>({
        boxes:nodes.map(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),
        viewport:innerWidth,pageWidth:document.documentElement.scrollWidth
    }));
    assert.equal(result.boxes.length,8,'no duplicate metrics');
    assert.ok(result.pageWidth<=result.viewport+1,'no horizontal page break');
    for(const [i,a]of result.boxes.entries()){
        assert.ok(a.left>=-1&&a.right<=result.viewport+1,'metric stays inside viewport');
        for(const b of result.boxes.slice(i+1))assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1,'metric cells do not overlap');
    }
    assert.equal(await page.locator('#cip_panel').count(),1);
}
async function periodValue(page,value,label){
    await readable(page,'cip_thisYear',value.toFixed(2)+' GHC');
    assert.equal((await page.locator('#cip_thisYear').locator('..').locator('.cip-metric-lbl').textContent()).trim(),label);
    assert.doesNotMatch(await page.locator('#cip_panel').innerText(),/This Year/i);
    await layout(page);
}

test('exact parent CSS reproduces 662px clipping with the real Client Intel binding',()=>surface(662,async page=>{
    await singleClient(page,8938.80);
    const evidence=await page.locator('#cip_thisYear').evaluate(el=>({text:el.textContent,width:el.clientWidth,scroll:el.scrollWidth,overflow:getComputedStyle(el).overflow,textOverflow:getComputedStyle(el).textOverflow,whiteSpace:getComputedStyle(el).whiteSpace,cellWidth:el.parentElement.getBoundingClientRect().width,minWidth:getComputedStyle(el.parentElement).minWidth}));
    assert.equal(evidence.text,'8938.80 GHC');assert.ok(evidence.scroll>evidence.width);
    assert.equal(evidence.overflow,'hidden');assert.equal(evidence.textOverflow,'ellipsis');assert.equal(evidence.whiteSpace,'nowrap');assert.equal(evidence.minWidth,'90px');
    console.log('PARENT_662_CLIPPING',JSON.stringify(evidence));await snapshot(page,'client-value-parent-662');
},true));

for(const width of [1280,768,662,390])test(width+'px money values retain every digit, currency and label without overflow',()=>surface(width,async page=>{
    await singleClient(page,60);
    for(const [index,amount]of values.entries()){
        await back(page);
        await page.evaluate(value=>{const row=window.__jobs[0];row.finalTotal=value;row.serviceLineItems[0].lineTotal=value;row.serviceLineItems[0].lineSubtotal=value;},amount);
        await select(page,index%2?'Weekly':'Daily');
        await refresh(page);
        await page.locator('label[for="nav_client_intel"]').click();await page.clock.runFor(1500);
        for(const id of moneyIds)await readable(page,id,amount.toFixed(2)+' GHC');
        await layout(page);
        if(amount===8938.80)await snapshot(page,'client-value-'+width);
        if(amount===values.at(-1)&&width===390)await snapshot(page,'client-value-large-390');
    }
}));

for(const [mode,value,label]of [['Monthly',900,'This Month'],['Weekly',600,'Selected Week'],['Daily',300,'Selected Day'],['Custom',1200,'Selected Period']]){
    test('662px '+mode+' actual period value and label remain readable',()=>surface(662,async page=>{
        await select(page,mode);await openAction(page);await periodValue(page,value,label);
    }));
}

test('662px real period switches keep the same client, correct full value and label without duplicate content',()=>surface(662,async page=>{
    await page.evaluate(()=>{for(const row of window.__jobs){row.clientName='Continuing Client';row.clientPhone='same-responsive-client';}});
    await refresh(page);
    for(const [mode,value,label]of [['Monthly',1800,'This Month'],['Weekly',900,'Selected Week'],['Daily',300,'Selected Day'],['Custom',1200,'Selected Period'],['Monthly',1800,'This Month']]){
        await select(page,mode);await openAction(page);await periodValue(page,value,label);await back(page);
    }
}));

test('662px real Custom refresh and OPEN CLIENT INTEL preserve complete spend, period, freshness and single navigation',()=>surface(662,async page=>{
    await page.evaluate(()=>{const row=window.__jobs.find(r=>r.id==='Custom0');row.finalTotal=8938.80;row.serviceLineItems[0].lineTotal=8938.80;row.serviceLineItems[0].lineSubtotal=8938.80;window.__jobs=window.__jobs.filter(r=>!r.id.startsWith('Custom')||r.id==='Custom0');});
    await select(page,'Custom');await openAction(page);await periodValue(page,8938.80,'Selected Period');await back(page);
    const period=await page.evaluate(()=>window.ThurayaIntelligencePeriod.get());
    const before=await page.locator('#intelligenceFreshness').getAttribute('datetime');
    await page.evaluate(()=>{window.__reads=[];window.__hold=new Promise(resolve=>{window.__release=resolve;});});
    await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).click();
    assert.ok(await page.locator('[data-intelligence-refresh]').isDisabled());assert.match(await page.locator('[data-intelligence-refresh]').innerText(),/^Refreshing/);
    assert.equal(await page.locator('#intelligenceFreshness').getAttribute('datetime'),before);
    await page.evaluate(()=>{window.__release();window.__hold=null;});await page.clock.runFor(2000);
    assert.ok(await page.getByRole('button',{name:'Refresh Intelligence',exact:true}).isEnabled());
    assert.ok(Date.parse(await page.locator('#intelligenceFreshness').getAttribute('datetime'))>Date.parse(before));
    assert.deepEqual(await page.evaluate(()=>window.ThurayaIntelligencePeriod.get()),period);
    assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.name==='Active_Jobs').length),1);
    assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.name==='Appointments').length),1);
    await openAction(page);await periodValue(page,8938.80,'Selected Period');await back(page);
    assert.equal(await page.locator('[data-intelligence-refresh]').count(),1);assert.equal(await page.locator('#phase62PredictiveOverview').count(),1);assert.equal(await page.locator('[data-ai-card]').count(),6);
}));

test('only Client Intel metric sizing and monetary CSS change; HTML, calculations, canonical model and refresh source remain byte-identical',()=>{
    const parentCss=parentFile('styles.css');
    assert.equal(parentCss.split('.cip-metric-lbl {').length,2);
    const marker='/* Expected Today actions: size to the card, not the viewport. */';
    const parts=read('styles.css').split('\n'+marker);
    assert.equal(parts.length,2,'one reviewed Expected Today CSS addition');
    assert.equal(require('node:crypto').createHash('sha256').update(marker+parts[1]).digest('hex'),
        '19cb552b65268166604dbe8ed4876a98f85eaa428ed052ddee3f711fa9ed4d2c','exact scoped Expected Today presentation');
    assert.equal(parts[0],parentCss.replace('.cip-metric {\n    flex: 1;\n    min-width: 90px;', '.cip-metric {\n    flex: 1;\n    min-width: min(100%, 8rem);').replace('.cip-metric-lbl {',correction+'.cip-metric-lbl {'));
    const { baselineSource }=require('./scheduling-source-parity.cjs');
    assert.equal(baselineSource('app.js',app),parentFile('app.js'));assert.equal(baselineSource('index.html',html),parentFile('index.html'));
    assert.equal(read('brand.css'),parentFile('brand.css'));
    assert.equal(read('intelligence-engine-v1.js'),parentFile('intelligence-engine-v1.js'));
});
