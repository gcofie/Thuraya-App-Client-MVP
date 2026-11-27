'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const read = file => fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n');
const app=read('app.js'), engine=read('intelligence-engine-v1.js'), html=read('index.html');
const intelligenceStyles=html.match(/<style id="intelligence54cStyles">([\s\S]*?)<\/style>/)[1];
const styles=read('styles.css')+'\n'+read('brand.css')+'\n'+intelligenceStyles;
const parent=cp.execFileSync('git',['show','098702a4b4c37d9aad25a7730781b16547904a18:app.js'],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6}).replace(/\r\n/g,'\n');
const markers=[
    '// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS',
    '// THURAYA PHASE 5.4C PATCH', '// THURAYA PHASE 5.4C REAL DATA INTELLIGENCE ENGINE',
    '// THURAYA PHASE 6 — PREDICTIVE INTELLIGENCE', '// THURAYA PHASE 6.1 — OVERVIEW EMBED + REFRESH BUTTON FIX',
    '// THURAYA PHASE 6.2 — PERSISTENT PREDICTIVE OVERVIEW', '// THURAYA PHASE 6.3 — CLEAN MODE',
    '// THURAYA PHASE 6.4 — AI ACTION LAYER', '// THURAYA PHASE 6.5 — ASSISTED ACTIONS',
    '// THURAYA PHASE 6.5B — ASSISTED ACTIONS NAVIGATION FIX', '// THURAYA PHASE 6.5C — ASSISTED ACTIONS POLISH'
];
function block(source,marker){const at=source.indexOf(marker),start=source.indexOf('(function () {',at),end=source.indexOf('\n})();',start);assert.ok(at>=0&&start>at&&end>start,marker);return source.slice(start,end+7);}
function scripts(source){
    const result=markers.map(marker=>block(source,marker));
    if(source.includes('// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD')) result.splice(1,0,block(source,'// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD'));
    const start=source.indexOf('window.thurayaPhase6LoadPredictive = async function () {',source.indexOf('THURAYA PHASE 6.3B'));
    const end=source.indexOf('// ============================================================================',start);assert.ok(start>0&&end>start);
    result.splice(result.length-4,0,source.slice(start,end));result.push(source===parent?cp.execFileSync('git',['show','098702a4b4c37d9aad25a7730781b16547904a18:intelligence-engine-v1.js'],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6}):engine);return result;
}
// Real initialization, timers, observers and action binders. Route mode also runs real navigation/modules.
function transport(){
    window.__reads=[];window.__errors=[];window.__writes=0;window.__actions=[];
    window.addEventListener('error',event=>window.__errors.push(event.message));
    window.addEventListener('unhandledrejection',event=>window.__errors.push(String(event.reason)));
    window.getLocalDateString=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    window.__jobs=[];
    window.allTechs=[];
    for(const [label,date,gross] of [['Daily','2025-06-18',100],['Weekly','2025-06-12',200],['Monthly','2025-06-01',300],['Custom','2025-05-20',400],['Lifetime','2001-01-01',9000],['Future','2025-07-01',8000]]){
        for(let i=0;i<3;i++) window.__jobs.push({id:label+i,sourceAppointmentId:label+i,status:'Closed',dateString:date,timeString:i===0?'10:00':'14:00',finalTotal:gross,taxTotal:0,assignedTechName:label+' Tech',clientName:label+' Client',clientPhone:label,serviceLineItems:[{menuItemId:label.toLowerCase()+'-canonical',name:label+' Service',lineTotal:gross,lineSubtotal:gross,taxAmount:0,priceMode:'inclusive',qty:1,durationAtBooking:30}]});
    }
    window.__apps=[{id:'Daily0',status:'Scheduled',dateString:'2025-06-18',finalTotal:100}];
    const mutation=()=>{window.__writes++;throw Error('No writes allowed');};
    const ref=(name,filters=[],ordered=false)=>({
        where:(field,op,value)=>ref(name,[...filters,{field,op,value}],ordered),orderBy:()=>ref(name,filters,true),limit:()=>ref(name,filters,ordered),
        onSnapshot(fn){ref(name,filters,ordered).get().then(fn);return()=>{};},
        doc:()=>({get:async()=>({exists:false,data:()=>({})}),set:mutation,update:mutation,delete:mutation}),add:mutation,set:mutation,update:mutation,delete:mutation,
        async get(){
            const ai=name==='Active_Jobs';const daily=new Error().stack.includes('getDocsForDate');
            window.__reads.push({name,ai,daily,filters,ordered});
            if(ai&&window.__hold)await window.__hold;
            if(ai&&window.__fail)throw Error('Synthetic AI read failure');
            const rows=(name==='Active_Jobs'?window.__jobs:name==='Appointments'?window.__apps:name==='Menu_Settings_V2'?[{id:'menu-service',name:'Fixture Service',serviceName:'Fixture Service',department:'Hand',ritualGroup:'Hand Therapies',category:'Hand Therapies',price:100,duration:30,status:'Active',isActive:true}]:[]).filter(r=>filters.every(f=>f.op==='=='?r[f.field]===f.value:true));
            const docs=rows.map(r=>({id:r.id,data:()=>({...r})}));return{size:docs.length,empty:!docs.length,docs,forEach(fn){docs.forEach(fn);}};
        }
    });
    window.db={collection:name=>ref(name),runTransaction:mutation,batch:mutation};
    window.ThurayaCommissionV2={call:async()=>({settings:[]}),refresh:async()=>({persons:[{}]})};
    window.switchModule=id=>{document.getElementById('intelligenceView').style.display=id==='intelligenceView'?'block':'none';};
    document.getElementById('intelligenceView').style.display='block';
}
async function setup(browser,{width=1280,old=false,timezoneId='UTC',routes=false,source=app}={}){
    const page=await browser.newPage({viewport:{width,height:1000},timezoneId});
    await page.route('**/*',route=>route.abort());
    await page.clock.install({time:new Date('2025-06-18T12:00:00Z')});
    await page.clock.pauseAt(new Date('2025-06-18T12:00:01Z'));
    const start=html.indexOf('<div id="intelligenceView"'),end=html.indexOf('<div id="clientsView"',start);assert.ok(start>0&&end>start);
    const codes=[`(${transport.toString()})();`,...scripts(old?parent:source)];
    if(routes){
        const baseStart=source.indexOf('window.switchModule = function(moduleId) {'),baseEnd=source.indexOf('\n}',baseStart)+2;
        const bootstrap=`document.getElementById('nav_intelligence')?.remove();const parsed=new DOMParser().parseFromString(${JSON.stringify(html)},'text/html');const dashboard=document.createElement('main');dashboard.id='appDashboard';dashboard.style.display='block';document.body.append(dashboard);for(const id of ['topNavMenu','clientIntelView','hrView','menuView','reportsView']){const el=parsed.getElementById(id).cloneNode(true);dashboard.append(el);if(el.classList.contains('app-module'))el.style.display='none';}document.body.prepend(document.getElementById('topNavMenu'));document.getElementById('nav_intelligence').checked=true;for(const id of ['tabIntelligence','tabClientIntel'])document.getElementById(id).style.display='block';window.currentRoles=['Manager'];window.currentUserRole='Manager';window.currentUserEmail='manager@example.test';window.todayDateStr=getLocalDateString();window.allClientsCache=[];window.__navigations=[];`;
        codes.splice(1,0,bootstrap,source.slice(baseStart,baseEnd)+`;const realSwitch=window.switchModule;window.switchModule=function(id){window.__navigations.push(id);return realSwitch(id);};`);
        const gci=block(source,'// THURAYA PHASE 5.5C CLIENT INTEL GROUP BOOKING READER');
        const tabStart=source.indexOf('window.cip_switchTab = function(tab, btn)'),tabEnd=source.indexOf('\n};',tabStart)+3;
        codes.splice(3,0,source.slice(tabStart,tabEnd));
        codes.splice(codes.findIndex(code=>code.includes('const P6_VERSION')),0,gci);
        const menuAt=source.indexOf('if (window.__TH_FINAL_CLEAN_MENU_PIPELINE_20260511__)'),menuStart=source.lastIndexOf('(function',menuAt),menuEnd=source.indexOf('\n})();',menuAt)+7;
        codes.splice(codes.length-1,0,source.slice(menuStart,menuEnd),read('reports-v2.js'),read('gift-card-model.js'),read('sales-promo-v1.js'));
        codes.splice(codes.length-1,0,'window.fetchLiveMenu(false);');
    }
    await page.setContent('<!doctype html><style>'+styles+'</style><style>body{margin:12px}.intel54c-kpi span,.intel54c-kpi strong{display:block}</style><input id="nav_intelligence" type="radio" checked>'+html.slice(start,end)+codes.map(code=>`<script>${code.replace(/<\/script/gi,'<\\/script')}</script>`).join(''));
    await page.clock.runFor(9000);
    assert.deepEqual(await page.evaluate(()=>window.__errors),[]);
    return page;
}

module.exports={setup,scripts,transport,block,read,app,html,styles,parent,chromium};
