'use strict';
// Extracted from HF89A; caller supplies the established financial amount parser.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ThurayaMenuV2Normalizer=api;})(typeof window!=='undefined'?window:globalThis,function(){
  function normStatus(s){
    const raw = String((s && (s.status ?? s.Status)) || (s && s.isActive === false ? 'inactive' : 'active')).trim().toLowerCase();
    if (['inactive','disabled','archived','deleted','false','no'].includes(raw)) return 'inactive';
    return 'active';
  }
  function first(raw, keys, fb=''){
    raw = raw || {};
    for (const k of keys){ if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') return raw[k]; }
    return fb;
  }
  function normalize(raw, i, amount){
    raw = raw || {};
    const serviceName = String(first(raw, ['serviceName','Service Name','name','Name','displayName','Display Name'], 'Unnamed Service')).trim() || 'Unnamed Service';
    const departmentRaw = String(first(raw, ['department','Department','appliesTo','Applies To'], 'Hand')).trim();
    const department = /foot/i.test(departmentRaw) ? 'Foot' : /both/i.test(departmentRaw) ? 'Both' : 'Hand';
    const status = normStatus(raw);
    return {
      ...raw,
      id: String(first(raw, ['id','ID'], raw.id || raw.docId || `${department}_${serviceName}_${i}`)),
      serviceName,
      name: serviceName,
      department,
      appliesTo: raw.appliesTo || department,
      ritualGroup: String(first(raw, ['ritualGroup','Ritual Group','mainCategory','Main Category'], 'Uncategorized Rituals')).trim() || 'Uncategorized Rituals',
      category: String(first(raw, ['category','Category','subCategory','Sub Category'], 'General')).trim() || 'General',
      serviceType: String(first(raw, ['serviceType','Service Type'], '')).trim(),
      serviceDescription: first(raw, ['serviceDescription','Service Description','description','Description','desc'], ''),
      description: first(raw, ['serviceDescription','Service Description','description','Description','desc'], ''),
      price: amount(Object.hasOwn(raw, 'price') ? raw.price : raw.Price),
      duration: parseInt(first(raw, ['duration','Duration'], 0), 10) || 0,
      inputType: String(first(raw, ['inputType','Input Type','selection','Selection'], 'radio')).trim() || 'radio',
      pricingModel: String(first(raw, ['pricingModel','Pricing Model','pricingType','Pricing Type'], '')).trim(),
      sortOrder: parseInt(first(raw, ['sortOrder','Sort Order','priority','Priority'], 9999), 10) || 9999,
      status,
      isActive: status === 'active' && raw.isActive !== false,
      _hf89aSource: 'Menu_Settings_V2_SHARED_CONSUMER'
    };
  }

return Object.freeze({normalize});
});
