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
    if (progressEl) progressEl.textContent = `${done} of ${total} selected`;
    const currentDone = grp_members[grp_activeMember]?.selectedServices?.length > 0;
    const isLast = grp_activeMember === total - 1;
    if (nextBtn) nextBtn.style.display = (currentDone && !isLast) ? 'inline-flex' : 'none';
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
