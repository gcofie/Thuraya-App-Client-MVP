// ============================================================
//  THURAYA — CLIENT SELF-BOOKING   app.js
//  Same Firebase backend as the Staff OS.
//  Collections read:  Menu_Services, Users (techs),
//                     Appointments, Tax_Settings, Promos,
//                     Client_Users
//  Collections write: Client_Users, Appointments,
//                     Promos (usedCount)
// ============================================================

// ── Firebase config loaded from firebase-config.js ───────────
// Switches automatically between production and staging
const firebaseConfig = window.THURAYA_CONFIG;

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ── State ─────────────────────────────────────────────────
let bk_currentUser    = null;
let bk_clientProfile  = null;
let bk_isGuest        = false;
let bk_menuServices   = [];
let bk_liveTaxes      = [];
let bk_taxInclusive   = false;
let bk_techs          = [];
let bk_selectedDept   = 'Hand';
let bk_selectedServices = [];
let bk_activePromo    = null;
let bk_confirmedAppt  = null;
let bk_clientExperienceDocs = [];
let bk_clientExperienceFilter = 'all';
let bk_clientExperienceUnsub = null;
let _screenHistory    = ['screen-welcome'];
const todayStr        = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
})();



function bk_isAuthOrGuestReady() {
    return !!bk_currentUser || !!bk_clientProfile || bk_isGuest === true;
}

function bk_showFloatingSignOut(show) {
    const btn = document.getElementById('bkFloatingSignOut');
    if (!btn) return;
    btn.style.display = show ? 'block' : 'none';
}


function bk_moveStagingBannerToBottom() {
    const selectors = ['#stagingBanner', '.staging-banner', '[data-staging-banner]', '.env-banner'];
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            el.style.top = 'auto';
            el.style.bottom = '0';
            el.style.left = '0';
            el.style.right = '0';
            el.style.zIndex = '9998';
        });
    });
}

// ── Screen navigation ────────────────────────────────────

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(id);
    if (target) { target.style.display = 'flex'; requestAnimationFrame(() => target.classList.add('active')); }

    // Hide on entry/profile screens. Show after a client has entered the app.
    const hideOn = ['screen-welcome', 'screen-profile', 'screen-guest'];
    bk_showFloatingSignOut(!hideOn.includes(id) && bk_isAuthOrGuestReady());
    bk_moveStagingBannerToBottom();
}

