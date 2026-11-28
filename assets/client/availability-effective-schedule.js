/* Schema selection only: delegates to the two existing scheduling authorities. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ThurayaEffectiveSchedule=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 function create({legacy,v2}){
  if(typeof legacy?.resolve!=='function'||typeof v2?.resolveEffective!=='function')throw Error('Existing scheduling authorities are unavailable.');
  function resolve({root=null,legacyRows=[],versions=[]},date,email){
   if(root?.schemaVersion!==2&&!versions.length)return legacy.resolve(legacyRows,date);
   const result=v2.resolveEffective({root,versions,legacy:legacyRows},date,email);
   // Before a valid V2 effective boundary, retain the certified legacy shift gaps.
   // The released V2 authority first validates its index and legacy precedence.
   if(root?.schemaVersion===2&&v2.calendarDate(date)<root.v2EffectiveFrom&&['WORKING','OFF_DAY'].includes(result.reason))return legacy.resolve(legacyRows,date);
   return result;
  }
  return Object.freeze({resolve});
 }
 return Object.freeze({create});
});
