// ============================================================
//  THURAYA — CLIENT GROUP BOOKING FULL FLOW
//  Safe modular file. Loaded after app.js.
//  Handles:
//  - group member service selection
//  - same-time availability
//  - client-controlled split options e.g. 4+1, 3+2
//  - billing choices for same-time and split groups
//  - Firestore writes compatible with Staff OS Appointments
// ============================================================

// ── Group state ───────────────────────────────────────────────
let grp_groupSize = 2;
let grp_activeMember = 0;
let grp_members = [];
let grp_groupId = null;
let grp_selectedPlan = { type: 'same', timeStr: '', dateStr: '', subgroups: [] };
let grp_billingMode = '';
let grp_bookedCacheByDate = {};

function grp_todayString() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function grp_timeToMins(str) {
    if (!str) return 0;
    const [h, m] = String(str).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function grp_minsToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function grp_formatTime(t) {
    if (!t) return '—';
    const [h,m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function grp_formatDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); }
    catch(e) { return d; }
}

function grp_memberLabel(index) {
    const m = grp_members[index] || {};
    return m.name || (index === 0 ? 'You' : `Person ${index + 1}`);
}

function grp_memberTotals(member) {
    const services = member?.selectedServices || [];
    const totalMins = services.reduce((sum, s) => sum + ((Number(s.dur) || 0) * (Number(s.qty) || 1)), 0);
    const listedSubtotal = services.reduce((sum, s) => sum + ((Number(s.price) || 0) * (Number(s.qty) || 1)), 0);
    const taxResult = typeof applyTaxes === 'function'
        ? applyTaxes(listedSubtotal)
        : { basePrice: listedSubtotal, grandTotal: listedSubtotal, taxLines: [] };
    const label = services.map(s => `${s.name}${s.qty > 1 ? ' (x' + s.qty + ')' : ''}`).join(', ');
    return {
        services,
        totalMins,
        listedSubtotal,
        basePrice: taxResult.basePrice,
        grandTotal: taxResult.grandTotal,
        taxLines: taxResult.taxLines || [],
        label
    };
}

function grp_groupTotals() {
    const memberTotals = grp_members.map(grp_memberTotals);
    return {
        memberTotals,
        totalMinsMax: Math.max(0, ...memberTotals.map(t => t.totalMins || 0)),
        listedSubtotal: memberTotals.reduce((s, t) => s + t.listedSubtotal, 0),
        grandTotal: memberTotals.reduce((s, t) => s + t.grandTotal, 0)
    };
}

async function grp_ensureTechs() {
    try {
        if (typeof bk_techs !== 'undefined' && Array.isArray(bk_techs) && bk_techs.length) return bk_techs;
        if (typeof loadTechs === 'function') await loadTechs();
        if (typeof bk_techs !== 'undefined' && Array.isArray(bk_techs)) return bk_techs;
    } catch(e) {}
    return [];
}

async function grp_getBookedSlots(dateStr) {
    if (grp_bookedCacheByDate[dateStr]) return grp_bookedCacheByDate[dateStr];
    const booked = [];
    const statuses = ['Scheduled', 'Arrived', 'In Progress', 'Ready for Payment'];
    try {
        const snap = await db.collection('Appointments')
            .where('dateString', '==', dateStr)
            .where('status', 'in', statuses)
            .get();
        snap.forEach(doc => {
            const d = doc.data() || {};
            const email = d.assignedTechEmail || '';
            if (!email || !d.timeString) return;
            const start = grp_timeToMins(d.timeString);
            const dur = parseInt(d.bookedDuration || 60, 10) || 60;
            booked.push({ techEmail: email, startMins: start, endMins: start + dur });
        });
    } catch(e) {
        // Firestore 'in' supports max 10 values; if rules/index fail, degrade gracefully.
        try {
            const snap = await db.collection('Appointments').where('dateString', '==', dateStr).get();
            snap.forEach(doc => {
                const d = doc.data() || {};
                if (!statuses.includes(d.status)) return;
                const email = d.assignedTechEmail || '';
                if (!email || !d.timeString) return;
                const start = grp_timeToMins(d.timeString);
                const dur = parseInt(d.bookedDuration || 60, 10) || 60;
                booked.push({ techEmail: email, startMins: start, endMins: start + dur });
            });
        } catch(inner) { console.error('Group availability load failed:', inner); }
    }
    grp_bookedCacheByDate[dateStr] = booked;
    return booked;
}

function grp_getFreeTechsAt(techs, bookedSlots, startMins, durationMins) {
    const endMins = startMins + durationMins;
    const busy = new Set();
    bookedSlots.forEach(b => {
        if (b.startMins < endMins && b.endMins > startMins) busy.add(b.techEmail);
    });
    return techs.filter(t => t.email && !busy.has(t.email));
}

function grp_candidateSlots() {
    const slots = [];
    const open = 8 * 60;
    const close = 20 * 60;
    const step = 30;
    for (let t = open; t < close; t += step) slots.push(t);
    return slots;
}

function grp_isPastSlot(dateStr, startMins) {
    if (dateStr !== grp_todayString()) return false;
    const n = new Date();
    return startMins <= (n.getHours() * 60 + n.getMinutes());
}

function grp_generatePartitions(total, maxPart) {
    const results = [];
    const seen = new Set();
    function helper(remaining, maxAllowed, path) {
        if (remaining === 0) {
            const key = path.join('+');
            if (!seen.has(key)) { seen.add(key); results.push([...path]); }
            return;
        }
        const cap = Math.min(maxAllowed, maxPart, remaining);
        for (let i = cap; i >= 1; i--) helper(remaining - i, i, [...path, i]);
    }
    helper(total, maxPart, []);
    return results.sort((a, b) => {
        if (a.length !== b.length) return a.length - b.length;
        return b[0] - a[0];
    });
}

function grp_allocateMembersBySplit(split) {
    let cursor = 0;
    return split.map((size, idx) => {
        const memberIndexes = [];
        for (let i = 0; i < size; i++) memberIndexes.push(cursor++);
        return { index: idx + 1, size, memberIndexes, dateStr: '', timeStr: '', techs: [] };
    });
}

async function grp_findSlotForMembers(dateStr, memberIndexes, excludedTechLocks = []) {
    const techs = await grp_ensureTechs();
    const booked = await grp_getBookedSlots(dateStr);
    const close = 20 * 60;
    const duration = Math.max(60, ...memberIndexes.map(i => grp_memberTotals(grp_members[i]).totalMins || 60));
    const needed = memberIndexes.length;
    const slots = grp_candidateSlots();

    for (const start of slots) {
        if (grp_isPastSlot(dateStr, start)) continue;
        if (start + duration > close) continue;
        let free = grp_getFreeTechsAt(techs, booked, start, duration);
        // avoid double-using the same tech at same time within generated split plan
        const lockAtThisTime = new Set(excludedTechLocks.filter(x => x.dateStr === dateStr && x.timeStr === grp_minsToTime(start)).map(x => x.email));
        free = free.filter(t => !lockAtThisTime.has(t.email));
        if (free.length >= needed) {
            return { dateStr, timeStr: grp_minsToTime(start), techs: free.slice(0, needed), duration };
        }
    }
    return null;
}

async function grp_buildPlanForSplit(dateStr, split) {
    const subgroups = grp_allocateMembersBySplit(split);
    const locks = [];
    for (const sg of subgroups) {
        const slot = await grp_findSlotForMembers(dateStr, sg.memberIndexes, locks);
        if (!slot) return null;
        sg.dateStr = slot.dateStr;
        sg.timeStr = slot.timeStr;
        sg.techs = slot.techs;
        slot.techs.forEach(t => locks.push({ dateStr: slot.dateStr, timeStr: slot.timeStr, email: t.email }));
    }
    return subgroups;
}

