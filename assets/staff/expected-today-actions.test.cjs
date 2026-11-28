'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {chromium}=require('playwright');
const BASE='bf5c933733a9c3ee67a2b502d66cbbd37b859405';
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n');
const prior=file=>cp.execFileSync('git',['show',BASE+':'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6}).replace(/\r\n/g,'\n');
const app=read('app.js');
const start=app.indexOf('function startExpectedTodayListener() {');
const end=app.indexOf('// HF90C',start);
assert.ok(start>0&&end>start);
const renderer=app.slice(start,end);
const rows=[
    {id:'individual-fixture',clientName:'Individual Client',status:'Scheduled'},
    {id:'member-fixture',clientName:'Group Member',status:'Scheduled',isGroupBooking:true,groupId:'group-fixture',groupSize:4}
].map(r=>({...r,bookedService:'Restorative Hand Ritual and Nail Care',assignedTechName:'Fixture Technician',clientPhone:'0000000000',timeString:'09:30',bookedPrice:225}));
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});});
after(async()=>browser?.close());
async function surface(width,fn,{parent=false,mounted=true,wide=false}={}){
    const page=await browser.newPage({viewport:{width,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.abort());
    try{
        await page.setContent('<!doctype html><html><body></body></html>');
        await page.evaluate(html=>{
            const doc=new DOMParser().parseFromString(html,'text/html');
            const shell=document.createElement('main');shell.className='container';
            shell.append(doc.getElementById('subView_Checkin'));document.body.append(shell);
        },read('index.html'));
        await page.addStyleTag({content:parent?prior('styles.css'):read('styles.css')});
        await page.addStyleTag({content:read('brand.css')});
        await page.addStyleTag({content:'* { transition: none !important; animation: none !important; }'});
        const ui=parent?prior('no-show-ui.js'):read('no-show-ui.js');
        if(mounted){
            const css=ui.match(/css\.textContent = ('[^\n]+');/);
            assert.ok(css);await page.addStyleTag({content:JSON.parse('"'+css[1].slice(1,-1).replace(/"/g,'\\"')+'"')});
        }
        await page.evaluate(data=>{
            window.__rows=data;window.__clicks=[];window.__calls=[];window.__writes=0;
            Object.defineProperty(window.crypto,'randomUUID',{value:()=> 'synthetic-preview-request'});
            window.getLocalDateString=()=> '2026-09-26';window.todayDateStr='2026-09-26';
            window.isArchivedRecord=r=>!!r.archived;
            window.thFohIsTerminalAppointmentStatus=s=>['Cancelled','No Show','Closed'].includes(s);
            window.thFohIsReturnedAppointment=()=>false;
            window.expectedTodayListener=null;
            window.db={collection(name){if(name!=='Appointments')throw Error(name);return{where(){return this;},onSnapshot(fn){window.__render=()=>fn({empty:!window.__rows.length,forEach:f=>window.__rows.forEach(r=>f({id:r.id,data:()=>r}))});window.__render();return()=>{};}};}};
            window.checkInAppointment=id=>window.__clicks.push(['check-in',id]);
            window.editAppointment=id=>window.__clicks.push(['edit',id]);
            window.cancelAppointment=id=>window.__clicks.push(['cancel',id]);
            window.THURAYA_CONFIG={projectId:'thuraya-staging'};
            window.firebase={auth:()=>({currentUser:{uid:'synthetic'}}),app:()=>({functions:()=>({httpsCallable:()=>async input=>{
                window.__calls.push(input);
                if(input.command!=='preview'){window.__writes++;throw Error('No mutations allowed');}
                return{data:{...input,groupId:input.appointmentId==='member-fixture'?'group-fixture':'',fingerprint:'a'.repeat(64),eligibleCount:input.scope==='group-date'?4:1,skippedCount:0,members:[],scopeLabel:input.scope,groupSummary:'Synthetic preview'}};
            }})})};
        },rows);
        await page.addScriptTag({content:read('no-show-model.js')});
        await page.addScriptTag({content:ui});
        await page.addScriptTag({content:renderer+'\nstartExpectedTodayListener();'});
        if(wide)await page.locator('#subView_Checkin > .grid-2').evaluate(el=>{el.style.setProperty('grid-template-columns','1fr','important');});
        await fn(page);
        assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__writes),0);
    }finally{await page.close();}
}
async function screenshot(page,name){
    if(!process.env.EXPECTED_TODAY_SCREENSHOTS)return;
    fs.mkdirSync(process.env.EXPECTED_TODAY_SCREENSHOTS,{recursive:true});
    await page.locator('#expectedTodayList').screenshot({path:path.join(process.env.EXPECTED_TODAY_SCREENSHOTS,name+'.png')});
}

test('exact parent reproduces narrow, tall group No Show buttons at 662px',()=>surface(662,async page=>{
    const info=await page.locator('#expectedTodayList .th-noshow-action').evaluateAll(nodes=>nodes.map(el=>({text:el.textContent,width:el.clientWidth,height:el.clientHeight,lineHeight:getComputedStyle(el).lineHeight})));
    assert.equal(info.length,3);
    assert.ok(info[2].width<=80);assert.ok(info[2].height>60);
    console.log('PARENT_NO_SHOW_662',JSON.stringify(info));
    await screenshot(page,'parent-662');
},{parent:true}));

const target=id=>`#expectedTodayList > .ticket:has([data-checkin-appointment-id="${id}"])`;
function expectedHandlers(row){
    return [`checkInAppointment('${row.id}')`,`editAppointment('${row.id}')`,`cancelAppointment('${row.id}')`,
        `thNoShowRequest('${row.id}','member')`,...(row.groupId?[`thNoShowRequest('${row.id}','group-date')`]:[])];
}
async function layout(page,row){
    const card=page.locator(target(row.id));
    const labels=['Check-In','Edit','Cancel',...(row.groupId?['Member No-Show','Entire Group No-Show']:['No Show'])];
    assert.deepEqual(await card.locator('button').allTextContents(),labels);
    assert.deepEqual(await card.locator('button').evaluateAll(els=>els.map(el=>el.getAttribute('onclick'))),expectedHandlers(row));
    const info=await card.evaluate(el=>{
        const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const buttons=[...el.querySelectorAll('button')].map(button=>{
            const range=document.createRange();range.selectNodeContents(button);
            return{...rect(button),text:button.textContent,lines:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),style:{overflow:getComputedStyle(button).overflow,textOverflow:getComputedStyle(button).textOverflow,fontSize:getComputedStyle(button).fontSize}};
        });
        return{card:rect(el),details:rect(el.firstElementChild),actions:rect(el.lastElementChild),buttons,
            badge:el.querySelector('.group-badge')?rect(el.querySelector('.group-badge')):null,
            viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};
    });
    assert.ok(await card.isVisible());assert.ok(info.pageWidth<=info.viewport+1,'no horizontal page scroll');
    assert.ok(info.card.x>=0&&info.card.right<=info.viewport+1,'card fits viewport');
    assert.ok(info.details.width>=200,'details retain usable width');
    for(const b of info.buttons){
        assert.ok(b.height>=38&&b.height<=44,b.text+' compact, usable height');
        assert.equal(b.lines.length,1,b.text+' remains one readable line');
        assert.ok(parseFloat(b.style.fontSize)>=13);
        assert.notEqual(b.style.textOverflow,'ellipsis');
        assert.ok(b.lines[0].left>=b.x&&b.lines[0].right<=b.right,b.text+' unclipped text');
        assert.ok(b.lines[0].top>=b.y&&b.lines[0].bottom<=b.bottom,b.text+' vertical fit');
        assert.ok(b.x>=info.card.x&&b.right<=info.card.right&&b.bottom<=info.card.bottom,'button fits card');
    }
    const [check,edit,cancel,...danger]=info.buttons;
    assert.ok(check.bottom<=edit.y&&Math.abs(edit.y-cancel.y)<1,'Check-In then balanced Edit / Cancel');
    assert.ok(Math.abs(edit.width-cancel.width)<1&&edit.right<cancel.x);
    assert.ok(danger[0].y>=edit.bottom);
    for(const b of [check,...danger])assert.ok(Math.abs(b.width-info.actions.width)<1,'primary/danger span full action width');
    for(let i=1;i<danger.length;i++)assert.ok(danger[i].y>=danger[i-1].bottom);
    assert.ok(info.actions.height<190,'action area stays compact');
    if(info.details.bottom<=info.actions.y)assert.ok(info.card.height<370,'narrow card height remains balanced');
    else assert.ok(info.details.right<info.actions.x,'wide actions do not overlap details');
    if(info.badge){assert.ok(info.badge.x>=info.card.x&&info.badge.right<=info.card.right);assert.ok(info.badge.height<28,'group badge stays readable');}
    return info;
}

for(const width of [1280,768,662,390])for(const row of rows){
    test(`${width}px ${row.groupId?'group':'individual'} real Expected Today layout and handler targets`,()=>surface(width,async page=>{
        const info=await layout(page,row);
        if(width<=768)assert.ok(info.details.bottom<=info.actions.y,'narrow layout puts actions below details');
        await page.evaluate(()=>{window.thNoShowRequest=(id,scope)=>window.__clicks.push(['no-show',id,scope]);});
        for(const button of await page.locator(target(row.id)).locator('button').all())await button.click();
        assert.deepEqual(await page.evaluate(()=>window.__clicks),[['check-in',row.id],['edit',row.id],['cancel',row.id],['no-show',row.id,'member'],...(row.groupId?[['no-show',row.id,'group-date']]:[])]);
        assert.equal(await page.locator('#expectedTodayList > .ticket').count(),2);
        if(row.groupId)await screenshot(page,'actions-'+width);
    }));
}

test('wide cards retain a compact right-side action grid',()=>surface(1280,async page=>{
    for(const row of rows){const info=await layout(page,row);assert.ok(info.details.right<info.actions.x);assert.equal(Math.round(info.actions.width),216);}
    await screenshot(page,'actions-wide-card');
},{wide:true}));

test('late No Show dialog stylesheet cannot collapse Expected Today buttons',()=>surface(390,async page=>{
    for(const row of rows)await layout(page,row);
    await page.locator(target(rows[0].id)).getByRole('button',{name:'No Show',exact:true}).click();
    assert.ok(await page.locator('#thNoShowDialog').isVisible());
    await page.locator('#thNoShowClose').click();
    for(const row of rows)await layout(page,row);
},{mounted:false}));

test('real individual, member and entire-group requests retain exact preview scope and confirmation wording',()=>surface(662,async page=>{
    for(const [row,label,scope,title]of [[rows[0],'No Show','member','Mark No Show'],[rows[1],'Member No-Show','member','Mark Member No Show'],[rows[1],'Entire Group No-Show','group-date','Mark Entire Group No Show']]){
        await page.locator(target(row.id)).getByRole('button',{name:label,exact:true}).click();
        assert.equal(await page.locator('#thNoShowTitle').textContent(),title);
        assert.deepEqual(await page.evaluate(()=>window.__calls.at(-1)),{command:'preview',appointmentId:row.id,scope,projectId:'thuraya-staging'});
        assert.match(await page.locator('#thNoShowConfirm').textContent(),scope==='group-date'?/Confirm 4 No Shows/:/Confirm 1 No Show/);
        await page.locator('#thNoShowClose').click();
    }
    assert.equal(await page.evaluate(()=>window.__calls.length),3);
}));

test('snapshot rerender keeps button counts, compact rows and single click dispatch',()=>surface(662,async page=>{
    await page.evaluate(()=>{window.__render();window.__render();window.thNoShowRequest=(id,scope)=>window.__clicks.push([id,scope]);});
    assert.equal(await page.locator('#expectedTodayList button').count(),9);
    for(const row of rows)await layout(page,row);
    await page.locator(target(rows[1].id)).getByRole('button',{name:'Entire Group No-Show',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__clicks),[['member-fixture','group-date']]);
}));

test('group detection, missing group-id safeguard and invalid-id suppression match baseline',()=>surface(662,async page=>{
    const fixtures=[{id:'single'},{id:'group',groupId:'g'},{id:'partial',isGroupBooking:true},{id:"bad'id"},{id:'x',groupSize:4}];
    const current=await page.evaluate(data=>data.map(r=>window.ThurayaNoShow.buttons(r)),fixtures);
    await page.addScriptTag({content:prior('no-show-ui.js')});
    const parent=await page.evaluate(data=>data.map(r=>window.ThurayaNoShow.buttons(r)),fixtures);
    assert.deepEqual(current,parent.map(s=>s.replace('Mark Member No Show','Member No-Show').replace('Mark Entire Group No Show','Entire Group No-Show')));
}));

test('unrelated operational buttons and returned-to-FOH cards retain baseline computed styles',()=>surface(662,async page=>{
    await page.evaluate(()=>{
        const node=document.createElement('div');node.innerHTML='<div id="unrelated"><button class="btn btn-secondary th-noshow-action">No Show</button></div><section><div id="returned" class="ticket"><div><h4>Returned Client <span class="group-badge">Group 4</span></h4></div><div style="display:flex;flex-direction:column;width:96px"><button class="btn" onclick="editAppointment(\'returned\')">Review</button><button class="btn btn-secondary" onclick="cancelAppointment(\'returned\')">Cancel</button></div></div></section>';
        document.body.append(node);document.getElementById('expectedTodayList').append(node.querySelector('section'));
    });
    const sample=()=>page.locator('#unrelated button,#returned,#returned button,#returned .group-badge,#btnRegisterClient').evaluateAll(nodes=>nodes.map(el=>{const s=getComputedStyle(el);return[s.display,s.width,s.height,s.padding,s.color,s.backgroundColor,s.fontSize,s.whiteSpace,s.borderRadius];}));
    const current=await sample();
    await page.locator('style').first().evaluate((el,css)=>{el.textContent=css;},prior('styles.css'));
    assert.deepEqual(await sample(),current);
}));

test('protected JavaScript is byte-equivalent except the two visible button labels',()=>{
    const old=prior('no-show-ui.js');
    const line=old.split('\n').find(l=>l.includes('return `<button')&&l.includes('th-noshow-action'));
    assert.ok(line);
    const replacement=line.replace('Mark Member No Show','Member No-Show').replace('Mark Entire Group No Show','Entire Group No-Show');
    assert.equal(read('no-show-ui.js'),old.replace(line,replacement));
    for(const file of ['app.js','index.html','brand.css','no-show-model.js','no-show-source-parity.cjs','no-show-reporting.test.cjs','intelligence-engine-v1.js'])assert.equal(require('./scheduling-source-parity.cjs').baselineSource(file,read(file)),prior(file),file+' byte-equivalent outside fingerprint-reviewed scheduling integration');
    assert.ok(read('styles.css').startsWith(prior('styles.css')),'existing CSS is untouched');
});
