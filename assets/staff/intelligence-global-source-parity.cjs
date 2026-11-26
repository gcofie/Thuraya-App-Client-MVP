'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const PARENT='1431993dc74839b2fcfe121f0792b99be4870ab2';
const ranges=[
 ['// PHASE 5.3D – ALERTS / ADVANCED INTELLIGENCE','// END THURAYA PHASE 5.5C CLIENT INTEL GROUP BOOKING READER','5a4dbb2367eb6d44e75fbb769fe40fbd424b625903b07a43547fc3351ebdeb76'],
 ['// THURAYA PHASE 6 — PREDICTIVE INTELLIGENCE','// END THURAYA PHASE 6.4 — AI ACTION LAYER','b12f44f7229bd46227d11d09dae5950f48c935fbbdbdf1f8556f77bb0e072221']
];
const normalize=s=>s.replace(/\r\n/g,'\n');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function strip(text,verify){
 for(const [start,end,expected] of ranges){const a=text.indexOf(start),b=text.indexOf(end,a)+end.length;assert.ok(a>=0&&b>a);if(verify)assert.equal(hash(text.slice(a,b)),expected,'Exact reviewed Intelligence content');text=text.slice(0,a)+'<reviewed Intelligence>'+text.slice(b);}
 return text;
}
function check(){
 const current=normalize(fs.readFileSync(__dirname+'/app.js','utf8'));
 const parent=normalize(cp.execFileSync('git',['show',PARENT+':app.js'],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6}));
 assert.equal(strip(current,true),strip(parent,false),'Every byte outside reviewed Intelligence ranges must match exact parent');
 assert.equal(hash(normalize(fs.readFileSync(__dirname+'/intelligence-engine-v1.js','utf8'))),'0933a390aa6ac9b0289e448305a5bc555ef7b2a04cd7c097d18cbb0b7b2ea152','Exact reviewed period-aware engine');
 for(const file of ['firebase-config.js','index.html','sales-promo-v1.js','reports-v2.js'])assert.ok(fs.readFileSync(__dirname+'/'+file).toString().replace(/\r\n/g,'\n')===normalize(cp.execFileSync('git',['show',PARENT+':'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:20e6})),file+' unchanged');
}
module.exports={check};