async function grp_findEarliestFullGroup(startDateStr) {
    const base = new Date(startDateStr + 'T12:00:00');
    const allIndexes = grp_members.map((_, i) => i);
    for (let d = 0; d < 21; d++) {
        const x = new Date(base);
        x.setDate(x.getDate() + d);
        const dateStr = `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
        const slot = await grp_findSlotForMembers(dateStr, allIndexes, []);
        if (slot) return slot;
    }
    return null;
}

// ── Solo shortcut ────────────────────────────────────────────
window.grp_soloMode = function() {
    if (typeof bk_clearAllSelections === 'function') bk_clearAllSelections();
    window.goToStep('screen-services');
};

// ── Group size picker ─────────────────────────────────────────
window.grp_changeSize = function(delta) {
    grp_groupSize = Math.min(6, Math.max(2, grp_groupSize + delta));
    const el = document.getElementById('grp_sizeNumber');
    if (el) el.textContent = grp_groupSize;
};

window.grp_initMembers = function() {
    grp_groupId = null;
    grp_selectedPlan = { type: 'same', timeStr: '', dateStr: '', subgroups: [] };
    grp_billingMode = '';
    grp_bookedCacheByDate = {};
    grp_members = Array.from({ length: grp_groupSize }, (_, i) => ({
        name: i === 0 ? (bk_clientProfile?.name || '') : '',
        selectedServices: [],
        dept: 'Hand',
        assignedTechEmail: '',
        assignedTechName: ''
    }));
    grp_activeMember = 0;
    grp_renderMemberTab(0);
    window.goToStep('screen-group-services');
};

// ── Tabs and member services ──────────────────────────────────
function grp_renderTabs() {
    const container = document.getElementById('grp_personTabs');
    if (!container) return;
    container.innerHTML = grp_members.map((m, i) => {
        const done = m.selectedServices && m.selectedServices.length > 0;
        const active = i === grp_activeMember;
        return `<button type="button" class="grp-tab ${active ? 'grp-tab--active' : ''} ${done && !active ? 'grp-tab--done' : ''}" onclick="grp_renderMemberTab(${i})">
            ${done ? '<span class="grp-tab-check">✓</span>' : ''}${grp_memberLabel(i)}
        </button>`;
    }).join('');
}

window.grp_renderMemberTab = function(index) {
    grp_activeMember = index;
    const member = grp_members[index];
    const nameInput = document.getElementById('grp_activeName');
    const nameLabel = document.getElementById('grp_nameLabel');
    if (nameInput) nameInput.value = member.name || '';
    if (nameLabel) nameLabel.textContent = index === 0 ? 'Your name' : `Person ${index + 1}'s name`;
    document.querySelectorAll('#grp_deptToggle .dept-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.dept === member.dept);
    });
    grp_renderServiceList();
    grp_renderTabs();
    grp_updateProgress();
};

window.grp_saveName = function(val) {
    if (grp_members[grp_activeMember]) {
        grp_members[grp_activeMember].name = val.trim();
        grp_renderTabs();
    }
};

window.grp_switchDept = function(dept, btn) {
    if (!grp_members[grp_activeMember]) return;
    grp_members[grp_activeMember].dept = dept;
    document.querySelectorAll('#grp_deptToggle .dept-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    grp_renderServiceList();
};

function grp_renderServiceList() {
    const container = document.getElementById('grp_serviceList');
    if (!container) return;
    const member = grp_members[grp_activeMember];
    const dept = member.dept || 'Hand';
    const sel = member.selectedServices || [];

    const aliases = { 'I. HAND THERAPIES': 'I. HAND THERAPY RITUALS' };
    const typeOrder = { radio: 0, checkbox: 1, counter: 2 };
    const dbData = { Hand: {}, Foot: {} };

    (bk_menuServices || []).forEach(s => {
        let cat = ((s.category || 'Uncategorized').trim().replace(/\s+/g, ' '));
        cat = aliases[cat] || aliases[cat.toUpperCase()] || cat;
        if (s.department === 'Both') {
            ['Hand','Foot'].forEach(d => {
                if (!dbData[d][cat]) dbData[d][cat] = [];
                dbData[d][cat].push(s);
            });
        } else {
            const d = s.department || 'Hand';
            if (!dbData[d]) dbData[d] = {};
            if (!dbData[d][cat]) dbData[d][cat] = [];
            dbData[d][cat].push(s);
        }
    });

    Object.values(dbData).forEach(dObj => Object.values(dObj).forEach(arr => arr.sort((a,b) => (typeOrder[a.inputType] ?? 1) - (typeOrder[b.inputType] ?? 1))));
    const numRe = /^(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)\./i;
    const sortedCats = Object.keys(dbData[dept] || {}).sort((a,b) => {
        const aU = a.trim().toUpperCase(), bU = b.trim().toUpperCase();
        const aNum = numRe.test(aU), bNum = numRe.test(bU);
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return 1;
        return aU.localeCompare(bU, undefined, { numeric:true, sensitivity:'base' });
    });

    if (!sortedCats.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px 0;">No services available for this category.</p>';
        return;
    }

    let html = '';
    sortedCats.forEach(cat => {
        const items = dbData[dept][cat];
        const singles = items.filter(s => (s.inputType || 'radio') === 'radio');
        const multis = items.filter(s => (s.inputType || 'radio') !== 'radio');
        html += `<div class="menu-section"><div class="menu-section-heading">${cat}</div>`;
        if (singles.length && multis.length) {
            html += `<div class="menu-subgroup-label">Choose your ritual <span style="color:#bbb;font-size:0.68rem;text-transform:none;letter-spacing:0;">— select one</span></div>`;
            singles.forEach(s => html += grp_buildCard(s, dept, sel));
            html += `<div class="menu-subgroup-divider"></div><div class="menu-subgroup-label">Enhancements &amp; Add-ons <span style="color:#bbb;font-size:0.68rem;text-transform:none;letter-spacing:0;">— select any</span></div>`;
            multis.forEach(s => html += grp_buildCard(s, dept, sel));
        } else {
            items.forEach(s => html += grp_buildCard(s, dept, sel));
        }
        html += '</div>';
    });
    container.innerHTML = html;
}

function grp_escapeJs(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function grp_buildCard(s, dept, sel) {
    const type = s.inputType || 'radio';
    const name = s.name || 'Service';
    const dur = Number(s.duration) || 0;
    const price = Number(s.price) || 0;
    const descHtml = s.desc ? `<div class="service-card-desc">${s.desc}</div>` : '';
    const tagHtml = (s.tag && s.tag !== 'None') ? `<span class="hl-tag">${s.tag}</span>` : '';
    const priceTag = `<span class="service-price-pill">${dur > 0 ? dur + ' mins &nbsp;|&nbsp; ' : ''}${price} GHC</span>`;
    const safeName = grp_escapeJs(name);

    if (type === 'counter') {
        const qty = sel.find(x => x.id === s.id)?.qty || 0;
        return `<div class="service-card" style="align-items:center;">
            <div class="service-card-body" style="pointer-events:none;"><div class="service-card-name">${name} ${tagHtml}</div>${descHtml}${priceTag}</div>
            <div class="counter-box">
                <button type="button" class="counter-btn" onclick="grp_updateCounter('${s.id}',${price},${dur},'${safeName}',-1)">−</button>
                <input type="number" id="grp_qty_${s.id}" value="${qty}" min="0" readonly style="width:44px;height:36px;text-align:center;padding:4px;font-weight:700;border:1px solid var(--border);border-radius:6px;">
                <button type="button" class="counter-btn" onclick="grp_updateCounter('${s.id}',${price},${dur},'${safeName}',1)">+</button>
            </div></div>`;
    }

    const groupName = type === 'radio' ? `grp_base_${dept}_${grp_activeMember}` : `grp_cb_${s.id}_${grp_activeMember}`;
    const selected = sel.some(x => x.id === s.id);
    const inputEl = type === 'radio'
        ? `<input type="radio" name="${groupName}" id="grp_cb_${s.id}" ${selected ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;">`
        : `<input type="checkbox" id="grp_cb_${s.id}" ${selected ? 'checked' : ''} style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;">`;
    return `<div class="service-card ${selected ? 'selected' : ''}" onclick="grp_toggleCard(event,this,'${s.id}','${type}','${groupName}',${price},${dur},'${safeName}')">${inputEl}<div class="service-card-body"><div class="service-card-name">${name} ${tagHtml}</div>${descHtml}${priceTag}</div></div>`;
}

window.grp_toggleCard = function(event, card, id, type, groupName, price, dur, name) {
    event.preventDefault();
    const member = grp_members[grp_activeMember];
    const input = document.getElementById('grp_cb_' + id);
    if (!input || !member) return;
    if (type === 'radio') {
        document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
            r.checked = false;
            r.closest('.service-card')?.classList.remove('selected');
        });
        member.selectedServices = member.selectedServices.filter(s => {
            const el = document.getElementById('grp_cb_' + s.id);
            return !el || el.name !== groupName;
        });
        input.checked = true;
        card.classList.add('selected');
        member.selectedServices.push({ id, type, price, dur, name, qty: 1 });
    } else {
        input.checked = !input.checked;
        card.classList.toggle('selected', input.checked);
        if (input.checked) member.selectedServices.push({ id, type, price, dur, name, qty: 1 });
        else member.selectedServices = member.selectedServices.filter(s => s.id !== id);
    }
    grp_renderTabs();
    grp_updateProgress();
};