function goToStep(id) {
    _screenHistory.push(id);
    showScreen(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.goBack = function() {
    if (_screenHistory.length > 1) {
        _screenHistory.pop();
        const prev = _screenHistory[_screenHistory.length - 1];
        showScreen(prev);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

// ── Toast ─────────────────────────────────────────────────

function toast(msg, type = 'info', duration = 4000) {
    let container = document.getElementById('bk_toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'bk_toastContainer';
        container.style.cssText = `
            position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
            z-index:99999; display:flex; flex-direction:column; gap:8px;
            pointer-events:none; width:90%; max-width:380px;`;
        document.body.appendChild(container);
    }
    const colors = { success:'#27ae60', error:'#c0392b', info:'#2980b9', warning:'#f39c12' };
    const t = document.createElement('div');
    t.style.cssText = `
        background:${colors[type]||colors.info}; color:white;
        padding:12px 16px; border-radius:10px; font-size:0.875rem;
        font-family:var(--font-sans); box-shadow:0 4px 16px rgba(0,0,0,0.18);
        pointer-events:auto; animation:toastIn 0.3s ease;`;
    t.textContent = msg;
    const style = document.createElement('style');
    style.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
    container.appendChild(t);
    if (duration > 0) setTimeout(() => t.remove(), duration);
}

// ── Button loading ────────────────────────────────────────

function setBtnLoading(btn, loading, originalText) {
    if (!btn) return;
    const textEl = btn.querySelector('.btn-text') || btn;
    if (loading) {
        btn.disabled = true;
        btn.classList.add('loading');
        if (textEl !== btn) textEl.textContent = '';
    } else {
        btn.disabled = false;
        btn.classList.remove('loading');
        if (textEl !== btn && originalText) textEl.textContent = originalText;
    }
}

// ── Tax engine ────────────────────────────────────────────

function applyTaxes(listedTotal) {
    if (!bk_liveTaxes.length || listedTotal === 0)
        return { basePrice: listedTotal, grandTotal: listedTotal, taxLines: [] };
    const combinedRate = bk_liveTaxes.reduce((s, t) => s + t.rate, 0) / 100;
    const basePrice  = bk_taxInclusive ? listedTotal / (1 + combinedRate) : listedTotal;
    const grandTotal = bk_taxInclusive ? listedTotal : listedTotal * (1 + combinedRate);
    const taxLines   = bk_liveTaxes.map(t => ({
        name: t.name, rate: t.rate,
        amount: basePrice * (t.rate / 100)
    }));
    return { basePrice, grandTotal, taxLines };
}

// ── Init & Auth ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    bk_showFloatingSignOut(false);
    bk_moveStagingBannerToBottom();
    const dateEl = document.getElementById('bk_date');
    if (dateEl) dateEl.min = todayStr;

    loadTaxConfig();
    loadMenu();
    startClientExperienceListener();

    auth.onAuthStateChanged(async user => {
        if (user) {
            bk_currentUser = user;
            try {
                const doc = await db.collection('Client_Users').doc(user.email.toLowerCase()).get();
                if (doc.exists) {
                    bk_clientProfile = doc.data();
                    // ── EDIT 1: send returning users to mode select, not straight to services ──
                    loadTechs();
                    startClientCareLibraryListener();
                    goToStep('screen-booking-mode');
                    const bar = document.getElementById('bk_stickyBar');
                    if (bar) bar.style.display = 'none';
                } else {
                    document.getElementById('prof_email').value = user.email || '';
                    document.getElementById('prof_name').value  = user.displayName || '';
                    goToStep('screen-profile');
                }
            } catch (e) {
                toast('Could not load your profile. Please try again.', 'error');
            }
        } else {
            bk_currentUser   = null;
            bk_clientProfile = null;
            bk_showFloatingSignOut(false);
            showScreen('screen-welcome');
        }
    });

    document.getElementById('btnGoogleSignIn').addEventListener('click', signInWithGoogle);
    document.getElementById('btnSaveProfile').addEventListener('click', saveProfile);
    document.getElementById('btnSaveGuest').addEventListener('click', saveGuestProfile);
});

async function signInWithGoogle() {
    const btn = document.getElementById('btnGoogleSignIn');
    setBtnLoading(btn, true);
    try {
        await auth.signInWithPopup(googleProvider);
    } catch (e) {
        setBtnLoading(btn, false, undefined);
        const errEl = document.getElementById('welcomeError');
        if (errEl) { errEl.textContent = 'Sign-in failed. Please try again.'; errEl.style.display = 'block'; }
    }
}

// ── Guest flow ────────────────────────────────────────────

window.continueAsGuest = function() {
    bk_isGuest = true;
    _screenHistory.push('screen-guest');
    showScreen('screen-guest');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function saveGuestProfile() {
    const btn    = document.getElementById('btnSaveGuest');
    const name   = document.getElementById('guest_name').value.trim();
    const phone  = document.getElementById('guest_phone').value.replace(/\D/g, '');
    const gender = document.getElementById('guest_gender').value;

    if (!name)               { toast('Please enter your full name.', 'warning'); return; }
    if (phone.length !== 10) { toast('Phone number must be 10 digits.', 'warning'); return; }

    setBtnLoading(btn, true, 'Continue to Book');
    try {
        bk_clientProfile = { name, phone, gender, email: '', isGuest: true };

        await db.collection('Clients').doc(phone).set({
            Forename:     name.split(' ')[0] || name,
            Surname:      name.split(' ').slice(1).join(' ') || '',
            Tel_Number:   phone,
            Gender:       gender,
            Last_Updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        loadTechs();
        startClientCareLibraryListener();
        // ── EDIT 2: guests go to mode select after saving details ──
        goToStep('screen-booking-mode');
        const bar2 = document.getElementById('bk_stickyBar');
        if (bar2) bar2.style.display = 'none';
    } catch (e) {
        toast('Could not save details: ' + e.message, 'error');
    } finally {
        setBtnLoading(btn, false, 'Continue to Book');
    }
}

// ── Profile Setup ─────────────────────────────────────────

async function saveProfile() {
    const btn    = document.getElementById('btnSaveProfile');
    const name   = document.getElementById('prof_name').value.trim();
    const phone  = document.getElementById('prof_phone').value.replace(/\D/g, '');
    const gender = document.getElementById('prof_gender').value;
    const email  = bk_currentUser?.email?.toLowerCase() || '';

    if (!name)          { toast('Please enter your full name.', 'warning'); return; }
    if (phone.length !== 10) { toast('Phone number must be 10 digits.', 'warning'); return; }

    setBtnLoading(btn, true, 'Save & Continue');
    try {
        const profile = {
            name, phone, gender, email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('Client_Users').doc(email).set(profile, { merge: true });
        await db.collection('Clients').doc(phone).set({
            Forename:    name.split(' ')[0] || name,
            Surname:     name.split(' ').slice(1).join(' ') || '',
            Tel_Number:  phone,
            Email:       email,
            Gender:      gender,
            Last_Updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        bk_clientProfile = profile;
        loadTechs();
        startClientCareLibraryListener();
        // ── EDIT 3: new users go to mode select after profile save ──
        goToStep('screen-booking-mode');
    } catch (e) {
        toast('Could not save profile: ' + e.message, 'error');
    } finally {
        setBtnLoading(btn, false, 'Save & Continue');
    }
}

// ── Load Tax Config ───────────────────────────────────────

function loadTaxConfig() {
    db.collection('Tax_Settings').doc('current_taxes').onSnapshot(doc => {
        const data       = doc.exists ? doc.data() : {};
        bk_liveTaxes     = data.rates     || [];
        bk_taxInclusive  = data.inclusive === true;
    });
}

// ── Load Menu ────────────────────────────────────────────

const CATEGORY_ALIASES = {
    'I. HAND THERAPIES':  'I. HAND THERAPY RITUALS',
    'I. HAND THERAPIES ': 'I. HAND THERAPY RITUALS',
};
const TYPE_ORDER = { radio: 0, checkbox: 1, counter: 2 };

function loadMenu() {
    db.collection('Menu_Services').onSnapshot(snap => {
        const container = document.getElementById('bk_serviceMenu');
        if (snap.empty) {
            if (container) container.innerHTML =
                '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No services available.</p>';
            return;
        }
        let services = [];
        snap.forEach(doc => services.push({ id: doc.id, ...doc.data() }));
        services.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
        services = services.filter(s => !s.status || s.status === 'Active');
        bk_menuServices = services;
        renderMenuForDept(bk_selectedDept);
    }, err => {
        const c = document.getElementById('bk_serviceMenu');
        if (c) c.innerHTML =
            `<p style="color:var(--error);text-align:center;padding:20px;">Could not load menu: ${err.message}</p>`;
    });
}

function renderMenuForDept(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    const dbData = { Hand: {}, Foot: {} };
    bk_menuServices.forEach(s => {
        let cat = ((s.category || 'Uncategorized').trim().replace(/\s+/g, ' '));
        cat = CATEGORY_ALIASES[cat] ?? CATEGORY_ALIASES[cat.toUpperCase()] ?? cat;
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

    Object.values(dbData).forEach(dObj =>
        Object.values(dObj).forEach(arr =>
            arr.sort((a, b) => (TYPE_ORDER[a.inputType] ?? 1) - (TYPE_ORDER[b.inputType] ?? 1))
        )
    );

    const numRe = /^(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)\./i;
    const sortedCats = Object.keys(dbData[dept] || {}).sort((a, b) => {
        const aU = a.trim().toUpperCase(), bU = b.trim().toUpperCase();
        const aNum = numRe.test(aU), bNum = numRe.test(bU);
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return  1;
        const aR = (dbData[dept][a][0]?.inputType || 'checkbox') === 'radio';
        const bR = (dbData[dept][b][0]?.inputType || 'checkbox') === 'radio';
        if (aR && !bR) return -1;
        if (!aR && bR) return  1;
        return aU.localeCompare(bU, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (!sortedCats.length) {
        container.innerHTML =
            '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No services available for this category.</p>';
        updateBreakdown();
        return;
    }

    let html = '';
    sortedCats.forEach(cat => {
        const items   = dbData[dept][cat];
        const singles = items.filter(s => (s.inputType || 'radio') === 'radio');
        const multis  = items.filter(s => (s.inputType || 'radio') !== 'radio');

        html += `<div class="menu-section"><div class="menu-section-heading">${cat}</div>`;

        if (singles.length && multis.length) {
            html += `<div class="menu-subgroup-label">Choose your ritual <span style="color:#bbb;font-size:0.68rem;text-transform:none;letter-spacing:0;">— select one</span></div>`;
            singles.forEach(s => { html += _buildCard(s, dept); });
            html += `<div class="menu-subgroup-divider"></div>`;
            html += `<div class="menu-subgroup-label">Enhancements &amp; Add-ons <span style="color:#bbb;font-size:0.68rem;text-transform:none;letter-spacing:0;">— select any</span></div>`;
            multis.forEach(s => { html += _buildCard(s, dept); });
        } else {
            items.forEach(s => { html += _buildCard(s, dept); });
        }

        html += `</div>`;
    });

    container.innerHTML = html;

    bk_selectedServices.forEach(sel => {
        const cb  = document.getElementById('bk_cb_'  + sel.id);
        const qty = document.getElementById('bk_qty_' + sel.id);
        if (cb)  { cb.checked = true; cb.closest('.service-card')?.classList.add('selected'); }
        if (qty) { qty.value  = sel.qty || 1; }
    });
    updateBreakdown();
}

function _buildCard(s, dept) {
    const type     = s.inputType || 'radio';
    const name     = s.name      || 'Service';
    const dur      = Number(s.duration) || 0;
    const price    = Number(s.price)    || 0;
    const descHtml = s.desc ? `<div class="service-card-desc">${s.desc}</div>` : '';
    const tagHtml  = (s.tag && s.tag !== 'None') ? `<span class="hl-tag">${s.tag}</span>` : '';
    const priceTag = `<span class="service-price-pill">${dur > 0 ? dur + ' mins &nbsp;|&nbsp; ' : ''}${price} GHC</span>`;

    if (type === 'counter') {
        return `
            <div class="service-card" style="align-items:center;">
                <div class="service-card-body" style="pointer-events:none;">
                    <div class="service-card-name">${name} ${tagHtml}</div>
                    ${descHtml}${priceTag}
                </div>
                <div class="counter-box">
                    <button class="counter-btn" onclick="bk_updateCounter('${s.id}',${price},${dur},'${name}',-1)">−</button>
                    <input type="number" id="bk_qty_${s.id}" value="0" min="0" readonly
                        style="width:44px;height:36px;text-align:center;padding:4px;font-weight:700;border:1px solid var(--border);border-radius:6px;">
                    <button class="counter-btn" onclick="bk_updateCounter('${s.id}',${price},${dur},'${name}',1)">+</button>
                </div>
            </div>`;
    }

    const groupName = type === 'radio' ? `bk_base_${dept}` : `bk_cb_${s.id}`;
    const inputEl   = type === 'radio'
        ? `<input type="radio"    name="${groupName}" id="bk_cb_${s.id}"
               style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;">`
        : `<input type="checkbox"                    id="bk_cb_${s.id}"
               style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;">`;

    return `
        <div class="service-card" onclick="bk_toggleCard(event,this,'${s.id}','${type}','${groupName}',${price},${dur},'${name}')">
            ${inputEl}
            <div class="service-card-body">
                <div class="service-card-name">${name} ${tagHtml}</div>
                ${descHtml}${priceTag}
            </div>
        </div>`;
}

window.bk_toggleCard = function(event, card, id, type, groupName, price, dur, name) {
    event.preventDefault();
    const input = document.getElementById('bk_cb_' + id);
    if (!input) return;

    if (type === 'radio') {
        document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
            r.checked = false;
            r.closest('.service-card')?.classList.remove('selected');
        });
        bk_selectedServices = bk_selectedServices.filter(s => {
            const el = document.getElementById('bk_cb_' + s.id);
            if (!el) return true;
            return el.getAttribute('name') !== groupName && !(el.type === 'radio' && el.name === groupName);
        });
        const wasSelected = input.checked;
        if (!wasSelected) {
            input.checked = true;
            card.classList.add('selected');
            bk_selectedServices.push({ id, type, price, dur, name, qty: 1 });
        }
    } else {
        input.checked = !input.checked;
        card.classList.toggle('selected', input.checked);
        if (input.checked) {
            bk_selectedServices.push({ id, type, price, dur, name, qty: 1 });
        } else {
            bk_selectedServices = bk_selectedServices.filter(s => s.id !== id);
        }
    }
    updateBreakdown();
};

window.bk_updateCounter = function(id, price, dur, name, delta) {
    const input = document.getElementById('bk_qty_' + id);
    if (!input) return;
    let val = Math.max(0, (parseInt(input.value) || 0) + delta);
    input.value = val;
    bk_selectedServices = bk_selectedServices.filter(s => s.id !== id);
    if (val > 0) bk_selectedServices.push({ id, type: 'counter', price, dur, name, qty: val });
    updateBreakdown();
};

function updateBreakdown() {
    let totalMins = 0, subtotal = 0;
    let rowsHtml = '';

    bk_selectedServices.forEach(s => {
        const lineTotal = s.price * (s.qty || 1);
        const lineMins  = s.dur   * (s.qty || 1);
        subtotal  += lineTotal;
        totalMins += lineMins;
        rowsHtml  += `<div class="breakdown-row">
            <span>${s.name}${s.qty > 1 ? ' <span style="color:var(--text-muted);font-size:0.78rem;">(x'+s.qty+')</span>' : ''}</span>
            <span style="font-weight:600;">${lineTotal.toFixed(2)} GHC</span>
        </div>`;
    });

    const { basePrice, grandTotal, taxLines } = applyTaxes(subtotal);

    let taxHtml = '';
    if (taxLines.length && subtotal > 0) {
        taxHtml += `<div class="breakdown-row" style="font-size:0.82rem;color:var(--primary);font-weight:600;border-top:1px dashed var(--border);padding-top:5px;margin-top:5px;">
            <span>Subtotal (ex. tax)</span><span>${basePrice.toFixed(2)} GHC</span></div>`;
        taxLines.forEach(l => {
            taxHtml += `<div class="breakdown-row" style="font-size:0.82rem;color:var(--primary);font-weight:600;">
                <span>+ ${l.name} (${l.rate}%)</span><span>${l.amount.toFixed(2)} GHC</span></div>`;
        });
    }

    const stickyBar   = document.getElementById('bk_stickyBar');
    const stickyEmpty = document.getElementById('bk_stickyEmpty');
    const stickyFull  = document.getElementById('bk_stickyFull');
    const brkList     = document.getElementById('bk_breakdownList');
    const brkTax      = document.getElementById('bk_taxBreakdown');
    const durEl       = document.getElementById('bk_totalDuration');
    const costEl      = document.getElementById('bk_totalCost');
    const nextBtn     = document.getElementById('btnToTech');

    const onServicesScreen = document.getElementById('screen-services')?.classList.contains('active');
    if (stickyBar) stickyBar.style.display = onServicesScreen ? 'block' : 'none';

    if (subtotal > 0) {
        if (brkList)     brkList.innerHTML    = rowsHtml;
        if (brkTax)      brkTax.innerHTML     = taxHtml;
        if (durEl)       durEl.textContent    = totalMins;
        if (costEl)      costEl.textContent   = grandTotal.toFixed(2);
        if (stickyEmpty) stickyEmpty.style.display = 'none';
        if (stickyFull)  stickyFull.style.display  = 'block';
        if (nextBtn)     nextBtn.disabled = false;
    } else {
        if (brkList)     brkList.innerHTML    = '';
        if (brkTax)      brkTax.innerHTML     = '';
        if (durEl)       durEl.textContent    = '0';
        if (costEl)      costEl.textContent   = '0.00';
        if (stickyEmpty) stickyEmpty.style.display = 'block';
        if (stickyFull)  stickyFull.style.display  = 'none';
        if (nextBtn)     nextBtn.disabled = true;
    }
}

window.bk_clearAllSelections = function() {
    bk_selectedServices = [];
    document.querySelectorAll('#bk_serviceMenu input[type="radio"], #bk_serviceMenu input[type="checkbox"]')
        .forEach(el => { el.checked = false; });
    document.querySelectorAll('#bk_serviceMenu .service-card')
        .forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('#bk_serviceMenu input[type="number"]')
        .forEach(el => { el.value = 0; });
    updateBreakdown();
};

window.switchDept = function(dept, btn) {
    bk_selectedDept = dept;
    document.querySelectorAll('.dept-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderMenuForDept(dept);
};

// ── Load Technicians ──────────────────────────────────────

async function loadTechs() {
    try {
        // Phase 5.5E Availability Alignment:
        // Do NOT pre-filter technicians by today's Calendar_Blocks here.
        // Availability depends on the booking date selected by the client, not only today.
        // availability.js handles date-specific blocks, leave, schedules and appointment conflicts.
        const usersSnap = await db.collection('Users').get();

        bk_techs = [];
        usersSnap.forEach(doc => {
            const d = doc.data();
            const roles = (Array.isArray(d.roles) ? d.roles : [d.role || '']).map(r => (r || '').toLowerCase());
            const isTech = roles.some(r => r.includes('tech'));
            if (!isTech) return;

            // Hide techs marked invisible to clients.
            if (d.visibleToClients === false) return;

            bk_techs.push({ email: doc.id, name: d.name || doc.id });
        });

        console.log('Client booking techs loaded:', bk_techs.length, bk_techs.map(t => t.name || t.email));
    } catch (e) {
        console.error('Client booking loadTechs failed:', e);
        bk_techs = [];
    }
}

// ── Technician selection ──────────────────────────────────

window.selectTechOption = function(option) {
    const anyCard  = document.getElementById('techCard_any');
    const specCard = document.getElementById('techCard_specific');
    const anyCheck = document.getElementById('techCheck_any');
    const specCheck= document.getElementById('techCheck_specific');
    const panel    = document.getElementById('techSelectPanel');
    const modeEl   = document.getElementById('bk_techMode');

    if (option === 'any') {
        anyCard.classList.add('selected');
        specCard.classList.remove('selected');
        anyCheck.style.opacity  = '1';
        specCheck.style.opacity = '0';
        panel.style.display = 'none';
        modeEl.value = 'any';
        document.getElementById('bk_techEmail').value = '';
        document.getElementById('bk_techName').value  = '';
    } else {
        anyCard.classList.remove('selected');
        specCard.classList.add('selected');
        anyCheck.style.opacity  = '0';
        specCheck.style.opacity = '1';
        panel.style.display = 'block';
        modeEl.value = 'specific';
        renderTechList();
    }
};

function renderTechList() {
    const listEl = document.getElementById('bk_techList');
    if (!bk_techs.length) {
        listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:16px;">No technicians available.</p>';
        return;
    }
    listEl.innerHTML = bk_techs.map(t => {
        const initial = (t.name || '?')[0].toUpperCase();
        const selectedEmail = document.getElementById('bk_techEmail').value;
        const isSelected = selectedEmail === t.email;
        return `
            <div class="tech-item ${isSelected ? 'selected' : ''}" onclick="selectSpecificTech('${t.email}', '${t.name}')">
                <div class="tech-avatar">${initial}</div>
                <span>${t.name}</span>
                ${isSelected ? '<span style="margin-left:auto;color:var(--gold);font-weight:700;">✓</span>' : ''}
            </div>`;
    }).join('');
}

window.selectSpecificTech = function(email, name) {
    document.getElementById('bk_techEmail').value = email;
    document.getElementById('bk_techName').value  = name;
    renderTechList();
};

// ── Date & Time Slots ─────────────────────────────────────

window.bk_generateSlots = async function() {
    const date    = document.getElementById('bk_date').value;
    const timeEl  = document.getElementById('bk_time');
    const slotsEl = document.getElementById('bk_slots');
    const container = document.getElementById('bk_slotsContainer');
    const nextBtn = document.getElementById('btnToConfirm');

    timeEl.value = '';
    nextBtn.disabled = true;

    if (!date) { container.style.display = 'none'; return; }
    if (date < todayStr) {
        container.style.display = 'block';
        slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;">Cannot book in the past.</p>';
        return;
    }

    const totalMins = bk_selectedServices.reduce((s, x) => s + (x.dur * (x.qty || 1)), 0);
    if (totalMins === 0) {
        container.style.display = 'none';
        toast('Select at least one service first.', 'warning');
        return;
    }

    const mode = document.getElementById('bk_techMode').value;
    const specificEmail = document.getElementById('bk_techEmail').value;
    const techsToCheck = mode === 'specific' && specificEmail
        ? [specificEmail]
        : bk_techs.map(t => t.email);

    if (!techsToCheck.length) {
        container.style.display = 'none';
        toast('No technicians available for this date.', 'warning');
        return;
    }

    container.style.display = 'block';
    slotsEl.innerHTML = '<div class="loading-pulse">Checking availability...</div>';

    try {
        const snap = await db.collection('Appointments')
            .where('dateString', '==', date)
            .where('status', 'in', ['Scheduled', 'Arrived'])
            .get();

        const busyByTech = {};
        snap.forEach(doc => {
            const a = doc.data();
            if (!busyByTech[a.assignedTechEmail]) busyByTech[a.assignedTechEmail] = [];
            busyByTech[a.assignedTechEmail].push({
                start: timeToMins(a.timeString),
                end:   timeToMins(a.timeString) + parseInt(a.bookedDuration || 0)
            });
        });

        const openTime = 8 * 60, closeTime = 20 * 60, interval = 30;
        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();
        const isToday = date === todayStr;

        const slotMap = {};
        for (let t = openTime; t + totalMins <= closeTime; t += interval) {
            if (isToday && t <= curMins) continue;
            const slotEnd = t + totalMins;
            techsToCheck.forEach(email => {
                const busy = busyByTech[email] || [];
                const free = busy.every(b => slotEnd <= b.start || t >= b.end);
                if (free) {
                    if (!slotMap[t]) slotMap[t] = [];
                    slotMap[t].push(email);
                }
            });
        }

        const slots = Object.keys(slotMap).map(Number).sort((a, b) => a - b);
        if (!slots.length) {
            slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;">No available times for this date. Try a different date.</p>';
            return;
        }

        slotsEl.innerHTML = slots.map(t => {
            const hrs  = Math.floor(t / 60), mins = t % 60;
            const ampm = hrs >= 12 ? 'PM' : 'AM';
            const h12  = hrs % 12 || 12;
            const mm   = String(mins).padStart(2, '0');
            const t24  = `${String(hrs).padStart(2,'0')}:${mm}`;
            const techList = JSON.stringify(slotMap[t]);
            return `<button class="slot-btn" data-time="${t24}" data-techs='${techList}'
                        onclick="bk_selectSlot('${t24}', this)">${h12}:${mm} ${ampm}</button>`;
        }).join('');

    } catch (e) {
        slotsEl.innerHTML = `<p style="color:var(--error);font-size:0.875rem;">Error loading slots: ${e.message}</p>`;
    }
};

function timeToMins(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
}

window.bk_selectSlot = function(time, btn) {
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('bk_time').value = time;

    const mode = document.getElementById('bk_techMode').value;
    if (mode === 'any') {
        try {
            const available = JSON.parse(btn.getAttribute('data-techs') || '[]');
            if (available.length) {
                const assignedEmail = available[0];
                const tech = bk_techs.find(t => t.email === assignedEmail);
                document.getElementById('bk_techEmail').value = assignedEmail;
                document.getElementById('bk_techName').value  = tech?.name || assignedEmail;
            }
        } catch (e) { /* silent */ }
    }

    document.getElementById('btnToConfirm').disabled = false;
};

// ── goToStep override — confirm screen + sticky bar ───────
// NOTE: group-booking.js further wraps this to handle group confirm screen
window.goToStep = function(id) {
    if (id === 'screen-confirm') populateConfirmScreen();
    // Call the base navigation
    _screenHistory.push(id);
    showScreen(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Show sticky bar only on solo services screen
    const bar = document.getElementById('bk_stickyBar');
    if (bar) bar.style.display = (id === 'screen-services') ? 'block' : 'none';
    if (id === 'screen-services') updateBreakdown();
};

function populateConfirmScreen() {
    const services  = bk_selectedServices.map(s => `${s.name}${s.qty > 1 ? ' (x'+s.qty+')' : ''}`).join(', ');
    const techEmail = document.getElementById('bk_techEmail').value;
    const techName  = document.getElementById('bk_techName').value  || (techEmail ? techEmail : 'To be assigned');
    const date      = document.getElementById('bk_date').value;
    const time      = document.getElementById('bk_time').value;
    const totalMins = bk_selectedServices.reduce((s, x) => s + (x.dur * (x.qty || 1)), 0);
    const subtotal  = bk_selectedServices.reduce((s, x) => s + (x.price * (x.qty || 1)), 0);
    const { basePrice, grandTotal, taxLines } = applyTaxes(subtotal);

    let dateFormatted = date;
    try { dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); } catch(e) {}

    let timeFormatted = time;
    try {
        const [h, m] = time.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        timeFormatted = `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
    } catch (e) {}

    document.getElementById('conf_services').textContent = services || '—';
    document.getElementById('conf_tech').textContent     = techName;
    document.getElementById('conf_date').textContent     = dateFormatted;
    document.getElementById('conf_time').textContent     = timeFormatted;
    document.getElementById('conf_duration').textContent = totalMins + ' mins';

    let priceHtml = '';
    if (taxLines.length) {
        priceHtml += `<div class="confirm-row"><span class="confirm-label">Subtotal (ex. tax)</span><span class="confirm-value">${basePrice.toFixed(2)} GHC</span></div>`;
        taxLines.forEach(l => {
            priceHtml += `<div class="confirm-row"><span class="confirm-label">+ ${l.name} (${l.rate}%)</span><span class="confirm-value">${l.amount.toFixed(2)} GHC</span></div>`;
        });
    }

    let finalTotal = grandTotal;
    if (bk_activePromo) {
        const disc = bk_activePromo.type === 'percent'
            ? grandTotal * (bk_activePromo.value / 100)
            : Math.min(bk_activePromo.value, grandTotal);
        finalTotal = Math.max(0, grandTotal - disc);
        priceHtml += `<div class="confirm-row"><span class="confirm-label" style="color:var(--success);">🎟 ${bk_activePromo.code}</span><span class="confirm-value" style="color:var(--success);">−${disc.toFixed(2)} GHC</span></div>`;
        document.getElementById('bk_discountAmount').value = disc.toFixed(2);
    }

    document.getElementById('conf_priceBreakdown').innerHTML = priceHtml;
    document.getElementById('conf_total').textContent = finalTotal.toFixed(2) + ' GHC';
}

// ── Promo code ────────────────────────────────────────────

window.bk_togglePromoInput = function() {
    const panel  = document.getElementById('promoInputPanel');
    const btn    = document.getElementById('btnTogglePromo');
    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
        panel.style.display = 'none';
        btn.textContent = '🎟 I have a promo code';
        bk_activePromo = null;
        document.getElementById('bk_promoCode').value    = '';
        document.getElementById('bk_promoId').value      = '';
        document.getElementById('bk_promoCodeVal').value = '';
        document.getElementById('bk_discountAmount').value = '0';
        const statusEl = document.getElementById('bk_promoStatus');
        if (statusEl) statusEl.style.display = 'none';
        populateConfirmScreen();
    } else {
        panel.style.display = 'block';
        btn.textContent = '✕ Remove promo code';
        document.getElementById('bk_promoCode').focus();
    }
};

window.bk_applyPromo = async function() {
    const btn  = document.getElementById('btnApplyBkPromo');
    const code = (document.getElementById('bk_promoCode')?.value || '').trim().toUpperCase();
    if (!code) { bk_showPromoStatus('Enter a promo code first.', false); return; }

    setBtnLoading(btn, true);
    try {
        const snap = await db.collection('Promos')
            .where('code', '==', code)
            .limit(1)
            .get();

        if (snap.empty) { bk_showPromoStatus('Code not found. Please check and try again.', false); return; }

        const doc   = snap.docs[0];
        const promo = doc.data();

        const isActive = promo.active === true || promo.active === 'true';
        if (!isActive) { bk_showPromoStatus('This code is no longer active.', false); return; }

        if (promo.expiresAt) {
            const exp = promo.expiresAt.toDate ? promo.expiresAt.toDate() : new Date(promo.expiresAt);
            if (exp < new Date()) { bk_showPromoStatus('This code has expired.', false); return; }
        }

        if (promo.maxUses && (promo.usedCount || 0) >= promo.maxUses) {
            bk_showPromoStatus('This code has reached its usage limit.', false); return;
        }

        bk_activePromo = { id: doc.id, code: promo.code, type: promo.type || 'percent', value: parseFloat(promo.value || 0) };
        document.getElementById('bk_promoId').value      = doc.id;
        document.getElementById('bk_promoCodeVal').value = promo.code;

        const label = promo.type === 'percent' ? `${promo.value}% off` : `${parseFloat(promo.value).toFixed(2)} GHC off`;
        bk_showPromoStatus(`✓ "${promo.description || code}" applied — ${label}`, true);
        populateConfirmScreen();

    } catch (e) {
        bk_showPromoStatus('Error: ' + e.message, false);
    } finally {
        setBtnLoading(btn, false);
    }
};

function bk_showPromoStatus(msg, success) {
    const el = document.getElementById('bk_promoStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = success ? 'var(--success)' : 'var(--error)';
    el.style.display = 'block';
}

// ── Confirm Booking ───────────────────────────────────────

window.bk_confirmBooking = async function() {
    const btn = document.getElementById('btnConfirmBooking');

    if (!bk_clientProfile) { toast('Please complete your details before booking.', 'error'); return; }

    const techEmail = document.getElementById('bk_techEmail').value;
    const techName  = document.getElementById('bk_techName').value  || 'To be assigned';
    const date      = document.getElementById('bk_date').value;
    const time      = document.getElementById('bk_time').value;

    if (!date || !time) { toast('Please select a date and time.', 'warning'); return; }
    if (!bk_selectedServices.length) { toast('Please select at least one service.', 'warning'); return; }

    const services  = bk_selectedServices.map(s => `${s.name}${s.qty > 1 ? ' (x'+s.qty+')' : ''}`).join(', ');
    const totalMins = bk_selectedServices.reduce((s, x) => s + (x.dur * (x.qty || 1)), 0);
    const subtotal  = bk_selectedServices.reduce((s, x) => s + (x.price * (x.qty || 1)), 0);
    const { basePrice, grandTotal, taxLines } = applyTaxes(subtotal);
    const discountAmount = parseFloat(document.getElementById('bk_discountAmount').value || 0);
    const finalTotal = Math.max(0, grandTotal - discountAmount);

    setBtnLoading(btn, true, 'Confirm Booking');
    try {
        const batch = db.batch();
        const apptRef = db.collection('Appointments').doc();
        const apptData = {
            clientPhone:         bk_clientProfile.phone  || '',
            clientName:          bk_clientProfile.name   || '',
            clientEmail:         bk_isGuest ? '' : (bk_currentUser?.email || ''),
            assignedTechEmail:   techEmail,
            assignedTechName:    techName,
            bookedService:       services,
            bookedDuration:      totalMins,
            bookedPrice:         basePrice,
            grandTotal:          finalTotal,
            taxBreakdown:        JSON.stringify(taxLines.map(l => ({ name:l.name, rate:l.rate, amount:l.amount }))),
            promoCode:           document.getElementById('bk_promoCodeVal').value || '',
            promoId:             document.getElementById('bk_promoId').value      || '',
            discountAmount,
            originalGrandTotal:  grandTotal,
            dateString:          date,
            timeString:          time,
            status:              'Scheduled',
            source:              'client-booking',
            bookedBy:            bk_isGuest ? ('guest:' + (bk_clientProfile.phone || '')) : (bk_currentUser?.email || ''),
            createdAt:           firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt:           firebase.firestore.FieldValue.serverTimestamp()
        };
        batch.set(apptRef, apptData);

        const promoId = document.getElementById('bk_promoId').value;
        if (promoId) {
            batch.update(db.collection('Promos').doc(promoId), {
                usedCount: firebase.firestore.FieldValue.increment(1)
            });
        }

        await batch.commit();
        bk_confirmedAppt = { ...apptData, id: apptRef.id };

        populateSuccessScreen(bk_confirmedAppt);

        const viewBtn = document.querySelector('#screen-success .btn-outline');
        if (viewBtn) viewBtn.style.display = bk_isGuest ? 'none' : '';

        _screenHistory = ['screen-welcome', 'screen-booking-mode'];
        goToStep('screen-success');

    } catch (e) {
        toast('Booking failed: ' + e.message, 'error');
    } finally {
        setBtnLoading(btn, false, 'Confirm Booking');
    }
};

function populateSuccessScreen(appt) {
    document.getElementById('suc_services').textContent = appt.bookedService || '—';
    const techDisplay = appt.assignedTechName && appt.assignedTechEmail ? appt.assignedTechName : 'To be assigned';
    document.getElementById('suc_tech').textContent = techDisplay;
    let dateFormatted = appt.dateString;
    try { dateFormatted = new Date(appt.dateString + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' }); } catch(e) {}
    let timeFormatted = appt.timeString;
    try {
        const [h, m] = appt.timeString.split(':').map(Number);
        timeFormatted = `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    } catch(e) {}
    document.getElementById('suc_datetime').textContent = `${dateFormatted} at ${timeFormatted}`;
    document.getElementById('suc_total').textContent    = parseFloat(appt.grandTotal).toFixed(2) + ' GHC';
}

// ── Add to Calendar ───────────────────────────────────────

window.bk_addToCalendar = function() {
    if (!bk_confirmedAppt) return;
    const a = bk_confirmedAppt;
    const [year, month, day] = a.dateString.split('-').map(Number);
    const [h, m] = a.timeString.split(':').map(Number);
    const start = new Date(year, month - 1, day, h, m);
    const end   = new Date(start.getTime() + a.bookedDuration * 60000);
    const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE`
        + `&text=${encodeURIComponent('THURAYA — ' + a.bookedService)}`
        + `&dates=${fmt(start)}/${fmt(end)}`
        + `&details=${encodeURIComponent('Your Thuraya appointment. See you soon!')}`;
    window.open(url, '_blank');
};

// ── View My Bookings ──────────────────────────────────────

window.bk_viewMyBookings = async function() {
    goToStep('screen-mybookings');
    const listEl = document.getElementById('myBookingsList');
    if (!bk_currentUser) {
        listEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">Please sign in to view bookings.</p>';
        return;
    }

    listEl.innerHTML = '<div class="loading-pulse">Loading your bookings...</div>';

    // Single where clause only — no orderBy — avoids composite index requirement.
    // Sort client-side by dateString + timeString instead.
    try {
        const snap = await db.collection('Appointments')
            .where('clientEmail', '==', bk_currentUser.email)
            .get();

        if (snap.empty) {
            listEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No bookings yet.</p>';
            return;
        }

        // Client-friendly labels.
        // Firestore still keeps the operational staff status internally.
        // The client app only translates the wording for a better customer experience.
        const statusLabels = {
            'Scheduled':         { label: 'Confirmed',   cls: 'status-scheduled' },
            'Arrived':           { label: 'Checked In',  cls: 'status-arrived'   },
            'In Progress':       { label: 'In Service',  cls: 'status-arrived'   },
            'Ready for Payment': { label: 'Wrapping Up', cls: 'status-arrived'   },
            'Closed':            { label: 'Completed',   cls: 'status-closed'    },
            'Completed':         { label: 'Completed',   cls: 'status-closed'    },
            'Cancelled':         { label: 'Cancelled',   cls: 'status-cancelled' },
            'No Show':           { label: 'Missed',      cls: 'status-noshow'    },
        };

        // Build array and sort newest first by date then time
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
        docs.sort((a, b) => {
            const aKey = (a.dateString || '') + (a.timeString || '');
            const bKey = (b.dateString || '') + (b.timeString || '');
            return bKey.localeCompare(aKey);
        });

        const html = docs.slice(0, 20).map(a => {
            let dateFormatted = a.dateString || '—';
            try { dateFormatted = new Date(a.dateString + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); } catch(e) {}
            let timeFormatted = a.timeString || '';
            try {
                const [hh, mm] = a.timeString.split(':').map(Number);
                timeFormatted = `${hh % 12 || 12}:${String(mm).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
            } catch(e) {}
            const s = statusLabels[a.status] || { label: a.status || 'Unknown', cls: 'status-scheduled' };
            const isGroup = a.isGroupBooking ? ' 👥' : '';
            return `
                <div class="booking-item">
                    <div class="booking-item-header">
                        <strong>${dateFormatted} · ${timeFormatted}</strong>
                        <span class="booking-status-badge ${s.cls}">${s.label}</span>
                    </div>
                    <p>💅 ${a.bookedService || 'N/A'}${isGroup}</p>
                    <p>👩‍🔧 ${a.assignedTechName || 'To be assigned'} · ${parseFloat(a.grandTotal || 0).toFixed(2)} GHC</p>
                </div>`;
        }).join('');

        listEl.innerHTML = html || '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No bookings yet.</p>';

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error);text-align:center;padding:24px 0;">Could not load bookings: ${e.message}</p>`;
    }
};

// ── EDIT 4: bk_bookAgain goes to mode select ─────────────
window.bk_bookAgain = function() {
    bk_selectedServices = [];
    bk_activePromo      = null;
    bk_confirmedAppt    = null;
    const timeEl = document.getElementById('bk_time');
    const dateEl = document.getElementById('bk_date');
    if (timeEl) timeEl.value = '';
    if (dateEl) dateEl.value = '';
    const slotsContainer = document.getElementById('bk_slotsContainer');
    if (slotsContainer) slotsContainer.style.display = 'none';
    selectTechOption('any');
    bk_clearAllSelections();
    _screenHistory = ['screen-welcome'];
    goToStep('screen-booking-mode');
};

window.bk_exitBooking = function() {
    bk_selectedServices = [];
    bk_activePromo      = null;
    bk_confirmedAppt    = null;
    const timeEl = document.getElementById('bk_time');
    const dateEl = document.getElementById('bk_date');
    if (timeEl) timeEl.value = '';
    if (dateEl) dateEl.value = '';
    bk_clearAllSelections();
    const bar = document.getElementById('bk_stickyBar');
    if (bar) bar.style.display = 'none';
    _screenHistory = ['screen-welcome'];
    showScreen('screen-welcome');
};




// ── Sign Out / Session Reset ──────────────────────────────
window.bk_signOut = async function() {
    try {
        if (typeof bk_clientExperienceUnsub === 'function') {
            bk_clientExperienceUnsub();
            bk_clientExperienceUnsub = null;
        }
    } catch(e) {
        console.warn('Client Experience listener cleanup skipped', e);
    }

    try {
        if (auth && auth.currentUser) {
            await auth.signOut();
        }

        bk_currentUser = null;
        bk_clientProfile = null;
        bk_isGuest = false;
        bk_selectedServices = [];
        bk_activePromo = null;
        bk_confirmedAppt = null;
        bk_clientExperienceDocs = [];
        bk_clientExperienceFilter = 'all';
        _screenHistory = ['screen-welcome'];

        try { bk_clearAllSelections(); } catch(e) {}
        try { selectTechOption('any'); } catch(e) {}

        const fieldsToClear = [
            'guest_name','guest_phone','guest_gender',
            'prof_name','prof_phone','prof_gender','prof_email',
            'bk_date','bk_time','bk_techEmail','bk_techName',
            'bk_promoCode','bk_promoId','bk_promoCodeVal','bk_discountAmount'
        ];

        fieldsToClear.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.tagName === 'SELECT') el.selectedIndex = 0;
            else el.value = '';
        });

        const slotsContainer = document.getElementById('bk_slotsContainer');
        if (slotsContainer) slotsContainer.style.display = 'none';

        const stickyBar = document.getElementById('bk_stickyBar');
        if (stickyBar) stickyBar.style.display = 'none';

        const promoPanel = document.getElementById('promoInputPanel');
        if (promoPanel) promoPanel.style.display = 'none';

        const promoStatus = document.getElementById('bk_promoStatus');
        if (promoStatus) promoStatus.style.display = 'none';

        const viewBookingsBtn = document.getElementById('btnViewBookings');
        if (viewBookingsBtn) viewBookingsBtn.style.display = 'none';

        bk_showFloatingSignOut(false);
        showScreen('screen-welcome');
        toast('Signed out successfully.', 'success');

    } catch(e) {
        toast('Sign out failed: ' + e.message, 'error');
    }
};



// ── Client Experience Library ─────────────────────────────
function bk_escapeHtml(value) {
    return String(value || '').replace(/[&<>\"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#039;' })[m]);
}

function bk_formatCxDate(ts) {
    try {
        if (!ts) return '';
        const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    } catch(e) { return ''; }
}

function startClientExperienceListener() {
    if (bk_clientExperienceUnsub) return;
    try {
        bk_clientExperienceUnsub = db.collection('Client_Experience')
            .where('visibleToClient', '==', true)
            .onSnapshot(snapshot => {
                bk_clientExperienceDocs = [];
                snapshot.forEach(doc => {
                    const d = { id: doc.id, ...doc.data() };
                    if (d.archived === true) return;
                    bk_clientExperienceDocs.push(d);
                });
                bk_clientExperienceDocs.sort((a, b) => {
                    const ad = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
                    const bd = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
                    return bd - ad;
                });
                renderClientExperienceLibrary();
            }, err => {
                console.error('Client Experience listener failed:', err);
                const el = document.getElementById('bk_clientExperienceList');
                if (el) el.innerHTML = `<div class=\"cx2-empty\" style=\"color:var(--error);\">Could not load client care library: ${bk_escapeHtml(err.message)}</div>`;
            });
    } catch(e) { console.error('Client Experience startup failed:', e); }
}

window.bk_openClientExperience = function(category) {
    bk_clientExperienceFilter = category || 'all';
    goToStep('screen-client-experience');
    renderClientExperienceLibrary();
};

window.bk_filterClientExperience = function(category) {
    bk_clientExperienceFilter = category || 'all';
    renderClientExperienceLibrary();
};

function renderClientExperienceLibrary() {
    const listEl = document.getElementById('bk_clientExperienceList');
    if (!listEl) return;
    document.querySelectorAll('.cx2-tab').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-cx2-tab') === bk_clientExperienceFilter);
    });
    const docs = bk_clientExperienceDocs.filter(d => bk_clientExperienceFilter === 'all' || (d.category || 'info') === bk_clientExperienceFilter);
    if (!docs.length) {
        const msg = bk_clientExperienceFilter === 'all' ? 'No client care documents are available yet.' : `No ${bk_clientExperienceFilter} documents are available yet.`;
        listEl.innerHTML = `<div class=\"cx2-empty\">${bk_escapeHtml(msg)}<br>New uploads from the THURAYA staff app will appear here automatically.</div>`;
        return;
    }
    const labelMap = { selfcare:'Selfcare', info:'Info', loyalty:'Loyalty', promo:'Promo' };
    listEl.innerHTML = docs.map(d => {
        const category = d.category || 'info';
        const label = labelMap[category] || category;
        const title = bk_escapeHtml(d.title || d.fileName || 'Client document');
        const desc = d.description ? `<p class=\"cx2-desc\">${bk_escapeHtml(d.description)}</p>` : '';
        const fileName = d.fileName ? bk_escapeHtml(d.fileName) : 'Document';
        const dateText = bk_formatCxDate(d.updatedAt || d.createdAt);
        return `<div class=\"cx2-card\"><div class=\"cx2-card-head\"><div class=\"cx2-card-title\">${title}</div><span class=\"cx2-badge\">${bk_escapeHtml(label)}</span></div>${desc}<button class=\"btn-outline full\" onclick=\"window.open('${bk_escapeHtml(d.fileUrl || '#')}', '_blank')\">Open ${fileName}</button>${dateText ? `<div class=\"cx2-meta\">Updated ${bk_escapeHtml(dateText)}</div>` : ''}</div>`;
    }).join('');
}

// Phase 5.5E: Client App availability alignment patch loaded.
console.log('Thuraya Client App Phase 5.5E availability aligned app.js loaded');


console.log('Thuraya Phase 8F client-friendly booking status labels loaded.');
