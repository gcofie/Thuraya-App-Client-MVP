'use strict';

// Mechanically retained legacy menu projection from Staff App main 64e5968.
// Used only by the unchanged legacy evaluator; target revenue never reads menu prices.
function normalizeLegacyMenu(records) {
    const HAND_ORDER = ['Hand Therapies','Finishing Indulgences','Nail Architecture','Polish & Finish','The Pleiades Studio','Editorial Nail Art','Couture Nail Art','Embellishment Drawers'];
    const FOOT_ORDER = ['Foundation Rituals','Urban Express Rituals','The Medi-Cleanse Series','Finishing Indulgences','Polish & Finish','Editorial Nail Art'];
    const HAND_CATEGORY_ORDER = {
        'Hand Therapies':['Core Hand Rituals','Hand Therapies'],
        'Finishing Indulgences':['Finishing Indulgences'],
        'Nail Architecture':['Acrylic','Sculpt Acrylic','Gel-X','Gel X','BIAB','DuraGel','Nail Repairs & Stick-ons','Repairs'],
        'Polish & Finish':['Polish & Finish'],
        'The Pleiades Studio':['Editorial Nail Art','Couture Nail Art','Embellishment Drawers'],
        'Editorial Nail Art':['Editorial Nail Art'],
        'Couture Nail Art':['Couture Nail Art'],
        'Embellishment Drawers':['Embellishment Drawers']
    };
    const FOOT_CATEGORY_ORDER = {
        'Foundation Rituals':['Foundation Rituals'],
        'Urban Express Rituals':['Urban Express Rituals'],
        'The Medi-Cleanse Series':['The Medi-Cleanse Series'],
        'Finishing Indulgences':['Finishing Indulgences'],
        'Polish & Finish':['Polish & Finish'],
        'Editorial Nail Art':['Editorial Nail Art']
    };
    const RITUAL_DESC = {
        Hand:{
            'Hand Therapies':'The ritual-led hand care suite: restorative, corrective, and aesthetic hand therapies designed to improve skin condition, nail health, and overall hand appearance through structured, intentional care.',
            'Finishing Indulgences':'Targeted enhancements designed to extend the benefits of your hand ritual.',
            'Nail Architecture':'Structure, strength, and shape services that prepare the nail for aesthetic refinement.',
            'Polish & Finish':'Enhancement finishes applied after nail structure or grooming to elevate the final aesthetic.',
            'The Pleiades Studio':'Advanced nail artistry and embellishment for expressive, editorial, and couture-level finishes.',
            'Editorial Nail Art':'Refined artistic detailing that enhances the nail without overwhelming it.',
            'Couture Nail Art':'Highly detailed, custom-designed nail creations incorporating advanced techniques and layered artistry.',
            'Embellishment Drawers':'Dimensional and decorative embellishments that add texture, sparkle, and couture detail.'
        },
        Foot:{
            'Foundation Rituals':'Bare, clean, essential care.',
            'Urban Express Rituals':'Dry, efficient, precision care.',
            'The Medi-Cleanse Series':'Targeted treatment and repair.',
            'Finishing Indulgences':'Luxury add-on rituals available as enhancements to any pedicure ritual.',
            'Polish & Finish':'Finishing options that elevate the final aesthetic after a foot ritual.',
            'Editorial Nail Art':'Atelier customisation nail art available following consultation.'
        }
    };
    const CATEGORY_DESC = {
        'Core Hand Rituals':'Hand therapies focused on restoration, grooming, and visible refinement.',
        'Hand Therapies':'Hand therapies focused on restoration, grooming, and visible refinement.',
        'Finishing Indulgences':'Luxury add-on rituals available as enhancements.',
        'Acrylic':'Durable acrylic enhancement system designed to build strength, length, and defined shape.',
        'Sculpt Acrylic':'Precision-built sculpting technique for seamless, natural-looking extension with refined structure.',
        'Gel-X':'Flexible and natural-looking extension system offering strength with a lighter, adaptable finish.',
        'Gel X':'Flexible and natural-looking extension system offering strength with a lighter, adaptable finish.',
        'BIAB':'Builder gel system focused on strength, overlays, and natural nail reinforcement.',
        'DuraGel':'Durable gel system for long-lasting structure, strength, and clean finish.',
        'Nail Repairs & Stick-ons':'Corrective and temporary enhancement solutions for damaged nails or quick aesthetic alternatives.',
        'Polish & Finish':'Finishing options that elevate the final aesthetic.',
        'Editorial Nail Art':'Artistic and consultation-led nail art.',
        'Couture Nail Art':'Custom-designed nail creations with advanced techniques and layered artistry.',
        'Embellishment Drawers':'Dimensional and decorative embellishments that add texture, sparkle, and couture detail.',
        'Foundation Rituals':'Bare, clean, essential foot care rituals.',
        'Urban Express Rituals':'Dry, efficient, precision-care foot rituals.',
        'The Medi-Cleanse Series':'Targeted treatment and repair foot rituals.'
    };

    function q(id){ return document.getElementById(id); }
    function esc(v){
        if (typeof _thEscapeHtml === 'function') return _thEscapeHtml(v);
        return String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
    }
    function attr(v){
        if (typeof _thEscapeJsAttr === 'function') return _thEscapeJsAttr(v);
        return String(v ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
    }
    function loose(v){
        if (typeof _thLooseKey === 'function') return _thLooseKey(v);
        return String(v||'').trim().toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
    }
    function slug(v){ return loose(v).replace(/\s+/g,'_').slice(0,100) || 'item'; }
    function num(v, fb=9999){ const n=Number(String(v??'').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n) ? n : fb; }
    function status(v){ const t=String(v||'active').toLowerCase(); if (t.includes('delete')) return 'deleted'; if (t.includes('inactive')||t==='off'||t==='disabled') return 'inactive'; return 'active'; }
    function dept(v){ const t=String(v||'').toLowerCase(); return t.includes('foot') ? 'Foot' : 'Hand'; }
    function inputType(v){ const t=String(v||'radio').toLowerCase(); if (/counter|qty|quantity|per[_\s-]*nail|unit/.test(t)) return 'counter'; if (/check|add|multi|finish|repair|optional/.test(t)) return 'checkbox'; return 'radio'; }
    function priceModel(v, it){ const t=String(v||'').toLowerCase(); if (t.includes('consult')) return 'consultation'; if (it==='counter'||t.includes('unit')||t.includes('nail')) return 'per_nail'; return 'fixed'; }
    function orderIndex(arr, name){ const k=loose(name); const i=arr.findIndex(x => loose(x)===k); return i >= 0 ? (i+1)*1000 : 999000; }
    function ritualOrder(department, ritual){ return orderIndex(department==='Foot' ? FOOT_ORDER : HAND_ORDER, ritual); }
    function categoryOrder(department, ritual, category){
        const map = department==='Foot' ? FOOT_CATEGORY_ORDER : HAND_CATEGORY_ORDER;
        const arr = map[ritual] || [];
        return orderIndex(arr, category);
    }
    function orderField(value, fallback){
        const raw = String(value ?? '').trim();
        if (!raw) return fallback;
        const n = num(raw, fallback);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }
    function serviceName(raw){ return String(raw.serviceName || raw.name || raw.displayName || '').trim(); }

    function inferRitualAndCategory(raw, department){
        const name = serviceName(raw);
        let ritual = String(raw.ritualGroup || '').trim();
        let category = String(raw.category || '').trim();
        const hasStoredRitual = !!ritual;
        const hasStoredCategory = !!category;
        if (hasStoredRitual && hasStoredCategory) return {ritualGroup: ritual, category};
        const k = loose([name, raw.serviceDescription, raw.description, raw.desc, ritual, category, raw.serviceType].join(' '));

        if (department === 'Foot') {
            if (/foundation|silk skin|refinement|rituel jeunesse/.test(k)) { ritual='Foundation Rituals'; category=category||'Foundation Rituals'; }
            else if (/urban|rapid reboot|essential foot reset/.test(k)) { ritual='Urban Express Rituals'; category=category||'Urban Express Rituals'; }
            else if (/medi cleanse|heel|callus|corrective/.test(k)) { ritual='The Medi-Cleanse Series'; category=category||'The Medi-Cleanse Series'; }
            else if (/finishing|paraffin|hot stone/.test(k)) { ritual='Finishing Indulgences'; category=category||'Finishing Indulgences'; }
            else if (/polish|lacquer|gel couture|french|chrome|ombre|ombré/.test(k)) { ritual='Polish & Finish'; category=category||'Polish & Finish'; }
            else if (/art|atelier|custom/.test(k)) { ritual='Editorial Nail Art'; category=category||'Editorial Nail Art'; }
            else { ritual = ritual || 'Foundation Rituals'; category = category || ritual; }
        } else {
            if (/youthful|silken|precision groom|hand therap|hand renewal|hand balance/.test(k)) { ritual='Hand Therapies'; category=category||'Core Hand Rituals'; }
            else if (/finishing|lush arm|paraffin|hot stone arm/.test(k)) { ritual='Finishing Indulgences'; category=category||'Finishing Indulgences'; }
            else if (/acrylic|gel\s*x|gel-x|biab|duragel|sculpt|repair|stick/.test(k)) { ritual='Nail Architecture';
                if (!category || loose(category)===loose(ritual)) {
                    if (/sculpt/.test(k)) category='Sculpt Acrylic'; else if (/gel\s*x|gel-x/.test(k)) category='Gel-X'; else if (/biab/.test(k)) category='BIAB'; else if (/duragel|dura gel/.test(k)) category='DuraGel'; else if (/repair|stick/.test(k)) category='Nail Repairs & Stick-ons'; else category='Acrylic';
                }
            }
            else if (/polish|french|chrome|ombre|ombré|manicure/.test(k)) { ritual='Polish & Finish'; category=category||'Polish & Finish'; }
            else if (/couture/.test(k)) { ritual='The Pleiades Studio'; category=category||'Couture Nail Art'; }
            else if (/embellish|stone|crystal|pearl|metal|3d/.test(k)) { ritual='The Pleiades Studio'; category=category||'Embellishment Drawers'; }
            else if (/art|editorial|custom/.test(k)) { ritual='The Pleiades Studio'; category=category||'Editorial Nail Art'; }
            else { ritual = ritual || 'Hand Therapies'; category = category || 'Core Hand Rituals'; }
        }
        if (hasStoredRitual) ritual = String(raw.ritualGroup || '').trim();
        if (hasStoredCategory) category = String(raw.category || '').trim();
        if (!category) category = ritual;
        return {ritualGroup: ritual, category};
    }

    function normalizeRecord(id, raw={}){
        const rawDept = String(raw.department || raw.appliesTo || raw.dept || '').trim();
        const explicitDept = dept(rawDept);
        let department = explicitDept;
        if (!rawDept) {
            const inferredFoot = /\bfoot\b|feet|pedicure|heel|callus|sole|toe|medi[-\s]?cleanse|rapid reboot|essential foot reset|silk skin|refinement indulgence/i.test([raw.serviceName, raw.serviceDescription, raw.ritualGroup, raw.category].join(' '));
            const inferredHand = /\bhand\b|manicure|arm|acrylic|gel\s*x|biab|duragel|sculpt/i.test([raw.serviceName, raw.serviceDescription, raw.ritualGroup, raw.category].join(' '));
            if (inferredFoot && !inferredHand) department='Foot';
            if (inferredHand && !inferredFoot) department='Hand';
        }
        const rc = inferRitualAndCategory(raw, department);
        const it = inputType(raw.inputType || raw.selection || raw.serviceType);
        const st = status(raw.status);
        const sname = serviceName(raw) || 'Unnamed Service';
        const ritualGroupOrder = orderField(raw.ritualGroupOrder ?? raw.groupOrder ?? raw.mainMenuOrder ?? raw.ritualOrder, ritualOrder(department, rc.ritualGroup));
        const categorySortOrder = orderField(raw.categoryOrder ?? raw.subCategoryOrder ?? raw.categorySortOrder, categoryOrder(department, rc.ritualGroup, rc.category));
        const sortOrder = orderField(raw.sortOrder ?? raw.priority ?? raw.serviceSortOrder, 9999);
        return {
            id, department,
            ritualGroup: rc.ritualGroup,
            ritualGroupDescription: String(raw.ritualGroupDescription || RITUAL_DESC[department]?.[rc.ritualGroup] || '').trim(),
            ritualGroupOrder,
            category: rc.category,
            categoryDescription: String(raw.categoryDescription || CATEGORY_DESC[rc.category] || RITUAL_DESC[department]?.[rc.ritualGroup] || '').trim(),
            categoryOrder: categorySortOrder,
            serviceName: sname,
            name: sname,
            serviceDescription: String(raw.serviceDescription || raw.description || raw.desc || '').trim(),
            price: parseFloat(raw.price || raw.priceGHC || raw.amount || 0) || 0,
            duration: parseInt(raw.duration || raw.durationMins || 0, 10) || 0,
            inputType: it,
            pricingModel: priceModel(raw.pricingModel || raw.pricingType, it),
            sortOrder,
            status: st,
            isActive: st === 'active' && raw.isActive !== false,
            updatedAt: raw.updatedAt || null,
            tag: raw.tag || 'None'
        };
    }

    function dedup(items){
        const map = new Map();
        items.forEach(s => {
            if (s.status === 'deleted') return;
            const key = [s.department,s.ritualGroup,s.category,s.serviceName].map(loose).join('|');
            const cur = map.get(key);
            if (!cur || (String(s.serviceDescription||'').length > String(cur.serviceDescription||'').length) || (s.isActive && !cur.isActive)) map.set(key,s);
        });
        return Array.from(map.values());
    }



    return dedup(records.map(raw => normalizeRecord(raw.id, raw))).filter(s => s.status !== 'deleted' && s.isActive);
}
module.exports = { normalizeLegacyMenu };