window.grp_updateCounter = function(id, price, dur, name, delta) {
    const input = document.getElementById('grp_qty_' + id);
    const member = grp_members[grp_activeMember];
    if (!input || !member) return;
    const val = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
    input.value = val;
    member.selectedServices = member.selectedServices.filter(s => s.id !== id);
    if (val > 0) member.selectedServices.push({ id, type: 'counter', price, dur, name, qty: val });
    grp_renderTabs();
    grp_updateProgress();
};

function grp_updateProgress() {
    const done = grp_members.filter(m => m.selectedServices && m.selectedServices.length > 0).length;
    const total = grp_members.length;
    const progressEl = document.getElementById('grp_progressText');
    const nextBtn = document.getElementById('grp_nextPersonBtn');
    const continueBtn = document.getElementById('grp_toDateTimeBtn');
    if (progressEl) progressEl.textContent = ""; // hidden by final premium UI
    const currentDone = grp_members[grp_activeMember]?.selectedServices?.length > 0;
    const isLast = grp_activeMember === total - 1;
    if (nextBtn) nextBtn.style.display = 'none'; // removed from final premium UI
    if (continueBtn) continueBtn.disabled = done !== total;
}

window.grp_nextPerson = function() {
    if (grp_activeMember < grp_members.length - 1) {
        grp_renderMemberTab(grp_activeMember + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

// ── Date / slots / split planner ──────────────────────────────
window.grp_goToDateTime = function() {
    const dateEl = document.getElementById('grp_date');
    if (dateEl) { dateEl.min = grp_todayString(); dateEl.value = ''; }
    const slotsContainer = document.getElementById('grp_slotsContainer');
    if (slotsContainer) slotsContainer.style.display = 'none';
    const slots = document.getElementById('grp_slots');
    if (slots) slots.innerHTML = '';
    const timeEl = document.getElementById('grp_time');
    if (timeEl) timeEl.value = '';
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    const sub = document.getElementById('grp_datetimeSubtitle');
    if (sub) sub.textContent = `Showing times where all ${grp_members.length} people can be served together. If not possible, you can split the group.`;
    window.goToStep('screen-group-datetime');
};

window.grp_generateSlots = async function() {
    const dateEl = document.getElementById('grp_date');
    const dateStr = dateEl?.value || '';
    const container = document.getElementById('grp_slotsContainer');
    const grid = document.getElementById('grp_slots');
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (!dateStr || !container || !grid) return;
    if (dateStr < grp_todayString()) {
        container.style.display = 'block';
        grid.innerHTML = '<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">Cannot book in the past.</p>';
        return;
    }
    grp_selectedPlan = { type: 'same', dateStr, timeStr: '', subgroups: [] };
    if (confirmBtn) confirmBtn.disabled = true;
    document.getElementById('grp_time').value = '';
    container.style.display = 'block';
    grid.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1;">Checking group availability…</div>';

    await grp_ensureTechs();
    const techs = (typeof bk_techs !== 'undefined' && Array.isArray(bk_techs)) ? bk_techs : [];
    const booked = await grp_getBookedSlots(dateStr);
    const group = grp_groupTotals();
    const duration = Math.max(60, group.totalMinsMax || 60);
    const needed = grp_members.length;
    const close = 20 * 60;
    const slotMap = {};
    let maxFreeOnDay = 0;

    grp_candidateSlots().forEach(start => {
        if (grp_isPastSlot(dateStr, start)) return;
        if (start + duration > close) return;
        const free = grp_getFreeTechsAt(techs, booked, start, duration);
        maxFreeOnDay = Math.max(maxFreeOnDay, free.length);
        if (free.length >= needed) slotMap[start] = free.slice(0, needed);
    });

    const sameSlots = Object.keys(slotMap).map(Number).sort((a,b) => a-b);
    if (sameSlots.length) {
        grid.innerHTML = sameSlots.map(t => {
            const t24 = grp_minsToTime(t);
            return `<button type="button" class="slot-btn" data-time="${t24}" onclick="grp_selectSameSlot('${t24}', this)">${grp_formatTime(t24)}</button>`;
        }).join('');
        return;
    }

    grp_renderCapacityOptions(dateStr, maxFreeOnDay, techs.length);
};

window.grp_selectSameSlot = async function(timeStr, btn) {
    document.querySelectorAll('#grp_slots .slot-btn').forEach(b => b.classList.remove('selected', 'active'));
    if (btn) btn.classList.add('selected', 'active');
    const dateStr = document.getElementById('grp_date')?.value || '';
    document.getElementById('grp_time').value = timeStr;
    const techs = await grp_ensureTechs();
    const booked = await grp_getBookedSlots(dateStr);
    const duration = Math.max(60, grp_groupTotals().totalMinsMax || 60);
    const free = grp_getFreeTechsAt(techs, booked, grp_timeToMins(timeStr), duration).slice(0, grp_members.length);
    grp_members.forEach((m, i) => {
        m.assignedTechEmail = free[i]?.email || '';
        m.assignedTechName = free[i]?.name || 'To be assigned';
        m.splitDateStr = '';
        m.splitTimeStr = '';
        m.subGroupIndex = null;
    });
    grp_selectedPlan = { type: 'same', dateStr, timeStr, subgroups: [] };
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = false;
};

function grp_renderCapacityOptions(dateStr, maxFreeOnDay, totalTechs) {
    const grid = document.getElementById('grp_slots');
    const capacity = Math.max(1, Math.min(grp_members.length - 1, maxFreeOnDay || totalTechs || 1));
    const splitOptions = grp_generatePartitions(grp_members.length, capacity).filter(p => p.length > 1);
    const splitHtml = splitOptions.slice(0, 8).map((p, idx) => {
        const label = p.join(' + ');
        return `<button type="button" class="group-option-card" onclick="grp_selectSplitOption('${p.join('-')}', this)">
            <div class="group-option-icon">${idx + 1}</div>
            <div class="group-option-body"><strong>${label} people ${idx === 0 ? '<span class="group-recommended-badge">Recommended</span>' : ''}</strong><span>${p.length} sub-groups. We will assign the earliest available times for each sub-group.</span></div>
        </button>`;
    }).join('');

    grid.innerHTML = `<div class="group-capacity-panel warn" style="grid-column:1/-1;">
        <h3>Not enough technicians for one shared time</h3>
        <p>Your group has <strong>${grp_members.length}</strong> people. On this date, the highest same-time capacity found is <strong>${maxFreeOnDay || 0}</strong> technician(s). Choose one of the options below.</p>
        <div class="group-option-list">
            <button type="button" class="group-option-card" onclick="grp_findFullGroupAlternative('${dateStr}')">
                <div class="group-option-icon">📅</div>
                <div class="group-option-body"><strong>Find earliest time for the whole group</strong><span>Search the next 21 days for a time where everyone can be served together.</span></div>
            </button>
            ${splitHtml ? `<div class="group-split-panel"><h3>Or split your group</h3><p>Choose how you want the group divided. Example: 3 + 2 means three people first, then two people at another available time.</p><div class="group-option-list">${splitHtml}</div><div id="grp_splitPreview" style="margin-top:12px;"></div></div>` : '<p style="color:var(--error);">No split option could be generated. Please try another date.</p>'}
        </div>
    </div>`;
}

window.grp_findFullGroupAlternative = async function(dateStr) {
    const preview = document.getElementById('grp_splitPreview') || document.getElementById('grp_slots');
    if (preview) preview.innerHTML = '<div class="loading-pulse">Searching for earliest full-group time…</div>';
    const slot = await grp_findEarliestFullGroup(dateStr);
    if (!slot) {
        if (preview) preview.innerHTML = '<p style="color:var(--error);font-size:0.85rem;">No full-group slot found in the next 21 days. Please choose a split option.</p>';
        return;
    }
    if (preview) preview.innerHTML = `<div class="group-capacity-panel"><h3>Full-group slot found</h3><p><strong>${grp_formatDate(slot.dateStr)}</strong> at <strong>${grp_formatTime(slot.timeStr)}</strong></p><button type="button" class="btn-primary full" onclick="grp_acceptFullGroupAlternative('${slot.dateStr}','${slot.timeStr}')">Book this full-group time</button></div>`;
};

window.grp_acceptFullGroupAlternative = async function(dateStr, timeStr) {
    const dateEl = document.getElementById('grp_date');
    if (dateEl) dateEl.value = dateStr;
    await grp_selectSameSlot(timeStr, null);
    window.goToStep('screen-group-confirm');
};

window.grp_selectSplitOption = async function(splitStr, btn) {
    document.querySelectorAll('.group-option-card').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');
    const dateStr = document.getElementById('grp_date')?.value || '';
    const split = splitStr.split('-').map(Number).filter(Boolean);
    const preview = document.getElementById('grp_splitPreview');
    if (preview) preview.innerHTML = '<div class="loading-pulse">Finding times for your chosen split…</div>';
    const plan = await grp_buildPlanForSplit(dateStr, split);
    if (!plan) {
        if (preview) preview.innerHTML = '<p style="color:var(--error);font-size:0.85rem;">Could not fit this split on the selected date. Try a smaller split, or choose another date.</p>';
        return;
    }
    grp_selectedPlan = { type: 'split', dateStr, timeStr: '', subgroups: plan };
    plan.forEach(sg => {
        sg.memberIndexes.forEach((mi, idx) => {
            const m = grp_members[mi];
            const tech = sg.techs[idx] || {};
            m.assignedTechEmail = tech.email || '';
            m.assignedTechName = tech.name || 'To be assigned';
            m.splitDateStr = sg.dateStr;
            m.splitTimeStr = sg.timeStr;
            m.subGroupIndex = sg.index;
        });
    });
    document.getElementById('grp_time').value = 'SPLIT';
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = false;
    if (preview) {
        preview.innerHTML = `<div class="group-split-panel"><h3>Split plan ready</h3><p>Review the proposed sub-group schedule below, then continue to confirmation.</p>${plan.map(sg => {
            const names = sg.memberIndexes.map(grp_memberLabel).join(', ');
            return `<div class="group-subslot-card"><strong>Sub-group ${sg.index}: ${sg.size} ${sg.size === 1 ? 'person' : 'people'} · ${grp_formatTime(sg.timeStr)}</strong><p>${names}</p></div>`;
        }).join('')}<button type="button" class="btn-primary full" onclick="goToStep('screen-group-confirm')">Review Split Booking →</button></div>`;
    }
};

// ── Confirmation and billing ──────────────────────────────────
function grp_billingOptionsHtml() {
    const totals = grp_groupTotals();
    const total = totals.grandTotal;
    const perPerson = grp_members.length ? total / grp_members.length : total;
    if (grp_selectedPlan.type === 'split') {
        return `<div class="group-billing-panel" id="grp_billingPanel"><h3>Payment options</h3><p>Because your group is split across different times, choose how checkout should be handled.</p>
            <label class="group-billing-card"><input type="radio" name="grp_billingMode" value="subgroup_pays_separately" onchange="grp_onBillingChange()"><span class="group-option-body"><strong>Each sub-group pays separately</strong><span>FOH bills each sub-group when they finish.</span></span></label>
            <label class="group-billing-card"><input type="radio" name="grp_billingMode" value="lead_pays_all_after_last" onchange="grp_onBillingChange()"><span class="group-option-body"><strong>Lead booker pays for all after the last sub-group</strong><span>One final bill is raised after everyone is done.</span><span class="amount-pill">Group total: ${total.toFixed(2)} GHC</span></span></label>
        </div>`;
    }
    return `<div class="group-billing-panel" id="grp_billingPanel"><h3>Payment options</h3><p>Everyone arrives together, so choose how the shared session should be billed.</p>
        <label class="group-billing-card"><input type="radio" name="grp_billingMode" value="lead_pays_all" onchange="grp_onBillingChange()"><span class="group-option-body"><strong>One person pays for all</strong><span>The lead booker pays the full group total.</span><span class="amount-pill">${total.toFixed(2)} GHC</span></span></label>
        <label class="group-billing-card"><input type="radio" name="grp_billingMode" value="split_equally" onchange="grp_onBillingChange()"><span class="group-option-body"><strong>Split equally</strong><span>Total divided by ${grp_members.length} people.</span><span class="amount-pill">${perPerson.toFixed(2)} GHC each</span></span></label>
        <label class="group-billing-card"><input type="radio" name="grp_billingMode" value="each_pays_own" onchange="grp_onBillingChange()"><span class="group-option-body"><strong>Each pays their own</strong><span>Each person pays for their selected services.</span></span></label>
    </div>`;
}

window.grp_onBillingChange = function() {
    grp_billingMode = document.querySelector('input[name="grp_billingMode"]:checked')?.value || '';
    document.querySelectorAll('.group-billing-card').forEach(card => {
        const input = card.querySelector('input');
        card.classList.toggle('selected', input?.checked === true);
    });
};

function grp_populateConfirm() {
    const isSplit = grp_selectedPlan.type === 'split';
    const dateLabel = isSplit ? 'Split times' : grp_formatDate(grp_selectedPlan.dateStr || document.getElementById('grp_date')?.value || '');
    const timeLabel = isSplit ? 'See sub-groups below' : grp_formatTime(grp_selectedPlan.timeStr || document.getElementById('grp_time')?.value || '');
    document.getElementById('grp_conf_date').textContent = dateLabel;
    document.getElementById('grp_conf_time').textContent = timeLabel;
    document.getElementById('grp_conf_size').textContent = `${grp_members.length} people`;
    const membersEl = document.getElementById('grp_conf_members');
    if (membersEl) {
        membersEl.innerHTML = grp_members.map((m, i) => {
            const t = grp_memberTotals(m);
            const splitLine = isSplit ? `<span style="color:var(--gold-dark);font-size:0.78rem;margin-top:2px;display:block;">🕐 Sub-group ${m.subGroupIndex}: ${grp_formatDate(m.splitDateStr)} at ${grp_formatTime(m.splitTimeStr)}</span>` : '';
            return `<div class="grp-member-card"><div class="grp-member-index">${i+1}</div><div class="grp-member-info"><strong>${grp_memberLabel(i)}${i === 0 ? '<span class="grp-lead-badge">Lead booker</span>' : ''}</strong><span>${t.label || '—'} · ${t.totalMins} mins · ${t.grandTotal.toFixed(2)} GHC</span><span style="color:var(--accent);font-size:0.78rem;margin-top:2px;display:block;">👩‍🔧 ${m.assignedTechName || 'To be assigned'}</span>${splitLine}</div></div>`;
        }).join('');
    }
    const info = document.querySelector('#screen-group-confirm .grp-info-box p');
    if (info) info.textContent = isSplit
        ? 'Your group will be served in sub-groups at different times. One confirmation covers the full group plan.'
        : 'All services run at the same time. The session ends when the longest treatment is complete.';
    document.getElementById('grp_billingPanel')?.remove();
    membersEl?.insertAdjacentHTML('afterend', grp_billingOptionsHtml());
}

async function grp_preAssignSameTimeIfNeeded() {
    if (grp_selectedPlan.type !== 'same') return;
    const dateStr = grp_selectedPlan.dateStr || document.getElementById('grp_date')?.value || '';
    const timeStr = grp_selectedPlan.timeStr || document.getElementById('grp_time')?.value || '';
    if (!dateStr || !timeStr) return;
    const techs = await grp_ensureTechs();
    const booked = await grp_getBookedSlots(dateStr);
    const duration = Math.max(60, grp_groupTotals().totalMinsMax || 60);
    const free = grp_getFreeTechsAt(techs, booked, grp_timeToMins(timeStr), duration).slice(0, grp_members.length);
    grp_members.forEach((m, i) => {
        m.assignedTechEmail = free[i]?.email || m.assignedTechEmail || '';
        m.assignedTechName = free[i]?.name || m.assignedTechName || 'To be assigned';
    });
}

function grp_computeBillingForMember(memberIndex, memberTotal) {
    const totals = grp_groupTotals();
    const mode = grp_billingMode;
    let amountDue = memberTotal.grandTotal;
    let payableBy = 'self';
    if (mode === 'lead_pays_all') {
        amountDue = memberIndex === 0 ? totals.grandTotal : 0;
        payableBy = memberIndex === 0 ? 'lead_booker' : 'covered_by_lead';
    } else if (mode === 'split_equally') {
        amountDue = totals.grandTotal / grp_members.length;
        payableBy = 'split_equal_share';
    } else if (mode === 'each_pays_own') {
        amountDue = memberTotal.grandTotal;
        payableBy = 'self';
    } else if (mode === 'lead_pays_all_after_last') {
        amountDue = memberIndex === 0 ? totals.grandTotal : 0;
        payableBy = memberIndex === 0 ? 'lead_booker_final_bill' : 'covered_by_lead_final_bill';
    } else if (mode === 'subgroup_pays_separately') {
        amountDue = memberTotal.grandTotal;
        payableBy = 'subgroup_or_member_at_completion';
    }
    return { amountDue: Number(amountDue.toFixed(2)), payableBy };
}

window.grp_confirmBooking = async function() {
    const btn = document.getElementById('grp_btnConfirm');
    grp_billingMode = document.querySelector('input[name="grp_billingMode"]:checked')?.value || '';
    if (!grp_billingMode) { toast('Please choose how payment will be handled.', 'warning'); return; }
    await grp_preAssignSameTimeIfNeeded();
    const dateFallback = document.getElementById('grp_date')?.value || '';
    const timeFallback = document.getElementById('grp_time')?.value || '';
    if (!dateFallback || !timeFallback) { toast('Missing group date or time.', 'warning'); return; }
    setBtnLoading(btn, true, 'Confirm Group Booking');
    try {
        grp_groupId = db.collection('Appointments').doc().id;
        const batch = db.batch();
        const groupTotals = grp_groupTotals();
        grp_members.forEach((m, i) => {
            const mt = grp_memberTotals(m);
            const billing = grp_computeBillingForMember(i, mt);
            const ref = db.collection('Appointments').doc();
            const isSplit = grp_selectedPlan.type === 'split';
            const dateStr = isSplit ? (m.splitDateStr || dateFallback) : dateFallback;
            const timeStr = isSplit ? (m.splitTimeStr || '') : (grp_selectedPlan.timeStr || timeFallback);
            batch.set(ref, {
                groupId: grp_groupId,
                groupSize: grp_members.length,
                isGroupBooking: true,
                splitGroup: isSplit,
                subGroupIndex: isSplit ? (m.subGroupIndex || 1) : 1,
                billingScenario: isSplit ? 'split_group_different_times' : 'whole_group_same_time',
                billingMode: grp_billingMode,
                groupTotal: Number(groupTotals.grandTotal.toFixed(2)),
                amountDue: billing.amountDue,
                payableBy: billing.payableBy,
                isLeadBooker: i === 0,
                clientPhone: i === 0 ? (bk_clientProfile?.phone || '') : '',
                clientName: m.name || grp_memberLabel(i),
                clientEmail: i === 0 ? (bk_isGuest ? '' : (bk_currentUser?.email || '')) : '',
                assignedTechEmail: m.assignedTechEmail || '',
                assignedTechName: m.assignedTechName || 'To be assigned',
                bookedService: mt.label,
                bookedDuration: mt.totalMins,
                bookedPrice: Number(mt.basePrice.toFixed(2)),
                grandTotal: billing.amountDue,
                totalGHC: billing.amountDue,
                memberServiceTotal: Number(mt.grandTotal.toFixed(2)),
                taxBreakdown: JSON.stringify(mt.taxLines.map(l => ({ name:l.name, rate:l.rate, amount:l.amount }))),
                dateString: dateStr,
                timeString: timeStr,
                status: 'Scheduled',
                source: isSplit ? 'client-group-booking-split' : 'client-group-booking',
                bookedBy: bk_isGuest ? ('guest:' + (bk_clientProfile?.phone || '')) : (bk_currentUser?.email || ''),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        grp_populateSuccess();
        _screenHistory = ['screen-welcome', 'screen-booking-mode'];
        grp_baseGoToStep('screen-group-success');
    } catch(e) {
        toast('Group booking failed: ' + e.message, 'error');
    } finally {
        setBtnLoading(btn, false, 'Confirm Group Booking');
    }
};

function grp_populateSuccess() {
    const isSplit = grp_selectedPlan.type === 'split';
    document.getElementById('grp_suc_datetime').textContent = isSplit
        ? 'Split across multiple times — see details below'
        : `${grp_formatDate(grp_selectedPlan.dateStr || document.getElementById('grp_date')?.value || '')} at ${grp_formatTime(grp_selectedPlan.timeStr || document.getElementById('grp_time')?.value || '')}`;
    document.getElementById('grp_suc_size').textContent = `${grp_members.length} people`;
    document.getElementById('grp_suc_ref').textContent = grp_groupId ? grp_groupId.slice(0, 8).toUpperCase() : '—';
    const membersEl = document.getElementById('grp_suc_members');
    if (membersEl) {
        membersEl.innerHTML = grp_members.map((m, i) => {
            const mt = grp_memberTotals(m);
            const splitLine = isSplit ? `<span style="color:var(--gold-dark);font-size:0.78rem;margin-top:2px;display:block;">🕐 Sub-group ${m.subGroupIndex}: ${grp_formatTime(m.splitTimeStr)} · ${grp_formatDate(m.splitDateStr)}</span>` : '';
            return `<div class="grp-member-card"><div class="grp-member-index">${i+1}</div><div class="grp-member-info"><strong>${grp_memberLabel(i)}</strong><span>${mt.label || '—'} · ${mt.totalMins} mins</span><span style="color:var(--accent);font-size:0.78rem;margin-top:2px;display:block;">👩‍🔧 ${m.assignedTechName || 'To be assigned'}</span>${splitLine}</div></div>`;
        }).join('');
    }
}

window.grp_bookAgain = function() {
    grp_groupSize = 2;
    grp_activeMember = 0;
    grp_members = [];
    grp_groupId = null;
    grp_selectedPlan = { type: 'same', timeStr: '', dateStr: '', subgroups: [] };
    grp_billingMode = '';
    grp_bookedCacheByDate = {};
    const n = document.getElementById('grp_sizeNumber');
    if (n) n.textContent = '2';
    _screenHistory = ['screen-welcome'];
    window.goToStep('screen-booking-mode');
};

// ── Wrap navigation after app.js is loaded ────────────────────
const grp_baseGoToStep = window.goToStep;
window.goToStep = function(id) {
    if (id === 'screen-group-confirm') {
        grp_preAssignSameTimeIfNeeded().then(() => {
            grp_populateConfirm();
            grp_baseGoToStep(id);
        });
        return;
    }
    grp_baseGoToStep(id);
};


// ============================================================
// GROUP SLOT FIX — hard override, must remain at the VERY BOTTOM.
// Purpose: never show a dead-end "No slots available" message for
// group bookings. If same-time capacity is not available, show
// full-group alternative + client-controlled split options.
// Version: group-split-fix-20260424
// ============================================================
console.log('✅ group-booking.js loaded: group-split-fix-20260424');

window.grp_generateSlots = async function() {
    const dateEl = document.getElementById('grp_date');
    const dateStr = dateEl?.value || '';
    const container = document.getElementById('grp_slotsContainer');
    const grid = document.getElementById('grp_slots');
    const confirmBtn = document.getElementById('grp_toConfirmBtn');

    if (!dateStr || !container || !grid) return;

    if (dateStr < grp_todayString()) {
        container.style.display = 'block';
        grid.innerHTML = '<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">Cannot book in the past.</p>';
        return;
    }

    grp_selectedPlan = { type: 'same', dateStr, timeStr: '', subgroups: [] };

    if (confirmBtn) confirmBtn.disabled = true;
    const hiddenTime = document.getElementById('grp_time');
    if (hiddenTime) hiddenTime.value = '';

    container.style.display = 'block';
    grid.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1;">Checking group availability…</div>';

    try {
        await grp_ensureTechs();

        const techs = (typeof bk_techs !== 'undefined' && Array.isArray(bk_techs)) ? bk_techs : [];
        const booked = await grp_getBookedSlots(dateStr);
        const group = grp_groupTotals();

        const duration = Math.max(60, group.totalMinsMax || 60);
        const needed = Math.max(2, grp_members.length || grp_groupSize || 2);
        const close = 20 * 60;
        const slotMap = {};
        let maxFreeOnDay = 0;

        grp_candidateSlots().forEach(start => {
            if (grp_isPastSlot(dateStr, start)) return;
            if (start + duration > close) return;

            const free = grp_getFreeTechsAt(techs, booked, start, duration);
            maxFreeOnDay = Math.max(maxFreeOnDay, free.length);

            if (free.length >= needed) {
                slotMap[start] = free.slice(0, needed);
            }
        });

        const sameSlots = Object.keys(slotMap).map(Number).sort((a, b) => a - b);

        if (sameSlots.length) {
            grid.innerHTML = sameSlots.map(t => {
                const t24 = grp_minsToTime(t);
                return `<button type="button" class="slot-btn" data-time="${t24}" onclick="grp_selectSameSlot('${t24}', this)">${grp_formatTime(t24)}</button>`;
            }).join('');
            return;
        }

        // IMPORTANT: group booking never dead-ends here.
        // If no full-group same-time slot exists, render split choices.
        grp_renderCapacityOptions(dateStr, maxFreeOnDay, techs.length);

    } catch (e) {
        console.error('Group availability error:', e);
        grid.innerHTML = `
            <div class="group-capacity-panel warn" style="grid-column:1/-1;">
                <h3>We could not check full-group availability</h3>
                <p>You can still choose a split option below.</p>
                <button type="button" class="btn-primary full" onclick="grp_renderCapacityOptions('${dateStr}', 1, 1)">
                    Show split options
                </button>
            </div>`;
    }
};

// Also defend against older loaded scripts by replacing exact old message after render.
setInterval(() => {
    const grid = document.getElementById('grp_slots');
    if (!grid) return;
    const txt = (grid.textContent || '').trim();
    if (txt.includes('No slots available for your group on this date')) {
        const dateStr = document.getElementById('grp_date')?.value || grp_todayString();
        console.warn('Replacing old group no-slots dead-end with split options.');
        grp_renderCapacityOptions(dateStr, 1, (typeof bk_techs !== 'undefined' && Array.isArray(bk_techs)) ? bk_techs.length : 1);
    }
}, 600);


// ============================================================
// MANUAL SPLIT PLANNER UPGRADE
// - Lead chooses date/time for each sub-group
// - Prevents overlapping tech reuse
// - Shows recommended best sequence
// - Shows timeline preview
// Version: manual-split-planner-20260424
// ============================================================
console.log('✅ group-booking.js upgrade loaded: manual-split-planner-20260424');

function grp_splitPlannerDateInputId(index) {
    return `grp_manual_sg_date_${index}`;
}

function grp_splitPlannerSlotsId(index) {
    return `grp_manual_sg_slots_${index}`;
}

function grp_splitPlannerTimelineId() {
    return 'grp_manualTimelinePreview';
}

function grp_getManualLocks(exceptIndex = -1) {
    const locks = [];
    if (!grp_selectedPlan || !Array.isArray(grp_selectedPlan.subgroups)) return locks;

    grp_selectedPlan.subgroups.forEach((sg, idx) => {
        if (idx === exceptIndex) return;
        if (!sg.dateStr || !sg.timeStr || !Array.isArray(sg.techs)) return;
        sg.techs.forEach(t => {
            if (t && t.email) {
                locks.push({
                    dateStr: sg.dateStr,
                    timeStr: sg.timeStr,
                    email: t.email,
                    subGroupIndex: sg.index || (idx + 1)
                });
            }
        });
    });

    return locks;
}

function grp_durationForSubgroup(sg) {
    return Math.max(60, ...(sg.memberIndexes || []).map(i => grp_memberTotals(grp_members[i]).totalMins || 60));
}

function grp_freeTechsRespectingManualLocks(techs, booked, dateStr, startMins, duration, exceptIndex = -1) {
    let free = grp_getFreeTechsAt(techs, booked, startMins, duration);
    const timeStr = grp_minsToTime(startMins);
    const locks = grp_getManualLocks(exceptIndex);
    const lockedAtSameTime = new Set(
        locks
            .filter(l => l.dateStr === dateStr && l.timeStr === timeStr)
            .map(l => l.email)
    );
    return free.filter(t => !lockedAtSameTime.has(t.email));
}

async function grp_getAvailableSlotsForSubgroup(index, dateStr) {
    const sg = grp_selectedPlan.subgroups[index];
    if (!sg) return [];

    const techs = await grp_ensureTechs();
    const booked = await grp_getBookedSlots(dateStr);
    const duration = grp_durationForSubgroup(sg);
    const close = 20 * 60;
    const out = [];

    grp_candidateSlots().forEach(start => {
        if (grp_isPastSlot(dateStr, start)) return;
        if (start + duration > close) return;

        const free = grp_freeTechsRespectingManualLocks(techs, booked, dateStr, start, duration, index);
        if (free.length >= sg.size) {
            out.push({
                timeStr: grp_minsToTime(start),
                startMins: start,
                duration,
                techs: free.slice(0, sg.size)
            });
        }
    });

    return out;
}

async function grp_findBestManualPlan(dateStr, split) {
    const plan = grp_allocateMembersBySplit(split);
    const chosen = [];

    for (let i = 0; i < plan.length; i++) {
        const sg = plan[i];
        const techs = await grp_ensureTechs();
        const booked = await grp_getBookedSlots(dateStr);
        const duration = grp_durationForSubgroup(sg);
        const close = 20 * 60;
        let best = null;

        for (const start of grp_candidateSlots()) {
            if (grp_isPastSlot(dateStr, start)) continue;
            if (start + duration > close) continue;

            let free = grp_getFreeTechsAt(techs, booked, start, duration);

            const timeStr = grp_minsToTime(start);
            const lockedAtSameTime = new Set();
            chosen.forEach(prev => {
                if (prev.dateStr === dateStr && prev.timeStr === timeStr) {
                    (prev.techs || []).forEach(t => lockedAtSameTime.add(t.email));
                }
            });
            free = free.filter(t => !lockedAtSameTime.has(t.email));

            if (free.length >= sg.size) {
                best = {
                    dateStr,
                    timeStr,
                    techs: free.slice(0, sg.size),
                    startMins: start,
                    duration
                };
                break;
            }
        }

        if (!best) return null;

        sg.dateStr = best.dateStr;
        sg.timeStr = best.timeStr;
        sg.techs = best.techs;
        chosen.push({ ...best, index: sg.index });
    }

    return plan;
}

function grp_renderTimelinePreview() {
    const el = document.getElementById(grp_splitPlannerTimelineId());
    if (!el) return;

    if (!grp_selectedPlan || !Array.isArray(grp_selectedPlan.subgroups)) {
        el.innerHTML = '';
        return;
    }

    const subgroups = [...grp_selectedPlan.subgroups];
    const selectedCount = subgroups.filter(sg => sg.dateStr && sg.timeStr).length;
    const allSelected = selectedCount === subgroups.length;

    const sorted = subgroups
        .filter(sg => sg.dateStr && sg.timeStr)
        .sort((a, b) => ((a.dateStr || '') + (a.timeStr || '')).localeCompare((b.dateStr || '') + (b.timeStr || '')));

    if (!sorted.length) {
        el.innerHTML = `
            <div class="grp-timeline-empty">
                Select times for each sub-group to build the timeline.
            </div>`;
        return;
    }

    el.innerHTML = `
        <div class="grp-timeline-card">
            <div class="grp-timeline-head">
                <strong>Timeline preview</strong>
                <span>${selectedCount} of ${subgroups.length} selected</span>
            </div>
            <div class="grp-timeline-list">
                ${sorted.map((sg, idx) => {
                    const names = (sg.memberIndexes || []).map(grp_memberLabel).join(', ');
                    const techNames = (sg.techs || []).map(t => t.name || t.email).join(', ') || 'To be assigned';
                    const duration = grp_durationForSubgroup(sg);
                    return `
                        <div class="grp-timeline-item">
                            <div class="grp-timeline-dot">${idx + 1}</div>
                            <div class="grp-timeline-body">
                                <strong>Sub-group ${sg.index}: ${sg.size} ${sg.size === 1 ? 'person' : 'people'}</strong>
                                <span>${grp_formatDate(sg.dateStr)} at ${grp_formatTime(sg.timeStr)} · ${duration} mins</span>
                                <small>${names}</small>
                                <small>Technicians: ${techNames}</small>
                            </div>
                        </div>`;
                }).join('')}
            </div>
            ${allSelected ? '<div class="grp-timeline-ready">✓ All sub-groups scheduled. You can continue to confirmation.</div>' : ''}
        </div>
    `;

    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = !allSelected;
}

async function grp_loadManualSubgroupSlots(index, dateStr) {
    const slotBox = document.getElementById(grp_splitPlannerSlotsId(index));
    if (!slotBox) return;

    slotBox.innerHTML = '<div class="loading-pulse">Checking available times…</div>';

    const sg = grp_selectedPlan.subgroups[index];
    if (!sg) return;

    sg.dateStr = dateStr;
    sg.timeStr = '';
    sg.techs = [];

    const slots = await grp_getAvailableSlotsForSubgroup(index, dateStr);

    if (!slots.length) {
        slotBox.innerHTML = `
            <p class="grp-no-slots">
                No suitable time found for this sub-group on this date. Try another date.
            </p>`;
        grp_renderTimelinePreview();
        return;
    }

    slotBox.innerHTML = slots.map(slot => {
        const techNames = slot.techs.map(t => t.name || t.email).join(', ');
        return `
            <button type="button" class="slot-btn grp-manual-slot-btn"
                data-time="${slot.timeStr}"
                onclick="grp_selectManualSubgroupTime(${index}, '${slot.timeStr}', this)">
                <strong>${grp_formatTime(slot.timeStr)}</strong>
                <span>${techNames}</span>
            </button>`;
    }).join('');

    grp_renderTimelinePreview();
}

window.grp_updateManualSubgroupDate = async function(index, dateStr) {
    if (!dateStr) return;
    if (dateStr < grp_todayString()) {
        toast('Cannot book in the past.', 'warning');
        const input = document.getElementById(grp_splitPlannerDateInputId(index));
        if (input) input.value = grp_todayString();
        dateStr = grp_todayString();
    }
    await grp_loadManualSubgroupSlots(index, dateStr);
};

window.grp_selectManualSubgroupTime = async function(index, timeStr, btn) {
    const sg = grp_selectedPlan.subgroups[index];
    if (!sg) return;

    const dateStr = sg.dateStr || document.getElementById(grp_splitPlannerDateInputId(index))?.value || grp_selectedPlan.dateStr;
    const start = grp_timeToMins(timeStr);
    const techs = await grp_ensureTechs();
    const booked = await grp_getBookedSlots(dateStr);
    const duration = grp_durationForSubgroup(sg);
    const free = grp_freeTechsRespectingManualLocks(techs, booked, dateStr, start, duration, index);

    if (free.length < sg.size) {
        toast('That time is no longer available. Please choose another.', 'warning');
        await grp_loadManualSubgroupSlots(index, dateStr);
        return;
    }

    sg.dateStr = dateStr;
    sg.timeStr = timeStr;
    sg.techs = free.slice(0, sg.size);

    (sg.memberIndexes || []).forEach((mi, idx) => {
        const m = grp_members[mi];
        const tech = sg.techs[idx] || {};
        if (!m) return;
        m.assignedTechEmail = tech.email || '';
        m.assignedTechName = tech.name || 'To be assigned';
        m.splitDateStr = sg.dateStr;
        m.splitTimeStr = sg.timeStr;
        m.subGroupIndex = sg.index;
    });

    const grid = btn?.parentElement;
    if (grid) grid.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected', 'active'));
    if (btn) btn.classList.add('selected', 'active');

    // Refresh other sub-group slot lists so conflict prevention is visible immediately.
    for (let i = 0; i < grp_selectedPlan.subgroups.length; i++) {
        if (i === index) continue;
        const other = grp_selectedPlan.subgroups[i];
        const otherDate = other.dateStr || document.getElementById(grp_splitPlannerDateInputId(i))?.value;
        if (otherDate && !other.timeStr) {
            await grp_loadManualSubgroupSlots(i, otherDate);
        }
    }

    grp_renderTimelinePreview();
};

window.grp_applyRecommendedManualPlan = async function() {
    const dateStr = grp_selectedPlan.dateStr || document.getElementById('grp_date')?.value || grp_todayString();
    const split = (grp_selectedPlan.subgroups || []).map(sg => sg.size);
    const btn = document.getElementById('grp_applyRecommendedBtn');

    setBtnLoading(btn, true, 'Use Recommended Schedule');
    try {
        const plan = await grp_findBestManualPlan(dateStr, split);
        if (!plan) {
            toast('Could not build a recommended sequence for this date. Please choose times manually.', 'warning');
            return;
        }

        grp_selectedPlan = { type: 'split', dateStr, timeStr: 'SPLIT', subgroups: plan };
        const timeEl = document.getElementById('grp_time');
        if (timeEl) timeEl.value = 'SPLIT';

        plan.forEach((sg, i) => {
            const input = document.getElementById(grp_splitPlannerDateInputId(i));
            if (input) input.value = sg.dateStr;
            (sg.memberIndexes || []).forEach((mi, idx) => {
                const m = grp_members[mi];
                const tech = sg.techs[idx] || {};
                if (!m) return;
                m.assignedTechEmail = tech.email || '';
                m.assignedTechName = tech.name || 'To be assigned';
                m.splitDateStr = sg.dateStr;
                m.splitTimeStr = sg.timeStr;
                m.subGroupIndex = sg.index;
            });
        });

        for (let i = 0; i < plan.length; i++) {
            await grp_loadManualSubgroupSlots(i, plan[i].dateStr);
            const grid = document.getElementById(grp_splitPlannerSlotsId(i));
            const btnToSelect = grid?.querySelector(`[data-time="${plan[i].timeStr}"]`);
            if (btnToSelect) btnToSelect.classList.add('selected', 'active');
        }

        grp_renderTimelinePreview();
        toast('Recommended schedule applied.', 'success');
    } finally {
        setBtnLoading(btn, false, 'Use Recommended Schedule');
    }
};

function grp_renderManualSplitPlanner(dateStr, split) {
    const grid = document.getElementById('grp_slots');
    if (!grid) return;

    const subgroups = grp_allocateMembersBySplit(split);
    grp_selectedPlan = {
        type: 'split',
        dateStr,
        timeStr: 'SPLIT',
        subgroups
    };

    const timeEl = document.getElementById('grp_time');
    if (timeEl) timeEl.value = 'SPLIT';

    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    grid.innerHTML = `
        <div class="group-manual-planner" style="grid-column:1/-1;">
            <div class="group-manual-planner-head">
                <h3>Choose date & time for each sub-group</h3>
                <p>You selected <strong>${split.join(' + ')}</strong>. The lead booker can now choose the best available time for each sub-group.</p>
                <button type="button" id="grp_applyRecommendedBtn" class="btn-primary full" onclick="grp_applyRecommendedManualPlan()">
                    <span class="btn-text">Use Recommended Schedule</span>
                </button>
            </div>

            ${subgroups.map((sg, i) => {
                const names = sg.memberIndexes.map(grp_memberLabel).join(', ');
                return `
                    <div class="group-manual-subgroup-card">
                        <div class="group-manual-subgroup-title">
                            <strong>Sub-group ${sg.index}: ${sg.size} ${sg.size === 1 ? 'person' : 'people'}</strong>
                            <span>${names}</span>
                        </div>
                        <div class="form-group">
                            <label>Choose date</label>
                            <input type="date"
                                id="${grp_splitPlannerDateInputId(i)}"
                                min="${grp_todayString()}"
                                value="${dateStr}"
                                onchange="grp_updateManualSubgroupDate(${i}, this.value)">
                        </div>
                        <label class="slots-label">Available times</label>
                        <div id="${grp_splitPlannerSlotsId(i)}" class="slots-grid grp-manual-slots">
                            <div class="loading-pulse">Loading times…</div>
                        </div>
                    </div>`;
            }).join('')}

            <div id="${grp_splitPlannerTimelineId()}"></div>

            <button type="button" class="btn-primary full" onclick="goToStep('screen-group-confirm')" id="grp_manualContinueBtn">
                Review Group Booking →
            </button>
        </div>
    `;

    const manualContinue = document.getElementById('grp_manualContinueBtn');
    if (manualContinue) {
        manualContinue.onclick = function() {
            const allSelected = grp_selectedPlan.subgroups.every(sg => sg.dateStr && sg.timeStr);
            if (!allSelected) {
                toast('Please choose a time for every sub-group first.', 'warning');
                return;
            }
            goToStep('screen-group-confirm');
        };
    }

    subgroups.forEach((_, i) => grp_loadManualSubgroupSlots(i, dateStr));
    grp_renderTimelinePreview();
}

// Override split option selection: no more forced auto-assignment.
// The lead chooses date/time for every sub-group.
window.grp_selectSplitOption = async function(splitStr, btn) {
    document.querySelectorAll('.group-option-card').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');

    const dateStr = document.getElementById('grp_date')?.value || grp_todayString();
    const split = splitStr.split('-').map(Number).filter(Boolean);

    grp_renderManualSplitPlanner(dateStr, split);
};

// Ensure old cache/older click handlers can still call this safely.
window.grp_startSplitPlanner = function(dateStr, split) {
    grp_renderManualSplitPlanner(dateStr || grp_todayString(), split || [grp_members.length]);
};



// ============================================================
// THURAYA GROUP BOOKING — CTA WIRING + POLISH PATCH
// Safe layer. Does not change Firestore booking logic.
// Fixes: "CHOOSE A TIME" CTA not moving to date/time step.
// ============================================================
(function () {
    function grp_stylePrimaryCTA(btn, active) {
        if (!btn) return;
        btn.className = 'btn-primary full';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.width = '100%';
        btn.style.minHeight = '56px';
        btn.style.borderRadius = '22px';
        btn.style.fontWeight = '900';
        btn.style.letterSpacing = '.14em';
        btn.style.textTransform = 'uppercase';
        btn.style.transition = 'transform .18s ease, box-shadow .18s ease, background .18s ease';
        btn.style.border = active ? '1px solid #050505' : '1px solid #CEC8BE';
        btn.style.background = active ? 'linear-gradient(180deg,#151515 0%,#050505 100%)' : '#CEC8BE';
        btn.style.color = active ? '#fff' : '#756F66';
        btn.style.boxShadow = active ? '0 18px 40px rgba(10,10,10,.24)' : 'none';
        btn.style.cursor = active ? 'pointer' : 'not-allowed';
        btn.style.opacity = '1';
    }

    function grp_allMembersReady() {
        try {
            return Array.isArray(grp_members)
                && grp_members.length > 0
                && grp_members.every(m => Array.isArray(m.selectedServices) && m.selectedServices.length > 0);
        } catch (e) {
            return false;
        }
    }

    function grp_wireChooseTimeCTA() {
        const btn = document.getElementById('grp_toDateTimeBtn');
        if (!btn) return;

        const ready = grp_allMembersReady();

        btn.textContent = 'Choose a Time →';
        btn.disabled = !ready;
        grp_stylePrimaryCTA(btn, ready);

        btn.onclick = function (e) {
            e.preventDefault();

            if (!grp_allMembersReady()) {
                if (typeof toast === 'function') {
                    toast('Please select services for every group member first.', 'warning');
                }
                return;
            }

            btn.textContent = 'Loading…';

            setTimeout(function () {
                if (typeof grp_goToDateTime === 'function') {
                    grp_goToDateTime();
                } else if (typeof goToStep === 'function') {
                    goToStep('screen-group-datetime');
                }
            }, 120);
        };
    }

    function grp_wireGroupTimeCTA() {
        const btn = document.getElementById('grp_toConfirmBtn');
        if (!btn) return;

        const hasTime = !!(document.getElementById('grp_time')?.value || '');
        btn.textContent = 'Review Group Booking →';
        btn.disabled = !hasTime;
        grp_stylePrimaryCTA(btn, hasTime);

        btn.onclick = function (e) {
            e.preventDefault();

            if (!document.getElementById('grp_time')?.value) {
                if (typeof toast === 'function') {
                    toast('Please choose a time for your group first.', 'warning');
                }
                return;
            }

            if (typeof goToStep === 'function') {
                goToStep('screen-group-confirm');
            }
        };
    }

    function grp_polishProgressText() {
        const progressEl = document.getElementById('grp_progressText');
        if (!progressEl) return;

        try {
            const done = grp_members.filter(m => m.selectedServices && m.selectedServices.length > 0).length;
            const total = grp_members.length || grp_groupSize || 0;
            progressEl.textContent = total ? `${done} of ${total} people ready` : '';
            progressEl.style.color = '#8A7136';
            progressEl.style.fontWeight = '800';
            progressEl.style.letterSpacing = '.06em';
            progressEl.style.textTransform = 'uppercase';
            progressEl.style.fontSize = '.76rem';
        } catch (e) {}
    }

    window.grp_polishAndWireCTAs = function () {
        grp_wireChooseTimeCTA();
        grp_wireGroupTimeCTA();
        grp_polishProgressText();
    };

    // Wrap existing progress updater if present, so CTA updates after each service selection.
    if (typeof grp_updateProgress === 'function' && !grp_updateProgress.__thurayaPatched) {
        const originalProgress = grp_updateProgress;
        grp_updateProgress = function () {
            originalProgress.apply(this, arguments);
            setTimeout(window.grp_polishAndWireCTAs, 30);
        };
        grp_updateProgress.__thurayaPatched = true;
    }

    // Wrap group date/time route to keep CTA state clean.
    if (typeof window.grp_goToDateTime === 'function' && !window.grp_goToDateTime.__thurayaPatched) {
        const originalGoToDateTime = window.grp_goToDateTime;
        window.grp_goToDateTime = function () {
            originalGoToDateTime.apply(this, arguments);
            setTimeout(window.grp_polishAndWireCTAs, 80);
        };
        window.grp_goToDateTime.__thurayaPatched = true;
    }

    // Sync on relevant clicks/changes.
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && (
            e.target.closest('#grp_serviceList') ||
            e.target.closest('#grp_personTabs') ||
            e.target.closest('#grp_slots') ||
            e.target.closest('#grp_toDateTimeBtn') ||
            e.target.closest('#grp_toConfirmBtn')
        )) {
            setTimeout(window.grp_polishAndWireCTAs, 60);
        }
    });

    document.addEventListener('change', function (e) {
        if (e.target && e.target.closest && (
            e.target.closest('#grp_serviceList') ||
            e.target.closest('#grp_date') ||
            e.target.closest('#grp_slots')
        )) {
            setTimeout(window.grp_polishAndWireCTAs, 80);
        }
    });

    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(window.grp_polishAndWireCTAs, 600);
    });
})();
// ============================================================
// END THURAYA GROUP BOOKING — CTA WIRING + POLISH PATCH
// ============================================================
