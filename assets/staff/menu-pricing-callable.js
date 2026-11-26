'use strict';
(function(root){
 const core=root.ThurayaMenuPricing,copy=x=>JSON.parse(JSON.stringify(x));
 function createProvider({call,workerCall,actor,onPublishedChange}={}){
  if(typeof call!=='function'||!actor?.uid)throw Error('AUTHENTICATED_CALLABLE_REQUIRED');
  let state=null,stopped=false;const view=()=>{if(!state)throw Error('PERSISTENT_WORKSPACE_NOT_LOADED');return copy(state);};
  const local=core.createManager({store:{snapshot:view,transaction:()=>{throw Error('SERVER_TRANSACTION_REQUIRED');}},authorize:async()=>false});
  async function invoke(action,args,worker=false){if(stopped)throw Error('STAFF_SESSION_ENDED');const invoke=worker?workerCall:call;if(typeof invoke!=='function')throw Error('PROTECTED_MANUAL_WORKER_UNAVAILABLE');const response=await invoke({action,...(args===undefined?{}:{args})});if(stopped)throw Error('STAFF_SESSION_ENDED');const data=response?.data||response;if(!data?.snapshot?.catalogue)throw Error('INVALID_PRICING_SERVER_RESPONSE');state=copy(data.snapshot);return data.result;}
  const manager={snapshot:view,preview:local.preview,quote:local.quote,revalidate:local.revalidate,refresh:()=>invoke('workspace'),validateQuote:quote=>invoke('validateQuote',{quote}),draft:(_,args)=>invoke('draft',args),approve:(_,draftId)=>invoke('approve',{draftId}),publish:(_,draftId,options)=>invoke('publish',{draftId,options}),rollbackDraft:(_,args)=>invoke('rollbackDraft',args),activateDue:()=>invoke('activateDue',undefined,true)};
  return{mode:'persistent',actor,manager,getCatalogue:()=>view().catalogue,beforeBooking:()=>manager.refresh(),onPublishedChange:s=>onPublishedChange?.(s),connect:async()=>{await manager.refresh();return true;},stop:()=>{stopped=true;state=null;}};
 }
 function firebaseProvider(user){const ordinary=root.ThurayaOrdinaryStaging;if(!ordinary||!user?.uid)throw Error('EXISTING_FIREBASE_CALLABLE_UNAVAILABLE');ordinary.requireSession(user.uid);const boundCall=(name,data)=>{ordinary.requireSession(user.uid);return ordinary.call(name,data);};return createProvider({call:data=>boundCall(ordinary.config.endpoints.publisher,data),workerCall:data=>boundCall(ordinary.config.endpoints.due,data),actor:{uid:user.uid},onPublishedChange:s=>{ordinary.requireSession(user.uid);const existing=root.thurayaGetMenuV2Services?.({activeOnly:false})||root.allMenuServicesCache||[];root.allMenuServicesCache=[...new Map([...existing,...s.catalogue].map(row=>[row.id,row])).values()];root.document.dispatchEvent(new Event('thuraya:menu-v2-updated'));}});}
 root.ThurayaMenuPricingTransport=Object.freeze({createProvider,firebaseProvider});
})(typeof window!=='undefined'?window:globalThis);
