'use strict';
(function(root){
 const EXPECTED=__ORDINARY_CONFIG_JSON__,CONFIG_SHA256='__ORDINARY_CONFIG_SHA256__';
 const PROJECT='thuraya-client-telling',NAMESPACE='thuraya-client-telling.ordinary-v1';
 const ENDPOINTS={publisher:'thurayaMenuPricing',quote:'thurayaPriceQuote',client:'thurayaClientBookVersioned',staff:'thurayaStaffBookVersioned',reviewed:'thurayaSubmitManagedBookingOperations',busy:'thurayaGetQualificationBusySlots',due:'thurayaPriceActivateDue'};
 const fail=code=>{throw Object.assign(Error(code),{code});};
 const copy=value=>JSON.parse(JSON.stringify(value));
 const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
 function admitted(config){
  if(JSON.stringify(config)!==EXPECTED)fail('EXACT_ORDINARY_CONFIGURATION_REQUIRED');
  if(config?.kind!=='TRACK_B_ORDINARY_PRODUCTION_BROWSER_V1'||config.schema!==1||config.enabled!==true||config.projectId!==PROJECT||config.scheduledWorkerEnabled!==false)fail('ORDINARY_STAGING_DISABLED');
  if(['window','idPools','fixturePaths','actors','qualification','scopeId'].some(k=>Object.hasOwn(config,k)))fail('QUALIFICATION_PROFILE_NOT_ORDINARY');
  if(config.firebase?.projectId!==PROJECT||config.firebase.authDomain!=='thuraya-client-telling.firebaseapp.com'||config.firebase.storageBucket!=='thuraya-client-telling.firebasestorage.app'||config.firebase.messagingSenderId!=='1061064260367')fail('EXACT_STAGING_FIREBASE_REQUIRED');
  if(!/^https:\/\/[a-f0-9]{24}--(?:thuraya-app|youbookingthuraya)\.netlify\.app$/.test(config.previewOrigin||'')||![config.previewOrigin,'https://thuraya-app.netlify.app','https://book.thurayanailbar.com','https://youbookingthuraya.netlify.app'].includes(root.location.origin))fail('EXACT_PRODUCTION_ORIGIN_REQUIRED');
  if(![config.sourceBaseSha256,config.frontendTemplateSha256,config.backendConfigSha256,config.generation].every(v=>/^[a-f0-9]{64}$/.test(v||''))||!/^\d{1,12}:\d{1,9}$/.test(config.engineVersion||''))fail('BOUND_ORDINARY_ASSEMBLY_REQUIRED');
  if(JSON.stringify(config.endpoints)!==JSON.stringify(ENDPOINTS))fail('EXACT_ORDINARY_ENDPOINTS_REQUIRED');
  if(!root.crypto?.getRandomValues||!root.crypto?.randomUUID||!root.crypto?.subtle||!root.navigator?.locks?.request||!root.localStorage||!root.sessionStorage)fail('DURABLE_ORDINARY_CAPABILITIES_REQUIRED');
  if(root.firebase?.apps?.length&&root.firebase.app().options.projectId!==PROJECT)fail('EXISTING_FIREBASE_PROJECT_FORBIDDEN');
  return config;
 }
 const config=freeze(copy(admitted(root.THURAYA_ORDINARY_STAGING_PUBLIC_CONFIG)));
 function requireReady(){return admitted(root.THURAYA_ORDINARY_STAGING_PUBLIC_CONFIG);}
 const uid=()=>root.firebase?.auth?.().currentUser?.uid||null;
 function requireSession(expected){requireReady();if(uid()!==expected)fail('ORDINARY_SESSION_CHANGED');}
 const digest=async value=>Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
 const random=bytes=>Array.from(root.crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 function allocate(kind){
  requireReady();if(!['bookingRequest','reviewRequest','reviewHistoryKey','catalogueRequest','serviceId','staffGroupId'].includes(kind))fail('UNKNOWN_ORDINARY_ID_KIND');
  if(kind!=='bookingRequest'&&!uid())fail('AUTHENTICATED_STAFF_SESSION_REQUIRED');
  if(kind==='bookingRequest'||kind==='reviewRequest')return random(32);
  if(kind==='reviewHistoryKey')return random(16);
  if(kind==='catalogueRequest')return root.crypto.randomUUID();
  if(kind==='serviceId')return 'service_'+root.crypto.randomUUID();
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return 'GRP-'+Array.from(root.crypto.getRandomValues(new Uint8Array(6)),b=>alphabet[b&31]).join('');
 }
 function reviewJournal(target,actor=uid()){
  requireReady();if(!actor||typeof target!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(target))fail('EXACT_REVIEW_SESSION_TARGET_REQUIRED');
  return 'thuraya.ordinary.review.'+NAMESPACE+'.'+actor+'.'+target;
 }
 const historyInFlight=new Map();
 function reviewHistoryKey(intent){
  const actor=uid(),requestKey=reviewJournal(intent?.targetAppointmentId,actor),key=requestKey.replace('.review.','.review-history.'),intentBytes=stable(intent);
  if(!['edit_individual','cancel_individual','edit_member','cancel_member','cancel_group'].includes(intent?.command))fail('EXACT_HISTORY_INTENT_REQUIRED');
  const inflight=historyInFlight.get(key);if(inflight){if(inflight.intentBytes!==intentBytes)fail('REVIEW_HISTORY_INTENT_CONFLICT');return inflight.promise;}
  const run=(async()=>{const intentSha256=await digest(JSON.parse(intentBytes));return root.navigator.locks.request(key,{mode:'exclusive'},async()=>{
   requireSession(actor);let bound,pending;try{bound=JSON.parse(root.localStorage.getItem(key)||'null');pending=JSON.parse(root.localStorage.getItem(requestKey)||'null');}catch{fail('REVIEW_HISTORY_JOURNAL_INVALID');}
   const allowed=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
   if(bound&&(bound.uid!==actor||!allowed(bound.key)))fail('REVIEW_HISTORY_INTENT_CONFLICT');
   let priorKey;
   if(pending){
    if(pending.uid!==actor||stable(pending.data?.reviewedBookingIntent)!==intentBytes)fail('REVIEW_HISTORY_INTENT_CONFLICT');
    const histories=(pending.data?.operations||[]).flatMap(op=>['reviewedBookingHistory','groupReviewHistory'].filter(field=>op.data?.[field]).map(field=>Object.keys(op.data[field]))),keys=[...new Set(histories.flat())];
    if(!histories.length||histories.some(keys=>keys.length!==1)||keys.length!==1||!allowed(keys[0])||bound&&bound.key!==keys[0])fail('REVIEW_HISTORY_PENDING_KEY_INVALID');priorKey=keys[0];
   }
   if(bound?.intentSha256===intentSha256)return bound.key;
   if(bound&&pending)fail('REVIEW_HISTORY_INTENT_CONFLICT');
   const id=priorKey||allocate('reviewHistoryKey');requireSession(actor);
   const bytes=JSON.stringify({uid:actor,intentSha256,key:id});root.localStorage.setItem(key,bytes);if(root.localStorage.getItem(key)!==bytes)fail('REVIEW_HISTORY_JOURNAL_UNCONFIRMED');return id;
  });})();
  const promise=run.finally(()=>{if(historyInFlight.get(key)?.promise===promise)historyInFlight.delete(key);});historyInFlight.set(key,{intentBytes,promise});return promise;
 }
 function initialQuickEditItemKey(item,index,targetAppointmentId,existingItems=[]){
  requireReady();if(!uid()||typeof targetAppointmentId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(targetAppointmentId)||!Array.isArray(existingItems))fail('EXACT_QUICK_EDIT_KEY_SCOPE_REQUIRED');
  const indices=Array.isArray(index)?[...index]:[index];if(!indices.length||indices.length>2||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>1000000))fail('STABLE_QUICK_EDIT_INDEX_REQUIRED');
  const keys=existingItems.map(row=>row?.key).filter(k=>k!==undefined&&k!==null&&k!=='');if(keys.some(k=>typeof k!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(k))||new Set(keys).size!==keys.length)fail('UNIQUE_QUICK_EDIT_KEYS_REQUIRED');
  if(item?.key!==undefined&&item.key!==null&&item.key!==''){if(typeof item.key!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(item.key)||keys.includes(item.key))fail('UNIQUE_QUICK_EDIT_KEYS_REQUIRED');return item.key;}
  const canonical=item?.menuItemId||item?.id||item?.serviceId||(item?.manual===true?'existing':null);if(typeof canonical!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(canonical))fail('CANONICAL_QUICK_EDIT_MENU_REQUIRED');
  const candidate=()=> 'qev4_production_'+targetAppointmentId.length+'_'+targetAppointmentId+'_'+canonical.length+'_'+canonical+'_i'+indices.length+'_'+indices.join('_');let key=candidate(),attempts=0;
  while(keys.includes(key)){if(++attempts>keys.length)fail('UNIQUE_QUICK_EDIT_KEYS_REQUIRED');indices[indices.length-1]++;if(indices.at(-1)>1000000)fail('STABLE_QUICK_EDIT_INDEX_REQUIRED');key=candidate();}return key;
 }
 async function call(name,payload){
  requireReady();if(!Object.values(ENDPOINTS).includes(name))fail('ORDINARY_ENDPOINT_NOT_ALLOWED');
  const actor=uid(),data=copy(payload);
  const customer=name===ENDPOINTS.client||name===ENDPOINTS.quote&&data.channel==='client';
  if(!customer&&!actor)fail('AUTHENTICATED_STAFF_SESSION_REQUIRED');
  if(name===ENDPOINTS.due&&!['activateDue','activateFirstDraft'].includes(data.action))fail('PROTECTED_MANUAL_WORKER_ACTION_REQUIRED');
  const app=root.firebase.app();if(app.options.projectId!==PROJECT)fail('EXACT_STAGING_FIREBASE_REQUIRED');
  const response=await app.functions('us-central1').httpsCallable(name)(data);
  requireSession(actor);return response.data;
 }
 root.THURAYA_CONFIG=config.firebase;root.THURAYA_ENV='production';root.THURAYA_TRUSTED_BOOKING=true;root.THURAYA_ORDINARY_CATALOGUE=true;
 Object.defineProperty(root,'ThurayaOrdinaryStaging',{value:Object.freeze({config,configurationSha256:CONFIG_SHA256,namespace:NAMESPACE,requireReady,requireSession,sessionUid:uid,call,allocate,reviewJournal,reviewHistoryKey,initialQuickEditItemKey,stable,digest}),writable:false,configurable:false});
})(window);
