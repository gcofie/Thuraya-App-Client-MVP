/* THURAYA Staff App — Final Clean Menu_Settings_V2 CSV Importer
   Final schema only: Department → Ritual Group → Category → Service.
   Saves new services only as controlled private drafts. */
(function(){
  'use strict';

  const COLLECTION = 'Menu_Settings_V2';
  const BUTTON_ID = 'thImportCleanV2CsvBtn';
  const INPUT_ID = 'thImportCleanV2CsvInput';
  const STATUS_ID = 'thImportCleanV2CsvStatus';

  const HAND_ORDER = ['Hand Therapies','Finishing Indulgences','Nail Architecture','Polish & Finish','The Pleiades Studio','Editorial Nail Art','Couture Nail Art','Embellishment Drawers'];
  const FOOT_ORDER = ['Foundation Rituals','Urban Express Rituals','The Medi-Cleanse Series','Finishing Indulgences','Polish & Finish','Editorial Nail Art'];
  const CAT = {
    'Hand Therapies':['Core Hand Rituals','Hand Therapies'],
    'Finishing Indulgences':['Finishing Indulgences'],
    'Nail Architecture':['Acrylic','Sculpt Acrylic','Gel-X','BIAB','DuraGel','Nail Repairs & Stick-ons'],
    'Polish & Finish':['Polish & Finish'],
    'The Pleiades Studio':['Editorial Nail Art','Couture Nail Art','Embellishment Drawers'],
    'Foundation Rituals':['Foundation Rituals'],
    'Urban Express Rituals':['Urban Express Rituals'],
    'The Medi-Cleanse Series':['The Medi-Cleanse Series'],
    'Editorial Nail Art':['Editorial Nail Art']
  };

  function normKey(k){ return String(k || '').trim().toLowerCase().replace(/\ufeff/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }
  function get(row, aliases){ for (const a of aliases){ const key = normKey(a); if (Object.prototype.hasOwnProperty.call(row, key)) return String(row[key] ?? '').trim(); } return ''; }
  function slug(text){ return String(text || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 110) || 'service'; }
  function num(value, fallback=0){ const n = Number(String(value || '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : fallback; }
  function department(value){ const raw = String(value || 'Hand').toLowerCase(); return raw.includes('foot') ? 'Foot' : 'Hand'; }
  function inputType(value){ const raw = String(value || '').toLowerCase(); if (/(counter|quantity|qty|per\s*nail|per\s*unit|unit)/.test(raw)) return 'counter'; if (/(checkbox|addon|add\s*on|upgrade|multi|multiple|finish|repair)/.test(raw)) return 'checkbox'; return 'radio'; }
  function status(value){ const raw = String(value || 'active').toLowerCase(); if (/(inactive|disabled|off|false|no|0)/.test(raw)) return 'inactive'; return 'active'; }
  function loose(v){ return String(v||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
  function order(arr, name){ const i = arr.findIndex(x => loose(x) === loose(name)); return i >= 0 ? (i+1)*100 : 999; }
  function infer(row, dept){
    let ritualGroup = get(row, ['Ritual Group','RitualGroup','Group','Main Category','MainCategory']) || '';
    let category = get(row, ['Category','Sub Category','SubCategory','Sub Menu','SubMenu']) || '';
    const serviceName = get(row, ['Service Name','serviceName','Name']);
    const text = loose([serviceName, ritualGroup, category, get(row, ['Service Description','Description'])].join(' '));
    if (dept === 'Foot') {
      if (/foundation|silk skin|refinement|rituel jeunesse/.test(text)) ritualGroup = 'Foundation Rituals';
      else if (/urban|rapid reboot|essential foot reset/.test(text)) ritualGroup = 'Urban Express Rituals';
      else if (/medi cleanse|heel|callus/.test(text)) ritualGroup = 'The Medi-Cleanse Series';
      else if (/finishing|paraffin|hot stone/.test(text)) ritualGroup = 'Finishing Indulgences';
      else if (/polish|lacquer|gel couture|french|chrome|ombre|ombré/.test(text)) ritualGroup = 'Polish & Finish';
      else if (/art|atelier|custom/.test(text)) ritualGroup = 'Editorial Nail Art';
      ritualGroup = ritualGroup || 'Foundation Rituals';
    } else {
      if (/youthful|silken|precision groom|hand therap/.test(text)) ritualGroup = 'Hand Therapies';
      else if (/finishing|lush arm|paraffin|hot stone/.test(text)) ritualGroup = 'Finishing Indulgences';
      else if (/acrylic|gel x|gel-x|biab|duragel|sculpt|repair|stick/.test(text)) ritualGroup = 'Nail Architecture';
      else if (/polish|french|chrome|ombre|manicure/.test(text)) ritualGroup = 'Polish & Finish';
      else if (/art|couture|embellish|crystal|stone|pearl|custom/.test(text)) ritualGroup = 'The Pleiades Studio';
      ritualGroup = ritualGroup || 'Hand Therapies';
    }
    if (!category || loose(category) === loose(ritualGroup)) category = (CAT[ritualGroup] || [ritualGroup])[0];
    return {ritualGroup, category};
  }
  function parseCsv(text){
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++){
      const ch = text[i], next = text[i + 1];
      if (quoted){ if (ch === '"' && next === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
      else { if (ch === '"') quoted = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch; }
    }
    row.push(cell); rows.push(row);
    const nonEmpty = rows.filter(r => r.some(c => String(c || '').trim() !== ''));
    if (!nonEmpty.length) return [];
    const headers = nonEmpty[0].map(normKey);
    return nonEmpty.slice(1).map(r => { const obj = {}; headers.forEach((h, idx) => { if (h) obj[h] = r[idx] ?? ''; }); return obj; });
  }
  function payload(row, index){
    const serviceName = get(row, ['Service Name','serviceName','Name']); if (!serviceName) return null;
    const dept = department(get(row, ['Department']));
    const ic = infer(row, dept);
    const it = inputType(get(row, ['Input Type','InputType','Selection','Control']));
    const baseOrder = dept === 'Foot' ? order(FOOT_ORDER, ic.ritualGroup) : order(HAND_ORDER, ic.ritualGroup);
    return {
      department: dept,
      ritualGroup: ic.ritualGroup,
      ritualGroupDescription: get(row, ['Ritual Group Description','RitualGroupDescription','Group Description','Main Category Description']) || '',
      category: ic.category,
      categoryDescription: get(row, ['Category Description','Sub Category Description','SubCategoryDescription']) || '',
      serviceName,
      serviceDescription: get(row, ['Service Description','serviceDescription','Description']),
      price: num(get(row, ['Price']), 0),
      duration: Math.max(0, parseInt(num(get(row, ['Duration','Duration Mins','Minutes','Mins']), 0), 10) || 0),
      inputType: it,
      pricingModel: it === 'counter' ? 'per_nail' : 'fixed',
      sortOrder: parseInt(num(get(row, ['Sort Order','SortOrder','Priority','Order']), baseOrder + index + 1), 10) || (baseOrder + index + 1),
      status: status(get(row, ['Status','Active','Is Active','isActive'])),
      isActive: status(get(row, ['Status','Active','Is Active','isActive'])) === 'active',
      schemaVersion: 'v2_final_clean_20260511',
      updatedAt: null,
      updatedBy: window.currentUserEmail || 'final-clean-csv-import'
    };
  }
  async function importFile(file){
    const api=window.ThurayaCatalogueMetadata;
    if(!api){alert('Controlled catalogue drafting is unavailable.');return;}
    if(!file)return;
    const btn=document.getElementById(BUTTON_ID),statusEl=document.getElementById(STATUS_ID);
    if(btn){btn.disabled=true;btn.innerText='VALIDATING CSV...';}
    try{
      const rows=parseCsv(await file.text());
      if(!rows.length||rows.length>20)throw Error('Provide between 1 and 20 explicitly priced draft rows.');
      const snap=await api.firstWorkspace(),seen=new Set();
      const planned=rows.map((row,index)=>{
        const price=get(row,['Price']),duration=get(row,['Duration','Duration Mins','Minutes','Mins']);
        const dept=get(row,['Department']),group=get(row,['Ritual Group','RitualGroup','Main Category']),
          category=get(row,['Category','Sub Category','SubCategory']),control=get(row,['Input Type','InputType','Selection','Control']);
        if(!/^(?:Hand|Foot|Both)$/i.test(dept)||!group||!category||!['radio','checkbox','counter'].includes(control.toLowerCase())||
           !/^\d+(?:\.\d{1,2})?$/.test(price)||Number(price)<=0||
           !/^[1-9]\d*$/.test(duration)||!Number.isSafeInteger(Number(duration)))throw Error('Incomplete or invalid catalogue values on row '+(index+2)+'.');
        const parsed=payload(row,index);
        if(!parsed||!parsed.serviceDescription)throw Error('Service name and description required on row '+(index+2)+'.');
        parsed.department=dept[0].toUpperCase()+dept.slice(1).toLowerCase();
        parsed.ritualGroup=group;parsed.category=category;
        const id=[parsed.department,group,category,parsed.serviceName].map(slug).join('_');
        if(!id||id.length>120||seen.has(id))throw Error('Duplicate or invalid service identity on row '+(index+2)+'.');
        seen.add(id);
        if(snap.catalogue.some(r=>r.id===id||(String(r.serviceName).toLowerCase()===parsed.serviceName.toLowerCase()&&r.department===parsed.department)))
          throw Error('Existing service on row '+(index+2)+'. Use the controlled price workspace for price changes or edit its metadata.');
        const {status,isActive,schemaVersion,updatedAt,updatedBy,...service}=parsed;
        service.serviceType=get(row,['Service Type','ServiceType'])||'';
        service.serviceTypeDescription=get(row,['Service Type Description','ServiceTypeDescription'])||'';
        return {serviceId:id,expectedVersion:0,expectedFingerprint:snap.sourceFingerprint,service};
      });
      if(!window.confirm('Save '+planned.length+' private catalogue drafts? None becomes bookable.'))return;
      let saved=0;
      for(const input of planned){
        await api.firstOperation('saveFirstDraft',input);
        saved++;
        if(statusEl)statusEl.textContent=saved+' of '+planned.length+' private drafts saved.';
      }
      alert(saved+' private drafts saved. Approve and publish each service separately.');
    } catch(e){ console.error('Final clean CSV import failed:', e); if (statusEl) statusEl.textContent = 'Import failed: ' + e.message; alert('CSV import failed: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.innerText = 'IMPORT FINAL CLEAN CSV'; } const input = document.getElementById(INPUT_ID); if (input) input.value = ''; }
  }
  function mount(){
    if (document.getElementById(BUTTON_ID)) return;
    const menuView = document.getElementById('menuSettingsView'); if (!menuView) return;
    const anchor = document.getElementById('seedMenuBtnContainer') || menuView;
    const btn = document.createElement('button'); btn.id = BUTTON_ID; btn.type = 'button'; btn.className = 'btn btn-secondary'; btn.style.width = 'auto'; btn.innerText = 'IMPORT FINAL CLEAN CSV';
    const input = document.createElement('input'); input.id = INPUT_ID; input.type = 'file'; input.accept = '.csv,text/csv'; input.style.display = 'none';
    const note = document.createElement('span'); note.id = STATUS_ID; note.style.cssText = 'display:inline-block;margin-left:10px;color:#777;font-size:0.82rem;';
    btn.addEventListener('click', function(){ input.click(); }); input.addEventListener('change', function(){ importFile(this.files && this.files[0]); });
    anchor.appendChild(btn); anchor.appendChild(input); anchor.appendChild(note);
  }
  document.addEventListener('DOMContentLoaded', function(){ mount(); setInterval(mount, 1500); });
})();
