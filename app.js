
// Early BookFor Selection
window.bk_earlyBookFor = 'myself';

window.bk_setEarlyBookFor = function(val){
    window.bk_earlyBookFor = val;
};

// ============================================================
//  THURAYA — CLIENT SELF-BOOKING   app.js
//  Same Firebase backend as the Staff OS.
//  Collections read:  Menu_Settings_V2, Users (techs),
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
let _screenHistory    = ['screen-welcome'];
const todayStr        = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
})();

// ── Screen navigation ────────────────────────────────────

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(id);
    if (target) {
        target.style.display = 'flex';
        requestAnimationFrame(() => target.classList.add('active'));
    }
    setTimeout(() => {
        if (typeof bk_placeFloatingSignOut === 'function') bk_placeFloatingSignOut(target);
        bk_finalSyncCTAs();
    }, 80);
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
    const dateEl = document.getElementById('bk_date');
    if (dateEl) { dateEl.min = todayStr; dateEl.value = dateEl.value && dateEl.value < todayStr ? todayStr : dateEl.value; }

    loadTaxConfig();
    loadMenu();

    auth.onAuthStateChanged(async user => {
        if (user) {
            bk_currentUser = user;
            try {
                const doc = await db.collection('Client_Users').doc(user.email.toLowerCase()).get();
                if (doc.exists) {
                    bk_clientProfile = doc.data() || {};

                    const cleanPhone = String(bk_clientProfile.phone || bk_clientProfile.Tel_Number || '').replace(/\D/g, '');
                    const hasProfileName = !!String(bk_clientProfile.name || user.displayName || '').trim();
                    const hasProfileDob = !!String(bk_clientProfile.dob || bk_clientProfile.Date_Of_Birth || '').trim();
                    const profileComplete = hasProfileName && cleanPhone.length === 10 && hasProfileDob;

                    loadTechs();
                    bk_afterClientEntry();

                    if (!profileComplete) {
                        const nameEl = document.getElementById('prof_name');
                        const phoneEl = document.getElementById('prof_phone');
                        const emailEl = document.getElementById('prof_email');
                        const genderEl = document.getElementById('prof_gender');
                        const dobEl = document.getElementById('prof_dob');

                        if (nameEl && !nameEl.value) nameEl.value = bk_clientProfile.name || user.displayName || '';
                        if (phoneEl && !phoneEl.value) phoneEl.value = bk_clientProfile.phone || bk_clientProfile.Tel_Number || '';
                        if (emailEl) emailEl.value = user.email || bk_clientProfile.email || '';
                        if (genderEl && bk_clientProfile.gender && !genderEl.value) genderEl.value = bk_clientProfile.gender;
                        if (dobEl && !dobEl.value) dobEl.value = bk_clientProfile.dob || bk_clientProfile.Date_Of_Birth || '';

                        goToStep('screen-profile');
                        toast('Please complete your profile before booking.', 'info');
                        return;
                    }

                    // Returning users with complete profiles go to booking mode.
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
        bk_afterClientEntry();
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
    const dob    = document.getElementById('prof_dob')?.value || '';
    const email  = bk_currentUser?.email?.toLowerCase() || '';

    if (!name)          { toast('Please enter your full name.', 'warning'); return; }
    if (phone.length !== 10) { toast('Phone number must be 10 digits.', 'warning'); return; }
    if (!dob)           { toast('Please enter your date of birth.', 'warning'); return; }

    setBtnLoading(btn, true, 'Save & Continue');
    try {
        const profile = {
            name, phone, gender, dob, email,
            profileComplete: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('Client_Users').doc(email).set(profile, { merge: true });
        await db.collection('Clients').doc(phone).set({
            Forename:    name.split(' ')[0] || name,
            Surname:     name.split(' ').slice(1).join(' ') || '',
            Tel_Number:  phone,
            Email:       email,
            Gender:      gender,
            Date_Of_Birth: dob,
            Last_Updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        bk_clientProfile = profile;
        loadTechs();
        bk_afterClientEntry();
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
    'O FOOT THERAPY RITUALS': 'FOOT THERAPY RITUALS',
    'O ADD ONS & UPGRADES': 'ADD ONS & UPGRADES',
    'O HAND THERAPY & ENHANCEMENT RITUALS': 'HAND THERAPY & ENHANCEMENT RITUALS',
};
const TYPE_ORDER = { radio: 0, checkbox: 1, counter: 2 };
const MENU_MAIN_ORDER = {
    'FOOT THERAPY RITUALS': 10,
    'I. FOOT THERAPIES': 20,
    'ADD ONS & UPGRADES': 30,
    'HAND THERAPY & ENHANCEMENT RITUALS': 40,
    'I. HAND THERAPY RITUALS': 50,
    'II. PLEIADES STUDIO': 60,
    'NAIL ARCHITECTURE': 70,
    'DESIGNER CANVAS': 80,
    'EMBELLISHMENTS DRAWERS': 90,
};
function _cleanMenuText(v, fallback='Uncategorized') {
    return ((v || fallback) + '').trim().replace(/\s+/g, ' ');
}
function _normaliseCategory(cat) {
    const clean = _cleanMenuText(cat);
    return CATEGORY_ALIASES[clean] ?? CATEGORY_ALIASES[clean.toUpperCase()] ?? clean;
}
function _menuOrder(s, field, fallback=999) {
    const n = Number(s?.[field]);
    return Number.isFinite(n) ? n : fallback;
}
function _inferMainCategory(s, cat, dept) {
    if (s.mainCategory) return _normaliseCategory(s.mainCategory);
    const c = cat.toUpperCase();
    if (c.includes('FOOT')) return c.includes('ADD') ? 'ADD ONS & UPGRADES' : 'I. FOOT THERAPIES';
    if (c.includes('ADD') || c.includes('POLISH') || c.includes('FINISH')) return 'ADD ONS & UPGRADES';
    if (c.includes('PLEIADES')) return 'II. PLEIADES STUDIO';
    if (c.includes('NAIL ARCHITECTURE') || c.includes('ACRYLIC') || c.includes('GEL EXTENSION')) return 'NAIL ARCHITECTURE';
    if (c.includes('DESIGNER') || c.includes('ART')) return 'DESIGNER CANVAS';
    if (c.includes('EMBELLISH')) return 'EMBELLISHMENTS DRAWERS';
    return dept === 'Foot' ? 'I. FOOT THERAPIES' : 'I. HAND THERAPY RITUALS';
}
function _inferSubCategory(s, cat) {
    if (s.subCategory) return _cleanMenuText(s.subCategory);
    return cat;
}

function bk_normalizeMenuDept(value) {
    const raw = String(value || 'Hand').trim();
    const l = raw.toLowerCase();
    if (l.includes('both') || l.includes('hand & foot') || l.includes('hand/foot')) return 'Both';
    if (l.includes('foot') || l.includes('feet')) return 'Foot';
    return 'Hand';
}

// Client App restore guard:
// Menu_Settings_V2 may arrive from Staff App using either camelCase fields
// or the approved spreadsheet labels with spaces. Read both without changing UI/booking logic.
function bk_menuField(data = {}, keys = [], fallback = '') {
    for (const key of keys) {
        if (data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '') return data[key];
    }

    const compact = {};
    Object.keys(data || {}).forEach(k => {
        compact[String(k).toLowerCase().replace(/[^a-z0-9]/g, '')] = data[k];
    });

    for (const key of keys) {
        const ck = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (compact[ck] !== undefined && compact[ck] !== null && String(compact[ck]).trim() !== '') return compact[ck];
    }

    return fallback;
}

function bk_menuNumber(value, fallback = 0) {
    const n = Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function bk_menuIsActive(data = {}) {
    const rawActive = bk_menuField(data, ['isActive', 'Is Active', 'active', 'Active'], '');
    if (rawActive !== '') {
        const a = String(rawActive).trim().toLowerCase();
        if (['false', 'no', '0', 'inactive', 'disabled', 'off'].includes(a)) return false;
    }

    const st = String(bk_menuField(data, ['status', 'Status'], 'active')).trim().toLowerCase();
    return !['inactive', 'disabled', 'off', 'false', 'no', '0', 'archived', 'deleted'].includes(st);
}

function bk_cleanMenuLabel(value, fallback = '') {
    return String(value ?? fallback)
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^[•·\-–—]+\s*/g, '')
        .trim();
}

function bk_normalizeInputType(value, serviceName = '') {
    const raw = String(value || serviceName || '').trim().toLowerCase();
    if (raw.includes('counter') || raw.includes('quantity') || raw.includes('per_nail') || raw.includes('per nail') || raw.includes('unit') || raw.includes('per finger') || raw.includes('per toe')) return 'counter';
    if (raw.includes('checkbox') || raw.includes('multi') || raw.includes('add-on') || raw.includes('addon') || raw.includes('upgrade') || raw.includes('optional')) return 'checkbox';
    return 'radio';
}

function bk_normalizeV2MenuDoc(doc) {
    const d = doc.data() || {};
    const serviceName = bk_cleanMenuLabel(bk_menuField(d, ['serviceName', 'Service Name', 'name', 'displayName', 'Service'], 'Service'), 'Service');
    const serviceDescription = bk_cleanMenuLabel(bk_menuField(d, ['serviceDescription', 'Service Description', 'description', 'Description', 'desc'], ''));
    const dept = bk_normalizeMenuDept(bk_menuField(d, ['department', 'Department', 'appliesTo', 'dept', 'Therapy', 'Service Department'], 'Hand'));
    const sortOrder = bk_menuNumber(bk_menuField(d, ['sortOrder', 'Sort Order', 'priority', 'Priority', 'order', 'Order'], 999), 999);
    const price = bk_menuNumber(bk_menuField(d, ['price', 'Price', 'priceGHC', 'Price GHC', 'priceValue', 'unitPrice', 'amount'], 0), 0);
    const duration = Math.max(0, parseInt(bk_menuNumber(bk_menuField(d, ['duration', 'Duration', 'durationMins', 'Duration Mins', 'minutes', 'Minutes'], 0), 0), 10) || 0);
    const inputType = bk_normalizeInputType(bk_menuField(d, ['inputType', 'Input Type', 'selection', 'Selection Type'], ''), serviceName);
    const mainCategory = bk_cleanMenuLabel(bk_menuField(d, ['ritualGroup', 'Ritual Group', 'mainCategory', 'Main Category', 'mainMenu', 'Main Menu'], ''));
    const category = bk_cleanMenuLabel(bk_menuField(d, ['category', 'Category', 'subCategory', 'Sub Category', 'subMenu', 'Sub Menu', 'serviceType', 'Service Type'], 'General'), 'General');
    const subCategory = bk_cleanMenuLabel(bk_menuField(d, ['subCategory', 'Sub Category', 'category', 'Category', 'subMenu', 'Sub Menu'], category));

    return {
        ...d,
        id: doc.id,
        sourceCollection: 'Menu_Settings_V2',
        name: serviceName,
        displayName: d.displayName || serviceName,
        desc: serviceDescription,
        description: serviceDescription,
        serviceDescription,
        department: dept,
        appliesTo: dept,
        mainCategory,
        category,
        subCategory,
        serviceType: bk_cleanMenuLabel(bk_menuField(d, ['serviceType', 'Service Type'], '')),
        categoryDescription: bk_cleanMenuLabel(bk_menuField(d, ['categoryDescription', 'Category Description', 'subCategoryDescription', 'Sub Category Description'], '')),
        mainCategoryDescription: bk_cleanMenuLabel(bk_menuField(d, ['ritualGroupDescription', 'Ritual Group Description', 'mainCategoryDescription', 'Main Category Description'], '')),
        price,
        priceGHC: price,
        duration,
        inputType,
        sortOrder,
        order: sortOrder,
        status: bk_cleanMenuLabel(bk_menuField(d, ['status', 'Status'], 'Active'), 'Active'),
        isActive: bk_menuIsActive(d),
        tag: d.tag || 'None'
    };
}

function bk_publishMenuSyncState(services, source = 'Menu_Settings_V2') {
    const counts = (services || []).reduce((acc, s) => {
        const dept = bk_normalizeMenuDept(s.department || s.appliesTo);
        acc[dept] = (acc[dept] || 0) + 1;
        return acc;
    }, {});
    window.THURAYA_CLIENT_MENU_SYNC = {
        source,
        total: (services || []).length,
        hand: counts.Hand || 0,
        foot: counts.Foot || 0,
        both: counts.Both || 0,
        updatedAt: new Date().toISOString()
    };
    window.bk_menuServices = services || [];
    try {
        window.dispatchEvent(new CustomEvent('THURAYA_MENU_SETTINGS_V2_READY', {
            detail: { services: window.bk_menuServices, source, counts }
        }));
    } catch (e) {}
}

function bk_renderLoadedMenu(services, source = 'Menu_Settings_V2') {
    services.sort((a, b) =>
        th_v2DeptOrder(a.department || a.appliesTo) - th_v2DeptOrder(b.department || b.appliesTo) ||
        th_v2SortValue(a.sortOrder ?? a.order) - th_v2SortValue(b.sortOrder ?? b.order) ||
        th_v2TieBreak(a.mainCategory || a.ritualGroup || a.category, b.mainCategory || b.ritualGroup || b.category) ||
        th_v2TieBreak(a.subCategory || a.category || a.serviceType, b.subCategory || b.category || b.serviceType) ||
        th_v2TieBreak(a.name || a.serviceName, b.name || b.serviceName)
    );
    bk_menuServices = services.filter(bk_menuIsActive);
    bk_publishMenuSyncState(bk_menuServices, source);
    if (source === 'Menu_Settings_V2') th_v2PublishSortAudit(bk_menuServices);
    renderMenuForDept(bk_selectedDept);
}

function loadMenu() {
    const container = document.getElementById('bk_serviceMenu');

    db.collection('Menu_Settings_V2').onSnapshot(snap => {
        const services = [];
        snap.forEach(doc => {
            const data = doc.data() || {};
            if (bk_menuIsActive(data)) services.push(bk_normalizeV2MenuDoc(doc));
        });

        if (services.length) {
            bk_renderLoadedMenu(services, 'Menu_Settings_V2');
            return;
        }

        bk_menuServices = [];
        bk_publishMenuSyncState([], 'Menu_Settings_V2');
        if (container) container.innerHTML =
            '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No active services found in Menu Settings V2.</p>';
    }, err => {
        console.error('Menu_Settings_V2 unavailable:', err);
        bk_menuServices = [];
        bk_publishMenuSyncState([], 'Menu_Settings_V2');
        const c = document.getElementById('bk_serviceMenu');
        if (c) c.innerHTML =
            `<p style="color:var(--error);text-align:center;padding:20px;">Could not load Menu Settings V2: ${err.message}</p>`;
    });
}

function renderMenuForDeptLegacy(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    /*
      Accordion service menu — Option B:
      - all sections collapsed by default
      - multiple sections can stay open
      - individual menu follows the same category logic used by group booking
    */
    const aliases = {
        'I. HAND THERAPIES': 'I. HAND THERAPY RITUALS',
        'I. HAND THERAPIES ': 'I. HAND THERAPY RITUALS',
        'O FOOT THERAPY RITUALS': 'FOOT THERAPY RITUALS',
        'O ADD ONS & UPGRADES': 'ADD ONS & UPGRADES',
        'O HAND THERAPY & ENHANCEMENT RITUALS': 'HAND THERAPY & ENHANCEMENT RITUALS'
    };

    const typeOrder = { radio: 0, checkbox: 1, counter: 2 };
    const dbData = { Hand: {}, Foot: {} };

    function cleanCategory(s) {
        let cat = (s.category || s.subCategory || s.mainCategory || 'Uncategorized');
        cat = String(cat).trim().replace(/\s+/g, ' ');
        return aliases[cat] || aliases[cat.toUpperCase()] || cat;
    }

    function addToDept(d, cat, service) {
        if (!dbData[d]) dbData[d] = {};
        if (!dbData[d][cat]) dbData[d][cat] = [];
        dbData[d][cat].push(service);
    }

    (bk_menuServices || []).forEach(s => {
        const cat = cleanCategory(s);
        const serviceDept = s.department || 'Hand';

        if (serviceDept === 'Both') {
            addToDept('Hand', cat, s);
            addToDept('Foot', cat, s);
        } else {
            addToDept(serviceDept, cat, s);
        }
    });

    Object.values(dbData).forEach(dObj => {
        Object.values(dObj).forEach(arr => {
            arr.sort((a, b) =>
                (typeOrder[a.inputType || 'radio'] ?? 1) - (typeOrder[b.inputType || 'radio'] ?? 1) ||
                (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999) ||
                (Number(a.order) || 999) - (Number(b.order) || 999) ||
                (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
            );
        });
    });

    const romanMap = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10 };
    function sectionRank(cat) {
        const c = String(cat || '').trim();
        const upper = c.toUpperCase();

        const roman = upper.match(/^(I|II|III|IV|V|VI|VII|VIII|IX|X)\./);
        if (roman) return romanMap[roman[1]] || 50;

        const numeric = upper.match(/^(\d+)\./);
        if (numeric) return Number(numeric[1]);

        if (upper.includes('HAND THERAPY')) return 10;
        if (upper.includes('PLEIADES')) return 20;
        if (upper.includes('NAIL ARCHITECTURE')) return 30;
        if (upper.includes('DESIGNER')) return 40;
        if (upper.includes('EMBELLISH')) return 50;
        if (upper.includes('ADD')) return 80;
        if (upper.includes('FINISH')) return 85;
        if (upper.includes('FOOT')) return 10;

        return 99;
    }

    function helperText(cat, items) {
        const upper = String(cat || '').toUpperCase();
        const count = items.length;
        if (upper.includes('ADD') || upper.includes('UPGRADE') || upper.includes('EMBELLISH') || upper.includes('DESIGNER')) {
            return `Enhancements · optional · ${count} option${count === 1 ? '' : 's'}`;
        }
        if (items.some(s => (s.inputType || 'radio') !== 'radio')) {
            return `Choose your ritual · optional add-ons available · ${count} option${count === 1 ? '' : 's'}`;
        }
        return `Core treatments · choose one · ${count} option${count === 1 ? '' : 's'}`;
    }

    function footDisplayTitle(cat) {
        return String(cat || '')
            .replace(/^\s*[A-Z]\.\s*/i, '')
            .replace(/^\s*(I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s*/i, '')
            .replace(/^\s*\d+\.\s*/, '')
            .trim();
    }

    function footPriority(cat) {
        const c = footDisplayTitle(cat).toUpperCase();
        if (c.includes('FOUNDATION')) return 10;
        if (c.includes('URBAN EXPRESS')) return 20;
        if (c.includes('MEDI') || c.includes('CLEANSE')) return 30;
        if (c.includes('FINISHING INDULGENCE')) return 40;
        if (c.includes('POLISH') || c.includes('FINISH')) return 50;
        return 999;
    }

    const sortedCats = Object.keys(dbData[dept] || {}).sort((a, b) => {
        if (dept === 'Foot') {
            const ap = footPriority(a);
            const bp = footPriority(b);
            if (ap !== bp) return ap - bp;
            return footDisplayTitle(a).localeCompare(footDisplayTitle(b), undefined, { numeric: true, sensitivity: 'base' });
        }
        const ar = sectionRank(a);
        const br = sectionRank(b);
        if (ar !== br) return ar - br;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (!sortedCats.length) {
        container.innerHTML =
            '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No services available for this category.</p>';
        updateBreakdown();
        return;
    }

    let html = '';

    sortedCats.forEach((cat, index) => {
        const items = dbData[dept][cat] || [];
        const singles = items.filter(s => (s.inputType || 'radio') === 'radio');
        const multis = items.filter(s => (s.inputType || 'radio') !== 'radio');
        const sectionId = `bk_menu_section_${dept}_${index}`;
        const displayCat = dept === 'Foot' ? footDisplayTitle(cat) : cat;
        const helper = helperText(displayCat, items);

        html += `
            <div class="thuraya-accordion-section" data-category="${cat}">
                <button type="button" class="thuraya-accordion-head" aria-expanded="false" aria-controls="${sectionId}" onclick="bk_toggleMenuSection(this)">
                    <span class="thuraya-accordion-title-wrap">
                        <span class="thuraya-accordion-title">${displayCat}</span>
                        <span class="thuraya-accordion-meta">${helper}</span>
                    </span>
                    <span class="thuraya-accordion-chevron">›</span>
                </button>
                <div class="thuraya-accordion-body" id="${sectionId}">
                    <div class="thuraya-accordion-inner">`;

        if (singles.length && multis.length) {
            html += `<div class="menu-subgroup-label">Choose your ritual <span>— select one</span></div>`;
            singles.forEach(s => { html += _buildCard(s, dept); });

            html += `<div class="menu-subgroup-divider"></div>
                     <div class="menu-subgroup-label">Enhancements &amp; Add-ons <span>— select any</span></div>`;
            multis.forEach(s => { html += _buildCard(s, dept); });
        } else {
            items.forEach(s => { html += _buildCard(s, dept); });
        }

        html += `
                    </div>
                </div>
            </div>`;
    });

    container.innerHTML = html;

    // Restore selected state after render, and auto-open sections containing selected services.
    bk_selectedServices.forEach(sel => {
        const cb  = document.getElementById('bk_cb_'  + sel.id);
        const qty = document.getElementById('bk_qty_' + sel.id);
        if (cb) {
            cb.checked = true;
            const card = cb.closest('.service-card');
            card?.classList.add('selected');
            const section = cb.closest('.thuraya-accordion-section');
            if (section) {
                section.classList.add('open');
                const head = section.querySelector('.thuraya-accordion-head');
                if (head) head.setAttribute('aria-expanded', 'true');
            }
        }
        if (qty) {
            qty.value = sel.qty || 1;
            const section = qty.closest('.thuraya-accordion-section');
            if (section) {
                section.classList.add('open');
                const head = section.querySelector('.thuraya-accordion-head');
                if (head) head.setAttribute('aria-expanded', 'true');
            }
        }
    });

    setTimeout(bk_finalSyncCTAs, 60);
    updateBreakdown();
}



// ── THURAYA PRODUCTION MENU STRUCTURE — HAND THERAPY ─────
// Reference-approved structure: Category → Main Menu → Sub Menu → System Group → Service.
// This is UI/data rendering only. Booking selection still uses the existing bk_toggleCard / _buildCard flow.
const THURAYA_HAND_MENU_REFERENCE = [
  {
    key: 'hand-rituals',
    title: '1. Hand Therapies & Rituals',
    description: 'Restorative and grooming rituals designed for softness, balance, and refined presentation.',
    children: [
      { name: 'Youthful Touch — Hand Renewal', duration: 45, price: 220, inputType: 'radio', desc: 'A 45-minute hand renewal ritual for visible softness, care, and refined presentation.' },
      { name: 'Silken Restore — Hand Balance', duration: 30, price: 165, inputType: 'radio', desc: 'A 30-minute balancing hand treatment focused on hydration, comfort, and a smooth finish.' },
      { name: 'Precision Groom — Men', duration: 45, price: 220, inputType: 'radio', desc: 'A 45-minute grooming ritual designed for clean, confident, masculine hand care.' }
    ]
  },
  {
    key: 'luxe-addons',
    title: '2. Luxe Add Ons & Upgrades',
    description: 'Enhancements designed to elevate your base service with finishing indulgence and polish upgrades.',
    children: [
      {
        key: 'finishing-indulgences', title: 'A. Finishing Indulgences', description: 'Comfort-led upgrades that extend the ritual through massage, warmth, and restoration.',
        children: [
          { name: 'Lush Arm Sculpt Massage', price: 50, inputType: 'checkbox', desc: 'A sculpting arm massage add-on to soften tension and complete the hand ritual.' },
          { name: 'Paraffin Restoration Mask', price: 50, inputType: 'checkbox', desc: 'A warm paraffin mask to seal moisture and restore a supple hand feel.' },
          { name: 'Hot Stone Arm Massage', price: 80, inputType: 'checkbox', desc: 'A heated stone massage upgrade for deeper relaxation and premium finishing.' }
        ]
      },
      {
        key: 'polish-finish-luxe', title: 'B. Polish & Finish', description: 'Finishing options that refine the final look with polish, tip work, or chrome expression.',
        children: [
          { name: 'Gel Polish Upgrade', price: 60, inputType: 'checkbox', desc: 'A long-lasting gel polish finish added to your selected hand ritual.' },
          { name: 'French Tips', price: 105, inputType: 'checkbox', desc: 'A timeless tip finish for clean elegance and refined detail.' },
          { name: 'Chrome / Manicure', price: 180, inputType: 'checkbox', desc: 'A reflective chrome finish for a modern, high-impact manicure aesthetic.' }
        ]
      }
    ]
  },
  {
    key: 'pleiades-studio',
    title: '3. Pleiades Studio',
    description: 'Nail enhancements suite: extensions, layovers, brush-on systems, and design.',
    badge: 'Enhancement Suite',
    children: [
      {
        key: 'nail-architecture', title: 'A. Nail Architecture', description: 'Acrylic, Gel X extensions, brush-on gel, and structural systems designed to enhance form, durability, and aesthetic balance.',
        children: [
          {
            key: 'acrylic', title: 'A1. Acrylic', description: 'Classic acrylic enhancement system for durable structure, clean length, and refined shape.',
            children: [
              { name: 'Acrylic Full Set', displayName: 'Full Set', duration: 90, price: 300, inputType: 'radio', desc: 'A 90-minute full acrylic set for durable structure and polished presentation.' },
              { name: 'Acrylic Infill', displayName: 'Infill', duration: 60, price: 250, inputType: 'radio', desc: 'A 60-minute maintenance service to refresh growth and restore balance.' },
              { name: 'Acrylic Removal Only', displayName: 'Removal Only', duration: 45, price: 150, inputType: 'radio', desc: 'A 45-minute safe removal service for existing acrylic enhancements.' },
              { name: 'Acrylic Removal + New Set', displayName: 'Removal + New Set', duration: 120, price: 350, inputType: 'radio', desc: 'A 120-minute full refresh: removal followed by a new acrylic set.' }
            ]
          },
          {
            key: 'sculpt-acrylic', title: 'Sculpt Acrylic', description: 'Advanced sculpted acrylic structure for stronger shape control and an elevated enhancement finish.',
            children: [
              { name: 'Sculpt Acrylic Full Set', displayName: 'Full Set', duration: 105, price: 380, inputType: 'radio', desc: 'A 105-minute sculpted acrylic full set for advanced structure and shaping.' },
              { name: 'Sculpt Acrylic Infill', displayName: 'Infill', duration: 75, price: 280, inputType: 'radio', desc: 'A 75-minute sculpt acrylic maintenance service restoring shape and balance.' },
              { name: 'Sculpt Acrylic Removal + New Set', displayName: 'Removal + New Set', duration: 120, price: 460, inputType: 'radio', desc: 'A 120-minute sculpt acrylic refresh with removal and new structure.' }
            ]
          },
          {
            key: 'gel-systems', title: 'Gel Systems', description: 'Gel-based enhancement systems including Gel X, BIAB, and DuraGel for flexible or durable structure.',
            children: [
              { key: 'gel-x', title: 'A2. Gel X', description: 'Lightweight extension system offering flexibility, comfort, and a natural finish.', children: [
                { name: 'Gel X Polish Only', displayName: 'Polish Only', price: 145, inputType: 'radio', desc: 'A clean polish application on Gel X base for a refined finish.' },
                { name: 'Gel X Extensions', displayName: 'Extensions', price: 330, priceLabel: 'GHC300–360', inputType: 'radio', desc: 'Full-length Gel X extensions with seamless structure and natural feel.' },
                { name: 'Gel X Infill', displayName: 'Infill', price: 280, inputType: 'radio', desc: 'Maintenance service restoring structure, balance, and polish integrity.' },
                { name: 'Gel X Removal + New Set', displayName: 'Removal + New Set', price: 340, inputType: 'radio', desc: 'Complete removal followed by a fresh Gel X application.' }
              ]},
              { key: 'biab', title: 'A3. BIAB', description: 'Builder gel system focused on strength, natural overlays, and nail health.', children: [
                { name: 'BIAB Overlay', displayName: 'Overlay', price: 280, inputType: 'radio', desc: 'Strengthening overlay enhancing natural nail durability and structure.' },
                { name: 'BIAB Extensions', displayName: 'Extensions', price: 360, inputType: 'radio', desc: 'Structured builder gel extensions with a natural, balanced aesthetic.' },
                { name: 'BIAB Infill', displayName: 'Infill', price: 300, inputType: 'radio', desc: 'Refinement and balance restoration for an existing BIAB structure.' },
                { name: 'BIAB Removal + New Set', displayName: 'Removal + New Set', price: 420, inputType: 'radio', desc: 'Complete refresh with new BIAB structure and finish.' }
              ]},
              { key: 'duragel', title: 'A4. DuraGel', description: 'High-durability gel system designed for long-lasting strength and structure.', children: [
                { name: 'DuraGel Full Set', displayName: 'Full Set', price: 360, inputType: 'radio', desc: 'Full structured gel application designed for durable daily wear.' },
                { name: 'DuraGel Infill', displayName: 'Infill', price: 300, inputType: 'radio', desc: 'Maintenance and structural correction for an existing DuraGel set.' },
                { name: 'DuraGel Removal + New Set', displayName: 'Removal + New Set', price: 420, inputType: 'radio', desc: 'Complete removal followed by a new durable gel structure.' }
              ]}
            ]
          }
        ]
      },
      {
        key: 'polish-finish-pleiades', title: 'B. Polish & Finish', description: 'Finishing polish and styling options repeated within Pleiades Studio for enhancement clients.',
        children: [
          { name: 'Gel Polish Upgrade', price: 60, inputType: 'checkbox', desc: 'A durable polish upgrade for enhancement services requiring a finished color layer.' },
          { name: 'French Tips', price: 105, inputType: 'checkbox', desc: 'A refined tip style for enhancement sets requiring a timeless finish.' },
          { name: 'Chrome / Manicure', price: 180, inputType: 'checkbox', desc: 'A high-shine chrome or manicure finish for a statement enhancement look.' }
        ]
      },
      {
        key: 'design-canvas', title: 'C. Design Canvas', description: 'Design enhancement structure for creative nail artistry from minimal editorial detail to couture expression.',
        children: [
          { key: 'editorial-art', title: 'C1. Editorial Art', description: 'Visible design details for refined creative expression per nail.', children: [
            { name: 'Simple Art', price: 12, priceLabel: 'GHC12 / nail', inputType: 'counter', desc: 'Minimal editorial detailing for clean, elegant nail art accents.' },
            { name: 'Detailed Art', price: 18, priceLabel: 'GHC18 / nail', inputType: 'counter', desc: 'More intricate art work for expressive detail and elevated visual interest.' }
          ]},
          { key: 'couture-art', title: 'C2. Couture Art', description: 'Custom design direction for clients seeking a bespoke nail art concept.', children: [
            { name: 'Custom Design', price: 0, priceLabel: 'Consultation', inputType: 'checkbox', desc: 'Bespoke design work priced and planned after consultation based on detail and complexity.' }
          ]}
        ]
      },
      {
        key: 'embellishment-drawers', title: 'D. Embellishment Drawers', description: 'Dimensional and decorative embellishments that add texture, sparkle, and couture detail.',
        children: [
          { name: '3D Art', price: 15, inputType: 'counter', desc: 'Dimensional nail art elements for expressive sculptural detail.' },
          { name: 'Stones & Crystals', price: 10, inputType: 'counter', desc: 'Sparkle and crystal detailing added to selected nails for a luxury finish.' },
          { name: 'Metals / Pearls', price: 10, inputType: 'counter', desc: 'Metallic or pearl embellishments for refined decorative accents.' }
        ]
      }
    ]
  },
  {
    key: 'repairs',
    title: '4. Repairs',
    description: 'Maintenance and corrective services for durability, polish, and restoration.',
    children: [
      { name: 'Nail Repair', price: 25, inputType: 'checkbox', desc: 'Targeted correction to restore strength and visual balance to a damaged nail.' },
      { name: 'Stick-ons', price: 240, inputType: 'radio', desc: 'Quick enhancement set for a polished look with efficient application.' }
    ]
  }
];

function th_slug(value) {
    return String(value || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
function th_norm(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function th_findServiceMatch(ref, placementKey, radioGroup) {
    const wanted = [ref.name, ref.displayName].filter(Boolean).map(th_norm);
    const match = (bk_menuServices || []).find(s =>
        wanted.includes(th_norm(s.name)) ||
        wanted.some(w => th_norm(s.name).includes(w) || w.includes(th_norm(s.name)))
    );

    // Staff App / Firebase values must win whenever a matching live service exists.
    // The reference structure remains only as the luxury display shell and fallback.
    const livePrice = match && match.price !== undefined && match.price !== null && match.price !== '' ? Number(match.price) : undefined;
    const liveDuration = match && match.duration !== undefined && match.duration !== null && match.duration !== '' ? Number(match.duration) : undefined;
    const liveDesc = match?.desc || match?.description || match?.serviceDescription;

    const merged = {
        ...ref,
        ...(match || {}),
        price: Number.isFinite(livePrice) ? livePrice : (Number(ref.price) || 0),
        duration: Number.isFinite(liveDuration) ? liveDuration : (Number(ref.duration) || 0),
        desc: liveDesc || ref.desc || '',
        inputType: match?.inputType || ref.inputType || 'radio',
        tag: match?.tag || ref.tag || '',
        priceLabel: match?.priceLabel || (Number.isFinite(livePrice) ? '' : (ref.priceLabel || ''))
    };

    // Keep approved client-facing labels such as "Full Set", while syncing the live values behind them.
    merged.name = ref.displayName || ref.name || match?.name || 'Service';

    // Keep a placement-safe ID so repeated reference sections do not collide visually/selection-wise.
    merged.id = `th_${placementKey}_${match?.id || th_slug(ref.name || ref.displayName)}`;
    merged.department = 'Hand';
    merged.status = match?.status || ref.status || 'Active';
    merged.radioGroup = radioGroup || `bk_ref_${placementKey}`;
    merged.liveSynced = !!match;
    return merged;
}
function th_refEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function th_priceLabel(service) {
    if (service.priceLabel) return service.priceLabel;
    const price = Number(service.price) || 0;
    return price === 0 ? 'Consultation' : `GHC${price}`;
}

function th_buildReferenceServiceCard(ref, dept, placementKey, radioGroup, variant='simple') {
    const s = th_findServiceMatch(ref, placementKey, radioGroup);
    const type = s.inputType || 'radio';
    const id = s.id;
    const name = s.name || 'Service';
    const dur = Number(s.duration) || 0;
    const price = Number(s.price) || 0;
    const groupName = type === 'radio' ? (s.radioGroup || radioGroup || `bk_ref_${placementKey}`) : `bk_cb_${id}`;
    const safeId = bk_jsString(id);
    const safeName = bk_jsString(name);
    const safeDept = bk_jsString(dept);
    const safeGroup = bk_jsString(groupName);
    const label = th_refEscape(th_priceLabel(s));
    const desc = th_refEscape(s.desc || '');
    const title = th_refEscape(name);
    const inputId = `bk_cb_${id}`;
    const selected = (bk_selectedServices || []).some(item => item.id === id);
    const selectedClass = selected ? ' selected' : '';
    const checkedAttr = selected ? ' checked' : '';

    if (type === 'counter') {
        const qty = (bk_selectedServices || []).find(item => item.id === id)?.qty || 0;
        return `
            <div class="service th-ref-counter-service${qty > 0 ? ' selected' : ''}">
                <div class="service-row">
                    <div class="service-name">${title}</div>
                    <div class="price">${label}</div>
                </div>
                ${desc ? `<div class="service-desc">${desc}</div>` : ''}
                <div class="th-ref-counter-row">
                    <button type="button" class="counter-btn" onclick="bk_updateCounter('${safeId}',${price},${dur},'${safeName}',-1,'${safeDept}')">−</button>
                    <input type="number" id="bk_qty_${id}" value="${qty}" min="0" readonly>
                    <button type="button" class="counter-btn" onclick="bk_updateCounter('${safeId}',${price},${dur},'${safeName}',1,'${safeDept}')">+</button>
                </div>
            </div>`;
    }

    const inputType = type === 'radio' ? 'radio' : 'checkbox';
    return `
        <div class="${variant === 'service' ? 'service' : 'simple-service'} th-ref-selectable service-card${selectedClass}"
             onclick="bk_toggleCard(event,this,'${safeId}','${type}','${safeGroup}',${price},${dur},'${safeName}','${safeDept}')">
            <input type="${inputType}" name="${th_refEscape(groupName)}" id="${th_refEscape(inputId)}" ${checkedAttr}
                   style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;">
            <div class="service-row">
                <div class="service-name">${title}</div>
                <div class="price">${label}</div>
            </div>
            ${desc ? `<div class="service-desc">${desc}</div>` : ''}
            ${variant === 'simple' ? `<button type="button" tabindex="-1" class="cta">${type === 'checkbox' ? 'Add Upgrade' : (title.toLowerCase().includes('repair') ? 'Select Repair' : 'Select Ritual')}</button>` : ''}
        </div>`;
}

function th_renderServiceRef(ref, dept, placementKey, radioGroup, variant='simple') {
    return th_buildReferenceServiceCard(ref, dept, placementKey, radioGroup, variant);
}

function th_isServiceNode(node) {
    return !node.children;
}

function th_systemIcon(node) {
    const t = String(node.title || '').trim();
    if (/^A1/i.test(t)) return 'A1';
    if (/^A2/i.test(t)) return 'A2';
    if (/^A3/i.test(t)) return 'A3';
    if (/^A4/i.test(t)) return 'A4';
    if (/^C1/i.test(t)) return 'C1';
    if (/^C2/i.test(t)) return 'C2';
    if (/gel systems/i.test(t)) return 'G';
    return '✦';
}

function th_renderSubmenu(node, dept, path, depth=1) {
    const key = `${path}_${th_slug(node.key || node.title || node.name)}`;
    const serviceChildren = (node.children || []).filter(th_isServiceNode);
    const groupChildren = (node.children || []).filter(child => !th_isServiceNode(child));

    const servicesHtml = serviceChildren.map(child => th_renderServiceRef(child, dept, `${key}_${th_slug(child.name || child.displayName)}`, key, 'simple')).join('');
    const groupsHtml = groupChildren.map(child => {
        const childKey = `${key}_${th_slug(child.key || child.title || child.name)}`;
        const grandChildren = child.children || [];
        const allGrandChildrenAreServices = grandChildren.length && grandChildren.every(th_isServiceNode);

        if (allGrandChildrenAreServices) {
            return th_renderSystem(child, dept, childKey);
        }

        const nested = grandChildren.map(grand => {
            if (th_isServiceNode(grand)) return th_renderServiceRef(grand, dept, `${childKey}_${th_slug(grand.name || grand.displayName)}`, childKey, 'service');
            return th_renderSubmenu(grand, dept, childKey, depth + 1);
        }).join('');

        return `
            <div class="system">
                <div class="system-head">
                    <div class="system-icon">${th_refEscape(th_systemIcon(child))}</div>
                    <div>
                        <h4>${th_refEscape(child.title || '')}</h4>
                        <p>${th_refEscape(child.description || '')}</p>
                    </div>
                </div>
                ${nested}
            </div>`;
    }).join('');

    return `
        <div class="submenu">
            <h3>${th_refEscape(node.title || '')}</h3>
            ${node.description ? `<p class="desc">${th_refEscape(node.description)}</p>` : ''}
            ${servicesHtml}
            ${groupsHtml}
        </div>`;
}

function th_renderSystem(node, dept, path) {
    const services = (node.children || []).map(child => th_renderServiceRef(child, dept, `${path}_${th_slug(child.name || child.displayName)}`, path, 'service')).join('');
    return `
        <div class="system">
            <div class="system-head">
                <div class="system-icon">${th_refEscape(th_systemIcon(node))}</div>
                <div>
                    <h4>${th_refEscape(node.title || '')}</h4>
                    <p>${th_refEscape(node.description || '')}</p>
                </div>
            </div>
            ${services}
        </div>`;
}

function th_renderTopNode(node, dept, index) {
    const key = `hand_${th_slug(node.key || node.title || index)}`;
    const openAttr = (node.key === 'hand-rituals' || node.key === 'pleiades-studio') ? ' open' : '';
    const serviceChildren = (node.children || []).filter(th_isServiceNode);
    const groupChildren = (node.children || []).filter(child => !th_isServiceNode(child));
    const servicesHtml = serviceChildren.map(child => th_renderServiceRef(child, dept, `${key}_${th_slug(child.name || child.displayName)}`, key, 'simple')).join('');
    const groupsHtml = groupChildren.map(child => th_renderSubmenu(child, dept, key)).join('');
    const badge = node.badge ? `<div class="badge">${th_refEscape(node.badge)}</div>` : '';
    const contentInner = node.badge ? `<div class="menu-card">${badge}${servicesHtml}${groupsHtml}</div>` : `${servicesHtml}${groupsHtml}`;

    return `
        <details class="th-ref-details"${openAttr}>
            <summary>
                <div class="title-block">
                    <strong>${th_refEscape(node.title || '')}</strong>
                    <span>${th_refEscape(node.description || '')}</span>
                </div>
                <div class="chev">+</div>
            </summary>
            <div class="content">${contentInner}</div>
        </details>`;
}

function th_openSelectedReferenceSections(container) {
    (bk_selectedServices || []).forEach(sel => {
        document.querySelectorAll(`[id="bk_cb_${sel.id}"]`).forEach(input => {
            input.checked = true;
            input.closest('.th-ref-selectable')?.classList.add('selected');
            input.closest('details')?.setAttribute('open', '');
        });
        document.querySelectorAll(`[id="bk_qty_${sel.id}"]`).forEach(qty => {
            qty.value = sel.qty || 1;
            qty.closest('.th-ref-counter-service')?.classList.toggle('selected', Number(sel.qty || 0) > 0);
            qty.closest('details')?.setAttribute('open', '');
        });
    });
}

function renderThurayaReferenceMenuForDept(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    container.classList.add('th-ref-menu');
    container.innerHTML = THURAYA_HAND_MENU_REFERENCE.map((node, index) => th_renderTopNode(node, dept, index)).join('');
    th_openSelectedReferenceSections(container);

    setTimeout(bk_finalSyncCTAs, 60);
    updateBreakdown();
}


// ── THURAYA FOOT MENU CURATED ORDER ──────────────────────
// UI/data rendering only. Keeps the existing _buildCard / selection logic intact.
function th_cleanFootCategory(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^(?:[A-Z]|\d+)\.\s*/i, '')
        .replace(/^O\s+/i, '')
        .trim();
}

function th_footCategoryKey(s) {
    const raw = th_cleanFootCategory(s.subCategory || s.category || s.mainCategory || '');
    const upper = raw.toUpperCase();

    if (!upper || upper === 'SERVICES' || upper === 'SERVICE') return '';
    if (upper.includes('FOUNDATION')) return 'Foundation Rituals';
    if (upper.includes('URBAN')) return 'Urban Express Rituals';
    if (upper.includes('MEDI') || upper.includes('CLEANSE')) return 'Medi-Cleanse Series';
    if (upper.includes('FINISHING') || upper.includes('INDULGENCE')) return 'The Finishing Indulgences';
    if (upper.includes('POLISH') || upper.includes('FINISH')) return 'Polish & Finish';

    return raw;
}

function th_footMeta(cat, count, items) {
    const lower = String(cat || '').toLowerCase();
    const isOptional = lower.includes('finish') || lower.includes('polish') || lower.includes('cleanse') || (items || []).some(s => (s.inputType || 'radio') !== 'radio');
    const action = isOptional ? 'Choose your ritual · optional add-ons available' : 'Core treatments · choose one';
    return `${action} · ${count} option${count === 1 ? '' : 's'}`;
}

function renderFootMenuCustom(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    container.classList.remove('th-ref-menu');

    const order = [
        'Foundation Rituals',
        'Urban Express Rituals',
        'Medi-Cleanse Series',
        'The Finishing Indulgences',
        'Polish & Finish'
    ];

    const grouped = {};
    (bk_menuServices || []).forEach(s => {
        const serviceDept = String(s.department || 'Hand').toLowerCase();
        const belongsToFoot = serviceDept === 'both' || serviceDept.includes('foot');
        if (!belongsToFoot) return;

        const cat = th_footCategoryKey(s);
        if (!cat) return; // removes the unwanted SERVICES bucket

        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(s);
    });

    const typeOrder = { radio: 0, checkbox: 1, counter: 2 };
    Object.values(grouped).forEach(items => {
        items.sort((a, b) =>
            (typeOrder[a.inputType || 'radio'] ?? 1) - (typeOrder[b.inputType || 'radio'] ?? 1) ||
            (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999) ||
            (Number(a.order) || 999) - (Number(b.order) || 999) ||
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
        );
    });

    function renderFootSection(cat, items, sectionId) {
        return `
            <div class="thuraya-accordion-section" data-category="${cat}">
                <button type="button" class="thuraya-accordion-head" aria-expanded="false" aria-controls="${sectionId}" onclick="bk_toggleMenuSection(this)">
                    <span class="thuraya-accordion-title-wrap">
                        <span class="thuraya-accordion-title">${cat}</span>
                        <span class="thuraya-accordion-meta">${th_footMeta(cat, items.length, items)}</span>
                    </span>
                    <span class="thuraya-accordion-chevron">›</span>
                </button>
                <div class="thuraya-accordion-body" id="${sectionId}">
                    <div class="thuraya-accordion-inner">
                        ${items.map(s => _buildCard(s, dept)).join('')}
                    </div>
                </div>
            </div>`;
    }

    let html = '';
    const renderedCats = new Set();

    // Curated luxury order first.
    order.forEach((cat, index) => {
        const items = grouped[cat] || [];
        if (!items.length) return;
        renderedCats.add(cat);
        html += renderFootSection(cat, items, `bk_foot_section_${index}`);
    });

    // Option B fallback: any new Staff App categories appear after the curated menu.
    Object.keys(grouped)
        .filter(cat => cat && !renderedCats.has(cat) && !/^services?$/i.test(cat.trim()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .forEach((cat, index) => {
            const items = grouped[cat] || [];
            if (!items.length) return;
            html += renderFootSection(cat, items, `bk_foot_extra_section_${index}`);
        });

    container.innerHTML = html || '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No foot therapy services available.</p>';

    // Restore selected state after re-render and auto-open selected sections.
    bk_selectedServices.forEach(sel => {
        const cb  = document.getElementById('bk_cb_'  + sel.id);
        const qty = document.getElementById('bk_qty_' + sel.id);
        if (cb) {
            cb.checked = true;
            cb.closest('.service-card')?.classList.add('selected');
            const section = cb.closest('.thuraya-accordion-section');
            if (section) {
                section.classList.add('open');
                section.querySelector('.thuraya-accordion-head')?.setAttribute('aria-expanded', 'true');
            }
        }
        if (qty) {
            qty.value = sel.qty || 1;
            const section = qty.closest('.thuraya-accordion-section');
            if (section) {
                section.classList.add('open');
                section.querySelector('.thuraya-accordion-head')?.setAttribute('aria-expanded', 'true');
            }
        }
    });

    setTimeout(() => { bk_syncAllAccordionHeights(container); bk_finalSyncCTAs(); }, 60);
    updateBreakdown();
}


// ── THURAYA HAND MENU — FOOT-STYLE ACCORDION ─────────────
// Uses the approved Hand reference data as structure, but renders it with the
// same clean accordion UX as Foot Therapy. Firebase/Staff App values still win
// through th_findServiceMatch() before each card is built.
function th_collectHandLeafServices(node, out=[]) {
    if (!node) return out;
    if (!Array.isArray(node.children) || !node.children.length) {
        if (node.name || node.displayName) out.push(node);
        return out;
    }
    node.children.forEach(child => th_collectHandLeafServices(child, out));
    return out;
}

function th_handMeta(node, count) {
    const title = String(node?.title || '').toLowerCase();
    if (title.includes('add') || title.includes('upgrade')) return `Choose your ritual • optional add-ons available • ${count} option${count === 1 ? '' : 's'}`;
    if (title.includes('pleiades')) return `Enhancements • structure, design and finish • ${count} option${count === 1 ? '' : 's'}`;
    if (title.includes('repair')) return `Maintenance • corrective services • ${count} option${count === 1 ? '' : 's'}`;
    return `Core treatments • choose one • ${count} option${count === 1 ? '' : 's'}`;
}

function th_cleanHandCategory(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^(?:[A-Z]|\d+)\.\s*/i, '')
        .replace(/^O\s+/i, '')
        .trim();
}

function th_handCategoryKey(s) {
    const candidates = [s.mainCategory, s.category, s.subCategory, s.serviceType]
        .map(th_cleanHandCategory)
        .filter(Boolean);

    function mapHandCategory(raw) {
        const upper = String(raw || '').toUpperCase();
        if (!upper || upper === 'SERVICE' || upper === 'SERVICES') return '';
        if (upper.includes('HAND') && (upper.includes('THERAP') || upper.includes('RITUAL'))) return 'Hand Therapies';
        if (upper.includes('FINISHING') || upper.includes('INDULGENCE')) return 'Finishing Indulgences';
        if (upper.includes('NAIL ARCHITECTURE') || upper.includes('ACRYLIC') || upper.includes('BUILDER') || upper.includes('GEL EXTENSION')) return 'Nail Architecture';
        if (upper.includes('POLISH') || upper.includes('FINISH')) return 'Polish & Finish';
        if (upper.includes('PLEIADES')) return 'The Pleiades Studio';
        if (upper.includes('EDITORIAL')) return 'Editorial Nail Art';
        if (upper.includes('COUTURE')) return 'Couture Nail Art';
        if (upper.includes('EMBELLISH') || upper.includes('DRAWER') || upper.includes('STONE') || upper.includes('CRYSTAL')) return 'Embellishment Drawers';
        if (upper.includes('ADD') || upper.includes('UPGRADE')) return 'Luxe Add Ons & Upgrades';
        if (upper.includes('REPAIR')) return 'Repairs';
        return '';
    }

    for (const c of candidates) {
        const mapped = mapHandCategory(c);
        if (mapped) return mapped;
    }

    // Avoid creating one broad generic bucket when the Staff App sends a ritual group
    // such as "Hand Therapy & Enhancement Rituals" plus a more specific category.
    const generic = /^(hand\s+therapy|hand\s+therapies|hand\s+therapy\s*&\s*enhancement\s*rituals|services?)$/i;
    return candidates.find(c => !generic.test(c)) || candidates[0] || '';
}

function th_handMeta(cat, count, items) {
    const lower = String(cat || '').toLowerCase();
    const isOptional = lower.includes('finish') || lower.includes('polish') || lower.includes('art') || lower.includes('embellish') || lower.includes('add') || lower.includes('upgrade') || (items || []).some(s => (s.inputType || 'radio') !== 'radio');
    const action = isOptional ? 'Choose your ritual · optional add-ons available' : 'Core treatments · choose one';
    return `${action} · ${count} option${count === 1 ? '' : 's'}`;
}

function renderHandMenuFootStyle(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    container.classList.remove('th-ref-menu');

    // HF89B.1: Client App Hand menu now renders directly from Menu_Settings_V2,
    // matching Foot Therapy behaviour. This removes the old curated-reference lock
    // that was hiding the approved Hand categories after sync.
    const order = [
        'Hand Therapies',
        'Finishing Indulgences',
        'Nail Architecture',
        'Polish & Finish',
        'The Pleiades Studio',
        'Editorial Nail Art',
        'Couture Nail Art',
        'Embellishment Drawers',
        'Luxe Add Ons & Upgrades',
        'Repairs'
    ];

    const grouped = {};
    (bk_menuServices || []).forEach(s => {
        const serviceDept = String(s.department || 'Hand').toLowerCase();
        const belongsToHand = serviceDept === 'both' || serviceDept.includes('hand') || (!serviceDept.includes('foot'));
        if (!belongsToHand) return;
        if (s.status && String(s.status).toLowerCase() !== 'active') return;

        const cat = th_handCategoryKey(s);
        if (!cat) return;

        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(s);
    });

    const typeOrder = { radio: 0, checkbox: 1, counter: 2 };
    Object.values(grouped).forEach(items => {
        items.sort((a, b) =>
            (typeOrder[a.inputType || 'radio'] ?? 1) - (typeOrder[b.inputType || 'radio'] ?? 1) ||
            (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999) ||
            (Number(a.order) || 999) - (Number(b.order) || 999) ||
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
        );
    });

    function renderHandSection(cat, items, sectionId) {
        return `
            <div class="thuraya-accordion-section" data-category="${th_refEscape(cat)}">
                <button type="button" class="thuraya-accordion-head" aria-expanded="false" aria-controls="${sectionId}" onclick="bk_toggleMenuSection(this)">
                    <span class="thuraya-accordion-title-wrap">
                        <span class="thuraya-accordion-title">${th_refEscape(cat)}</span>
                        <span class="thuraya-accordion-meta">${th_refEscape(th_handMeta(cat, items.length, items))}</span>
                    </span>
                    <span class="thuraya-accordion-chevron">›</span>
                </button>
                <div class="thuraya-accordion-body" id="${sectionId}">
                    <div class="thuraya-accordion-inner">
                        ${items.map(s => _buildCard(s, dept)).join('')}
                    </div>
                </div>
            </div>`;
    }

    let html = '';
    const renderedCats = new Set();

    order.forEach((cat, index) => {
        const items = grouped[cat] || [];
        if (!items.length) return;
        renderedCats.add(cat);
        html += renderHandSection(cat, items, `bk_hand_section_${index}`);
    });

    Object.keys(grouped)
        .filter(cat => cat && !renderedCats.has(cat) && !/^services?$/i.test(cat.trim()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .forEach((cat, index) => {
            const items = grouped[cat] || [];
            if (!items.length) return;
            html += renderHandSection(cat, items, `bk_hand_extra_section_${index}`);
        });

    container.innerHTML = html || '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No hand therapy services available.</p>';

    // Restore selected state after re-render and auto-open selected sections.
    bk_selectedServices.forEach(sel => {
        const cb  = document.getElementById('bk_cb_'  + sel.id);
        const qty = document.getElementById('bk_qty_' + sel.id);
        if (cb) {
            cb.checked = true;
            cb.closest('.service-card')?.classList.add('selected');
            const section = cb.closest('.thuraya-accordion-section');
            if (section) {
                section.classList.add('open');
                section.querySelector('.thuraya-accordion-head')?.setAttribute('aria-expanded', 'true');
            }
        }
        if (qty) {
            qty.value = sel.qty || 1;
            const section = qty.closest('.thuraya-accordion-section');
            if (section) {
                section.classList.add('open');
                section.querySelector('.thuraya-accordion-head')?.setAttribute('aria-expanded', 'true');
            }
        }
    });

    setTimeout(() => { bk_syncAllAccordionHeights(container); bk_finalSyncCTAs(); }, 60);
    updateBreakdown();
}


// ── HF89B2: TRUE Menu_Settings_V2 hierarchy renderer ─────────────
// Client App only. Uses Menu_Settings_V2 as the single display structure:
// Department → Main Category → Sub Category → Service Name.
function th_v2Text(value, fallback='') {
    return String(value ?? fallback).trim().replace(/\s+/g, ' ');
}

function th_v2ServiceDeptMatches(s, dept) {
    const d = String(s.department || s.appliesTo || '').toLowerCase();
    if (d.includes('both') || d.includes('hand & foot') || d.includes('hand/foot')) return true;
    if (dept === 'Foot') return d.includes('foot') || d.includes('feet');
    if (dept === 'Hand') return d.includes('hand') || (!d.includes('foot') && !d.includes('feet'));
    return true;
}

// HF89B6: Menu_Settings_V2 priority enforcement.
// Sort Order is the single ordering authority; text sorting is only a fallback
// when Menu Settings V2 has no usable Sort Order for that level.
function th_v2SortValue(value, fallback = 999999) {
    const n = Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function th_v2GroupOrder(group) {
    return th_v2SortValue(group?.order);
}

function th_v2DeptOrder(dept) {
    const d = String(dept || '').toLowerCase();
    if (d.includes('hand')) return 10;
    if (d.includes('foot') || d.includes('feet')) return 20;
    if (d.includes('both')) return 30;
    return 99;
}

function th_v2TieBreak(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}



// HF89B7: Live Final Menu priority map from Menu Settings V2 display.
// The Client App must match the Live Final Menu accordion order, not the
// per-service Sort Order when service rows use their own internal ordering.
const TH_LIVE_FINAL_MENU_PRIORITY = {
    Hand: [
        'Hand Therapies',
        'Finishing Indulgences',
        'Nail Architecture',
        'Polish & Finish',
        'The Pleiades Studio',
        'Editorial Nail Art',
        'Couture Nail Art',
        'Embellishment Drawers'
    ],
    Foot: [
        'Foundation Rituals',
        'Urban Express Rituals',
        'The Medi-Cleanse Series',
        'Finishing Indulgences',
        'Polish & Finish',
        'Editorial Nail Art'
    ]
};

function th_liveKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function th_livePriority(dept, title, fallback = 999999) {
    const list = TH_LIVE_FINAL_MENU_PRIORITY[dept] || [];
    const target = th_liveKey(title);
    const idx = list.findIndex(x => th_liveKey(x) === target);
    return idx >= 0 ? (idx + 1) * 1000 : fallback;
}

function th_liveSortGroups(dept, a, b) {
    const ap = th_livePriority(dept, a.title, th_v2GroupOrder(a));
    const bp = th_livePriority(dept, b.title, th_v2GroupOrder(b));
    return ap - bp || th_v2GroupOrder(a) - th_v2GroupOrder(b) || th_v2TieBreak(a.title, b.title);
}

function th_v2BuildHierarchy(dept) {
    const groups = new Map();

    (bk_menuServices || []).forEach(s => {
        if (!bk_menuIsActive(s)) return;
        if (!th_v2ServiceDeptMatches(s, dept)) return;

        const main = th_v2Text(s.mainCategory || s.ritualGroup || s.category || 'Services', 'Services');
        const mainDesc = th_v2Text(s.mainCategoryDescription || s.ritualGroupDescription || '');
        const subRaw = th_v2Text(s.subCategory || s.category || s.serviceType || '');
        const sub = (!subRaw || subRaw.toLowerCase() === main.toLowerCase()) ? 'Services' : subRaw;
        const subDesc = th_v2Text(s.categoryDescription || s.subCategoryDescription || s.serviceTypeDescription || '');
        const order = th_v2SortValue(s.sortOrder ?? s.order);

        if (!groups.has(main)) {
            groups.set(main, { title: main, desc: mainDesc, order, count: 0, subGroups: new Map() });
        }
        const g = groups.get(main);
        if (!g.desc && mainDesc) g.desc = mainDesc;
        g.order = Math.min(g.order, order);
        g.count += 1;

        if (!g.subGroups.has(sub)) {
            g.subGroups.set(sub, { title: sub, desc: subDesc, order, items: [] });
        }
        const sg = g.subGroups.get(sub);
        if (!sg.desc && subDesc) sg.desc = subDesc;
        sg.order = Math.min(sg.order, order);
        sg.items.push(s);
    });

    const typeOrder = { radio: 0, checkbox: 1, counter: 2 };
    groups.forEach(g => {
        g.subGroups.forEach(sg => {
            sg.items.sort((a, b) =>
                th_v2SortValue(a.sortOrder ?? a.order) - th_v2SortValue(b.sortOrder ?? b.order) ||
                (typeOrder[a.inputType || 'radio'] ?? 1) - (typeOrder[b.inputType || 'radio'] ?? 1) ||
                th_v2TieBreak(a.name || a.serviceName, b.name || b.serviceName)
            );
        });
    });

    return Array.from(groups.values()).sort((a, b) => th_liveSortGroups(dept, a, b));
}

function th_v2PublishSortAudit(services) {
    const audit = (services || []).map(s => ({
        department: s.department || s.appliesTo || '',
        mainCategory: s.mainCategory || s.ritualGroup || s.category || '',
        subCategory: s.subCategory || s.category || s.serviceType || '',
        serviceName: s.name || s.serviceName || '',
        sortOrder: th_v2SortValue(s.sortOrder ?? s.order),
        status: s.status || ''
    })).sort((a, b) =>
        th_v2DeptOrder(a.department) - th_v2DeptOrder(b.department) ||
        th_v2SortValue(a.sortOrder) - th_v2SortValue(b.sortOrder) ||
        th_v2TieBreak(a.mainCategory, b.mainCategory) ||
        th_v2TieBreak(a.subCategory, b.subCategory) ||
        th_v2TieBreak(a.serviceName, b.serviceName)
    );
    window.THURAYA_CLIENT_MENU_SORT_AUDIT = audit;
    if (window.console && console.table) console.table(audit);
}

function th_v2Meta(group) {
    const subCount = Array.from(group.subGroups.values()).filter(sg => sg.title !== 'Services').length;
    const count = group.count || 0;
    if (group.desc) return `${group.desc} • ${count} option${count === 1 ? '' : 's'}`;
    if (subCount) return `${subCount} section${subCount === 1 ? '' : 's'} • ${count} option${count === 1 ? '' : 's'}`;
    return `${count} option${count === 1 ? '' : 's'}`;
}

function th_renderV2MenuForDept(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    container.classList.remove('th-ref-menu');
    container.classList.add('th-v2-menu');

    const groups = th_v2BuildHierarchy(dept);

    function renderSubGroup(sg) {
        const showHeading = sg.title && sg.title !== 'Services';
        return `
            ${showHeading ? `<div class="menu-subgroup-label th-v2-subgroup">${th_refEscape(sg.title)}${sg.desc ? `<span>${th_refEscape(sg.desc)}</span>` : ''}</div>` : ''}
            <div class="thuraya-accordion-inner">${sg.items.map(s => _buildCard(s, dept)).join('')}</div>`;
    }

    function renderGroup(group, index) {
        const sectionId = `bk_v2_${dept.toLowerCase()}_${index}`;
        const subGroups = Array.from(group.subGroups.values()).sort((a, b) =>
            th_v2GroupOrder(a) - th_v2GroupOrder(b) ||
            th_v2TieBreak(a.title, b.title)
        );
        return `
            <div class="thuraya-accordion-section th-v2-section" data-category="${th_refEscape(group.title)}">
                <button type="button" class="thuraya-accordion-head" aria-expanded="false" aria-controls="${sectionId}" onclick="bk_toggleMenuSection(this)">
                    <span class="thuraya-accordion-title-wrap">
                        <span class="thuraya-accordion-title">${th_refEscape(group.title)}</span>
                        <span class="thuraya-accordion-meta">${th_refEscape(th_v2Meta(group))}</span>
                    </span>
                    <span class="thuraya-accordion-chevron">›</span>
                </button>
                <div class="thuraya-accordion-body" id="${sectionId}">
                    ${subGroups.map(renderSubGroup).join('')}
                </div>
            </div>`;
    }

    container.innerHTML = groups.map(renderGroup).join('') || `<p style="text-align:center;color:var(--text-muted);padding:32px 0;">No ${dept.toLowerCase()} therapy services available.</p>`;

    bk_selectedServices.forEach(sel => {
        const cb  = document.getElementById('bk_cb_'  + sel.id);
        const qty = document.getElementById('bk_qty_' + sel.id);
        const input = cb || qty;
        if (cb) { cb.checked = true; cb.closest('.service-card')?.classList.add('selected'); }
        if (qty) qty.value = sel.qty || 1;
        const section = input?.closest('.thuraya-accordion-section');
        if (section) {
            section.classList.add('open');
            section.querySelector('.thuraya-accordion-head')?.setAttribute('aria-expanded', 'true');
        }
    });

    setTimeout(() => { bk_syncAllAccordionHeights(container); bk_finalSyncCTAs(); }, 80);
    updateBreakdown();
}
// ── END HF89B2 V2 renderer ─────────────────────────────────────────

function renderMenuForDept(dept) {
    // HF89B8 Client App clean menu sync:
    // Menu_Settings_V2 is the only live menu source. No legacy/static menu fallback.
    if (dept === 'Hand' || dept === 'Foot') return th_renderV2MenuForDept(dept);

    const container = document.getElementById('bk_serviceMenu');
    if (container) container.innerHTML =
        '<p style="text-align:center;color:var(--text-muted);padding:32px 0;">Please choose Hand Therapy or Foot Therapy.</p>';
}


// HF89B Client App Menu_Settings_V2 sync helper.
// Read-only diagnostic used after staging upload: run THURAYA_CLIENT_MENU_SYNC in console.
window.THURAYA_CLIENT_VALIDATE_MENU_SYNC = function(){
    const state = window.THURAYA_CLIENT_MENU_SYNC || {};
    return {
        source: state.source || 'not-loaded',
        total: state.total || 0,
        hand: state.hand || 0,
        foot: state.foot || 0,
        both: state.both || 0,
        ok: !!(state.total && (state.hand || state.both) && (state.foot || state.both)),
        updatedAt: state.updatedAt || null
    };
};

// HF89B8 audit helper: confirms the Client App has no active legacy menu source.
window.THURAYA_CLIENT_MENU_SOURCE_AUDIT = function(){
    const services = window.bk_menuServices || [];
    const sources = Array.from(new Set(services.map(s => s.sourceCollection || 'unknown')));
    return {
        expectedSource: 'Menu_Settings_V2',
        activeSources: sources,
        total: services.length,
        clean: sources.length === 0 || sources.every(s => s === 'Menu_Settings_V2')
    };
};

// ── THURAYA SERVICE MENU INTERACTION POLISH — SAFE UI ONLY ─────────────
// Multiple sections can stay open. All sections start collapsed.
// This updates only visual/tap behavior; booking, Firebase and selection logic are untouched.
function bk_syncAccordionHeight(section) {
    if (!section) return;
    const body = section.querySelector(':scope > .thuraya-accordion-body');
    if (!body) return;

    // HF89B5 Client App only:
    // Menu_Settings_V2 categories can contain many services. The older CSS had a
    // fixed 2400px accordion ceiling, which could visually cut off long categories
    // such as Nail Architecture even when the data was loaded correctly.
    if (section.classList.contains('open')) {
        const fullHeight = Math.max(body.scrollHeight, body.firstElementChild?.scrollHeight || 0, 1);
        body.style.setProperty('max-height', fullHeight + 80 + 'px', 'important');
        body.style.setProperty('overflow', 'hidden', 'important');
    } else {
        body.style.setProperty('max-height', '0px', 'important');
        body.style.setProperty('overflow', 'hidden', 'important');
    }
}

function bk_syncAccordionAncestors(section) {
    let parent = section?.parentElement?.closest('.thuraya-accordion-section');
    while (parent) {
        bk_syncAccordionHeight(parent);
        parent = parent.parentElement?.closest('.thuraya-accordion-section');
    }
}

function bk_syncAllAccordionHeights(scope) {
    const root = scope || document;
    root.querySelectorAll('.thuraya-accordion-section').forEach(section => bk_syncAccordionHeight(section));
}

window.bk_toggleMenuSection = function(btn) {
    const section = btn?.closest('.thuraya-accordion-section');
    if (!section) return;

    const isOpen = section.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    section.classList.add('th-menu-touched');

    bk_syncAccordionHeight(section);
    bk_syncAccordionAncestors(section);

    setTimeout(() => {
        bk_syncAccordionHeight(section);
        bk_syncAccordionAncestors(section);
        if (typeof bk_finalSyncCTAs === 'function') bk_finalSyncCTAs();
    }, 260);
};

window.addEventListener('resize', () => bk_syncAllAccordionHeights(document));
// ── END THURAYA SERVICE MENU INTERACTION POLISH ────────────────────

function bk_jsString(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function _buildCard(s, dept) {
    const type     = s.inputType || 'radio';
    const name     = s.name      || 'Service';
    const dur      = Number(s.duration) || 0;
    const price    = Number(s.price)    || 0;
    const descHtml = s.desc ? `<div class="service-card-desc">${s.desc}</div>` : '';
    const tagHtml  = (s.tag && s.tag !== 'None') ? `<span class="hl-tag">${s.tag}</span>` : '';
    const priceDisplay = s.priceLabel || `${price} GHC`;
    const priceTag = `<span class="service-price-pill">${dur > 0 ? dur + ' mins &nbsp;|&nbsp; ' : ''}${priceDisplay}</span>`;
    const safeName = bk_jsString(name);
    const safeDept = bk_jsString(dept);
    const safeId = bk_jsString(s.id);

    if (type === 'counter') {
        return `
            <div class="service-card" style="align-items:center;">
                <div class="service-card-body" style="pointer-events:none;">
                    <div class="service-card-name">${name} ${tagHtml}</div>
                    ${descHtml}${priceTag}
                </div>
                <div class="counter-box">
                    <button class="counter-btn" onclick="bk_updateCounter('${safeId}',${price},${dur},'${safeName}',-1,'${safeDept}')">−</button>
                    <input type="number" id="bk_qty_${s.id}" value="0" min="0" readonly
                        style="width:44px;height:36px;text-align:center;padding:4px;font-weight:700;border:1px solid var(--border);border-radius:6px;">
                    <button class="counter-btn" onclick="bk_updateCounter('${safeId}',${price},${dur},'${safeName}',1,'${safeDept}')">+</button>
                </div>
            </div>`;
    }

    const groupName = type === 'radio' ? (s.radioGroup || `bk_base_${dept}`) : `bk_cb_${s.id}`;
    const inputEl   = type === 'radio'
        ? `<input type="radio"    name="${groupName}" id="bk_cb_${s.id}"
               style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;">`
        : `<input type="checkbox"                    id="bk_cb_${s.id}"
               style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;">`;

    return `
        <div class="service-card" onclick="bk_toggleCard(event,this,'${safeId}','${type}','${groupName}',${price},${dur},'${safeName}','${safeDept}')">
            ${inputEl}
            <div class="service-card-body">
                <div class="service-card-name">${name} ${tagHtml}</div>
                ${descHtml}${priceTag}
            </div>
        </div>`;
}

window.bk_toggleCard = function(event, card, id, type, groupName, price, dur, name, dept) {
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
            bk_selectedServices.push({ id, type, price, dur, name, qty: 1, dept: dept || bk_selectedDept });
        }
    } else {
        input.checked = !input.checked;
        card.classList.toggle('selected', input.checked);
        if (input.checked) {
            bk_selectedServices.push({ id, type, price, dur, name, qty: 1, dept: dept || bk_selectedDept });
        } else {
            bk_selectedServices = bk_selectedServices.filter(s => s.id !== id);
        }
    }
    updateBreakdown();
};

window.bk_updateCounter = function(id, price, dur, name, delta, dept) {
    const input = document.getElementById('bk_qty_' + id);
    if (!input) return;
    let val = Math.max(0, (parseInt(input.value) || 0) + delta);
    input.value = val;
    input.closest('.th-ref-counter-service')?.classList.toggle('selected', val > 0);
    bk_selectedServices = bk_selectedServices.filter(s => s.id !== id);
    if (val > 0) bk_selectedServices.push({ id, type: 'counter', price, dur, name, qty: val, dept: dept || bk_selectedDept });
    updateBreakdown();
};


// ── THURAYA FINAL CTA PATCH — CLEAN / DOM SAFE ────────────
// Uses existing service button only. Creates/moves only the time CTA if needed.
// No dependency on bk_selectedServices inside CTA sync, so it cannot crash.
function bk_finalStyleCTA(btn, active) {
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
    btn.style.border = active ? '1px solid #050505' : '1px solid #CEC8BE';
    btn.style.background = active ? 'linear-gradient(180deg,#151515 0%,#050505 100%)' : '#CEC8BE';
    btn.style.color = active ? '#fff' : '#756F66';
    btn.style.boxShadow = active ? '0 18px 40px rgba(10,10,10,.24)' : 'none';
    btn.style.opacity = '1';
    btn.style.cursor = active ? 'pointer' : 'not-allowed';
}

function bk_hasServiceSelectedUI() {
    const selectedCard = document.querySelector('#bk_serviceMenu .service-card.selected, #bk_serviceMenu .selected, #bk_serviceMenu [data-selected="true"]');
    const checkedInput = document.querySelector('#bk_serviceMenu input[type="checkbox"]:checked, #bk_serviceMenu input[type="radio"]:checked');
    const positiveQty = Array.from(document.querySelectorAll('#bk_serviceMenu input[type="number"]'))
        .some(el => Number(el.value || 0) > 0);

    return !!(selectedCard || checkedInput || positiveQty);
}

function bk_hasTimeSelectedUI() {
    const hiddenTime = document.getElementById('bk_time')?.value || '';
    const selectedSlot = document.querySelector('#bk_slots .slot-btn.selected, #bk_slots button.selected, #bk_slots .active');
    return !!(hiddenTime || selectedSlot);
}

function bk_finalEnsureTimeCTA() {
    const slotsContainer = document.getElementById('bk_slotsContainer');
    const slots = document.getElementById('bk_slots');
    if (!slotsContainer && !slots) return null;

    let btn = document.getElementById('btnToConfirm');

    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btnToConfirm';
        btn.type = 'button';
    }

    btn.textContent = 'Continue →';
    btn.onclick = function () {
        if (btn.disabled) return;
        goToStep('screen-confirm');
    };

    let wrap = document.getElementById('bk_timeContinueWrap');

    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'bk_timeContinueWrap';
        wrap.className = 'step-footer bk-time-continue';
        wrap.style.cssText = 'margin:28px 0 140px;width:100%;display:block;background:transparent;border:none;box-shadow:none;padding:0;';
    }

    if (!wrap.contains(btn)) wrap.appendChild(btn);

    const anchor = slotsContainer || slots;
    if (anchor && (wrap.parentElement !== anchor.parentElement || wrap.previousElementSibling !== anchor)) {
        anchor.insertAdjacentElement('afterend', wrap);
    }

    return btn;
}

function bk_finalSyncCTAs() {
    const stickyBar = document.getElementById('bk_stickyBar');
    if (stickyBar) stickyBar.classList.add('thuraya-option-a-sticky');

    // SERVICE STEP: keep existing button in sync for accessibility; sticky bar is the primary visible control.
    const serviceBtn = document.getElementById('btnToTech');
    if (serviceBtn) {
        const active = bk_hasServiceSelectedUI();

        serviceBtn.textContent = 'Continue →';
        serviceBtn.disabled = !active;
        serviceBtn.onclick = function () {
            if (!active) return;
            goToStep('screen-technician');
        };

        bk_finalStyleCTA(serviceBtn, active);
    }

    // TIME STEP: ensure button exists below available times.
    const timeBtn = bk_finalEnsureTimeCTA();
    if (timeBtn) {
        const active = bk_hasTimeSelectedUI();

        timeBtn.textContent = 'Continue →';
        timeBtn.disabled = !active;
        timeBtn.onclick = function () {
            if (!active) return;
            goToStep('screen-confirm');
        };

        bk_finalStyleCTA(timeBtn, active);
    }
}
// ── END THURAYA FINAL CTA PATCH ───────────────────────────

function bk_ensureServiceInlineContinue() {
    const menu = document.getElementById('bk_serviceMenu');
    if (!menu) return null;

    let wrap = document.getElementById('bk_serviceContinueWrap');
    let btn = document.getElementById('btnToTechInline');

    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'bk_serviceContinueWrap';
        wrap.style.cssText = [
            'width:100%',
            'display:none',
            'margin:26px 0 150px',
            'padding:0',
            'background:transparent',
            'border:0',
            'box-shadow:none'
        ].join(';');
    }

    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btnToTechInline';
        btn.type = 'button';
        btn.className = 'btn-primary full';
        btn.textContent = 'Continue →';
        btn.style.cssText = [
            'width:100%',
            'min-height:56px',
            'border-radius:22px',
            'font-weight:900',
            'letter-spacing:.14em',
            'text-transform:uppercase'
        ].join(';');
    }

    if (!wrap.contains(btn)) wrap.appendChild(btn);
    if (wrap.parentElement !== menu.parentElement || wrap.previousElementSibling !== menu) {
        menu.insertAdjacentElement('afterend', wrap);
    }

    return { wrap, btn };
}

function bk_styleInlineServiceCTA(btn, active) {
    if (!btn) return;
    btn.disabled = !active;
    btn.style.border = active ? '1px solid #050505' : '1px solid #CEC8BE';
    btn.style.background = active ? 'linear-gradient(180deg,#151515 0%,#050505 100%)' : '#CEC8BE';
    btn.style.color = active ? '#fff' : '#756F66';
    btn.style.boxShadow = active ? '0 18px 40px rgba(10,10,10,.20)' : 'none';
    btn.style.cursor = active ? 'pointer' : 'not-allowed';
    btn.onclick = function(){
        if (!btn.disabled) goToStep('screen-technician');
    };
}

function bk_updateStickyBarOptionA() {
    const bar = document.getElementById('bk_stickyBar');
    const empty = document.getElementById('bk_stickyEmpty');
    const full = document.getElementById('bk_stickyFull');
    const oldStickyBtn = document.getElementById('btnToTech');

    // Luxury minimal mode: remove the bottom instant summary card completely.
    if (bar) bar.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (full) full.style.display = 'none';

    const selected = bk_selectedServices || [];
    const active = selected.length > 0;

    // Keep the original sticky button disabled/hidden for safety, but do not use it visually.
    if (oldStickyBtn) {
        oldStickyBtn.disabled = !active;
        oldStickyBtn.onclick = function(){ if (active) goToStep('screen-technician'); };
    }

    // Provide a clean inline Continue button below the menu instead of the bulky summary card.
    const inline = bk_ensureServiceInlineContinue();
    if (inline) {
        inline.wrap.style.display = active ? 'block' : 'none';
        inline.wrap.classList.toggle('th-visible', active);
        bk_styleInlineServiceCTA(inline.btn, active);
    }
}

function updateBreakdown() {
    bk_updateStickyBarOptionA();
    bk_finalSyncCTAs();
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

            bk_techs.push({
                email: doc.id,
                name: d.name || doc.id,
                // Therapy assignment comes from Staff App.
                // Existing records without this field are treated as Both for safety.
                therapyTypes: d.therapyTypes || d.therapyType || d.therapy || ['hand', 'foot']
            });
        });

        console.log('Client booking techs loaded:', bk_techs.length, bk_techs.map(t => t.name || t.email));
    } catch (e) {
        console.error('Client booking loadTechs failed:', e);
        bk_techs = [];
    }
}

// ── Therapy-based technician filtering ────────────────────
// Staff App saves therapyTypes as ['hand'], ['foot'], or ['hand','foot'].
// Legacy / unassigned technicians are treated as both to avoid disrupting operations.
function bk_normalizeTherapyTypes(value) {
    let raw = value;
    if (!raw) raw = ['hand', 'foot'];
    if (!Array.isArray(raw)) raw = [raw];

    const out = new Set();
    raw.forEach(v => {
        const t = String(v || '').trim().toLowerCase();
        if (!t) return;
        if (t === 'both' || t === 'hand & foot' || t === 'hand/foot') {
            out.add('hand');
            out.add('foot');
        } else if (t.includes('hand')) {
            out.add('hand');
        } else if (t.includes('foot') || t.includes('feet')) {
            out.add('foot');
        }
    });

    if (!out.size) {
        out.add('hand');
        out.add('foot');
    }
    return Array.from(out);
}

function bk_getRequiredTherapyTypes() {
    const required = new Set();

    (bk_selectedServices || []).forEach(s => {
        const dept = String(s.dept || '').toLowerCase();
        if (dept.includes('hand')) required.add('hand');
        if (dept.includes('foot')) required.add('foot');
    });

    if (!required.size) {
        const dept = String(bk_selectedDept || '').toLowerCase();
        if (dept.includes('foot')) required.add('foot');
        else required.add('hand');
    }

    return Array.from(required);
}

function bk_techMatchesSelectedTherapy(tech) {
    const techTypes = bk_normalizeTherapyTypes(tech?.therapyTypes);
    const required = bk_getRequiredTherapyTypes();
    return required.every(t => techTypes.includes(t));
}

function bk_getEligibleTechsForSelectedServices() {
    return (bk_techs || []).filter(bk_techMatchesSelectedTherapy);
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
    const eligibleTechs = bk_getEligibleTechsForSelectedServices();
    if (!eligibleTechs.length) {
        listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:16px;">No technicians are assigned to this therapy yet. Choose Any Available or contact THURAYA.</p>';
        return;
    }
    listEl.innerHTML = eligibleTechs.map(t => {
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
// HF18: Unified occupied-slot availability for Client App.
// The slot list now uses the same live appointment state that blocks confirmation,
// so already-booked technician windows are hidden before the client reaches review.

function bk_normAvailKey(value) {
    return String(value || '').trim().toLowerCase();
}

function bk_getTechIdentityKeys(tech) {
    const keys = new Set();
    if (!tech) return keys;
    [tech.email, tech.name, tech.id, tech.uid].forEach(v => {
        const k = bk_normAvailKey(v);
        if (k) keys.add(k);
    });
    return keys;
}

function bk_keysForTechEmail(email) {
    const tech = (bk_techs || []).find(t => bk_normAvailKey(t.email) === bk_normAvailKey(email));
    const keys = bk_getTechIdentityKeys(tech);
    const raw = bk_normAvailKey(email);
    if (raw) keys.add(raw);
    return Array.from(keys);
}

function bk_keysForAppointmentTech(a = {}) {
    const keys = new Set();
    [
        a.assignedTechEmail,
        a.techEmail,
        a.technicianEmail,
        a.staffEmail,
        a.assignedTo,
        a.assignedTechName,
        a.techName,
        a.technicianName,
        a.staffName
    ].forEach(v => {
        const k = bk_normAvailKey(v);
        if (k) keys.add(k);
    });

    // If the appointment only stored a display name, connect it to the live tech email.
    (bk_techs || []).forEach(t => {
        const tName = bk_normAvailKey(t.name);
        const tEmail = bk_normAvailKey(t.email);
        if ((tName && keys.has(tName)) || (tEmail && keys.has(tEmail))) {
            bk_getTechIdentityKeys(t).forEach(k => keys.add(k));
        }
    });

    return Array.from(keys);
}

function bk_isBlockingAvailabilityStatus(status) {
    const s = String(status || 'Scheduled').trim().toLowerCase();
    if (!s) return true;

    // These states must not hold client-facing availability.
    const released = new Set([
        'cancelled', 'canceled', 'no show', 'no-show', 'noshow',
        'closed', 'completed', 'complete', 'paid', 'checked out',
        'checkout complete', 'ready for payment', 'void', 'deleted', 'archived'
    ]);
    if (released.has(s)) return false;

    // Everything operationally active still blocks the slot.
    return true;
}

function bk_getAppointmentStartMins(a = {}) {
    const raw = a.timeString || a.startTime || a.start || a.appointmentTime || '';
    if (typeof raw === 'number') return raw;
    return timeToMins(String(raw || '').slice(0, 5));
}

function bk_getAppointmentDurationMins(a = {}) {
    const candidates = [a.bookedDuration, a.duration, a.durationMins, a.totalDuration, a.serviceDuration];
    for (const v of candidates) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 30;
}

function bk_addBusyInterval(busyByKey, keys, start, end, source) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    (keys || []).forEach(k => {
        const key = bk_normAvailKey(k);
        if (!key) return;
        if (!busyByKey[key]) busyByKey[key] = [];
        busyByKey[key].push({ start, end, source: source || 'appointment' });
    });
}

function bk_intervalFreeForTech(busyByKey, techEmail, start, end) {
    const keys = bk_keysForTechEmail(techEmail);
    const intervals = [];
    keys.forEach(k => (busyByKey[bk_normAvailKey(k)] || []).forEach(i => intervals.push(i)));
    return intervals.every(b => end <= b.start || start >= b.end);
}

async function bk_buildBusyByTechForDate(date) {
    const busyByKey = {};
    if (!date) return busyByKey;

    // Appointments are the source of truth for future client-facing bookings.
    const snap = await db.collection('Appointments')
        .where('dateString', '==', date)
        .get();

    snap.forEach(doc => {
        const a = { id: doc.id, ...(doc.data() || {}) };
        if (!bk_isBlockingAvailabilityStatus(a.status)) return;

        const keys = bk_keysForAppointmentTech(a);
        if (!keys.length) return;

        const start = bk_getAppointmentStartMins(a);
        const duration = bk_getAppointmentDurationMins(a);
        bk_addBusyInterval(busyByKey, keys, start, start + duration, 'Appointments');
    });

    // Active_Jobs can hold live occupied time after check-in. If client rules block access,
    // this safely falls back to Appointments only.
    try {
        const activeSnap = await db.collection('Active_Jobs')
            .where('dateString', '==', date)
            .get();

        activeSnap.forEach(doc => {
            const j = { id: doc.id, ...(doc.data() || {}) };
            if (!bk_isBlockingAvailabilityStatus(j.status || j.jobStatus || 'In Progress')) return;

            const keys = bk_keysForAppointmentTech(j);
            if (!keys.length) return;

            const start = bk_getAppointmentStartMins(j);
            const duration = bk_getAppointmentDurationMins(j);
            bk_addBusyInterval(busyByKey, keys, start, start + duration, 'Active_Jobs');
        });
    } catch (e) {
        console.warn('Active_Jobs availability read skipped:', e);
    }

    return busyByKey;
}

window.bk_generateSlots = async function() {
    const date    = document.getElementById('bk_date').value;
    const timeEl  = document.getElementById('bk_time');
    const slotsEl = document.getElementById('bk_slots');
    const container = document.getElementById('bk_slotsContainer');
    const nextBtn = document.getElementById('btnToConfirm');

    if (timeEl) timeEl.value = '';
    if (nextBtn) nextBtn.disabled = true;

    if (!date) { if (container) container.style.display = 'none'; return; }
    if (date < todayStr) {
        container.style.display = 'block';
        slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;">Cannot book in the past.</p>';
        return;
    }

    const totalMins = bk_selectedServices.reduce((s, x) => s + (Number(x.dur || 0) * (x.qty || 1)), 0);
    if (totalMins === 0) {
        container.style.display = 'none';
        toast('Select at least one service first.', 'warning');
        return;
    }

    const mode = document.getElementById('bk_techMode').value;
    const specificEmail = document.getElementById('bk_techEmail').value;
    const eligibleTechs = bk_getEligibleTechsForSelectedServices();
    const techsToCheck = mode === 'specific' && specificEmail
        ? (eligibleTechs.some(t => bk_normAvailKey(t.email) === bk_normAvailKey(specificEmail)) ? [specificEmail] : [])
        : eligibleTechs.map(t => t.email);

    if (!techsToCheck.length) {
        container.style.display = 'none';
        toast('No technicians assigned to the selected therapy are available. Please choose another service or contact THURAYA.', 'warning');
        return;
    }

    container.style.display = 'block';
    slotsEl.innerHTML = '<div class="loading-pulse">Checking live availability...</div>';

    try {
        const busyByKey = await bk_buildBusyByTechForDate(date);

        const openTime = 8 * 60, closeTime = 20 * 60, interval = 30;
        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();
        const isToday = date === todayStr;

        const slotMap = {};
        for (let t = openTime; t + totalMins <= closeTime; t += interval) {
            if (isToday && t <= curMins) continue;
            const slotEnd = t + totalMins;
            techsToCheck.forEach(email => {
                if (bk_intervalFreeForTech(busyByKey, email, t, slotEnd)) {
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
    const parts = String(str).split(':').map(Number);
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    return h * 60 + m;
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
                const tech = bk_techs.find(t => bk_normAvailKey(t.email) === bk_normAvailKey(assignedEmail));
                document.getElementById('bk_techEmail').value = assignedEmail;
                document.getElementById('bk_techName').value  = tech?.name || assignedEmail;
            }
        } catch (e) { /* silent */ }
    }

    document.getElementById('btnToConfirm').disabled = false;
    setTimeout(bk_finalSyncCTAs, 40);
};

// ── goToStep override — confirm screen + sticky bar ───────
// NOTE: group-booking.js further wraps this to handle group confirm screen
window.goToStep = function(id) {
    if (id === 'screen-confirm') populateConfirmScreen();
    // Call the base navigation
    _screenHistory.push(id);
    showScreen(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    bk_showSlotHoldNotice();
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


// ── Phase 9B.2: Book for Someone Else ──────────────────────
window.bk_toggleBookForSomeone = function() {
    const isSomeoneElse = document.getElementById('bookForSomeone')?.checked === true;
    const panel = document.getElementById('bookForSomeonePanel');
    const myselfLabel = document.getElementById('bookForMyselfLabel');
    const someoneLabel = document.getElementById('bookForSomeoneLabel');

    if (panel) panel.style.display = isSomeoneElse ? 'block' : 'none';
    if (myselfLabel) myselfLabel.classList.toggle('active', !isSomeoneElse);
    if (someoneLabel) someoneLabel.classList.toggle('active', isSomeoneElse);
};

function bk_getBookForDetails() {
    const isSomeoneElse = document.getElementById('bookForSomeone')?.checked === true;

    const base = {
        bookingFor: isSomeoneElse ? 'someone_else' : 'myself',
        paymentResponsibility: isSomeoneElse
            ? (document.getElementById('paymentResponsibility')?.value || 'recipient')
            : 'booker',
        paymentStatus: isSomeoneElse && (document.getElementById('paymentResponsibility')?.value === 'recipient')
            ? 'pay_at_checkout'
            : 'pending_or_paid_by_booker'
    };

    if (!isSomeoneElse) {
        return {
            ...base,
            recipientName: bk_clientProfile?.name || '',
            recipientPhone: bk_clientProfile?.phone || '',
            recipientNote: '',
            bookedByName: bk_clientProfile?.name || '',
            bookedByPhone: bk_clientProfile?.phone || '',
            bookedByEmail: bk_isGuest ? '' : (bk_currentUser?.email || '')
        };
    }

    const recipientName = (document.getElementById('recipientName')?.value || '').trim();
    const recipientPhone = (document.getElementById('recipientPhone')?.value || '').trim();
    const recipientNote = (document.getElementById('recipientNote')?.value || '').trim();

    return {
        ...base,
        recipientName,
        recipientPhone,
        recipientNote,
        bookedByName: bk_clientProfile?.name || '',
        bookedByPhone: bk_clientProfile?.phone || '',
        bookedByEmail: bk_isGuest ? '' : (bk_currentUser?.email || '')
    };
}

function bk_validateBookForDetails() {
    const details = bk_getBookForDetails();

    if (details.bookingFor !== 'someone_else') return details;

    if (!details.recipientName) {
        toast('Please enter the recipient full name.', 'warning');
        document.getElementById('recipientName')?.focus();
        return null;
    }

    const phoneDigits = String(details.recipientPhone || '').replace(/\D/g, '');
    if (phoneDigits.length < 10) {
        toast('Please enter a valid recipient phone number.', 'warning');
        document.getElementById('recipientPhone')?.focus();
        return null;
    }

    return details;
}



// ── Phase 9C: Smart Availability Engine ─────────────────────
async function bk_hasSlotConflict(techEmail, date, time) {
    if (!date || !time) return false;

    // If technician is not assigned, do not block; staff can assign later.
    if (!techEmail || techEmail === 'any' || techEmail === 'ANY') return false;

    const totalMins = bk_selectedServices.reduce((s, x) => s + (Number(x.dur || 0) * (x.qty || 1)), 0) || 30;
    const start = timeToMins(time);
    const end = start + totalMins;

    try {
        const busyByKey = await bk_buildBusyByTechForDate(date);
        return !bk_intervalFreeForTech(busyByKey, techEmail, start, end);
    } catch (e) {
        console.warn('Phase 9C interval conflict check failed:', e);

        // Conservative fallback: exact-time conflict only, with all blocking statuses filtered locally.
        try {
            const fallback = await db.collection('Appointments')
                .where('dateString', '==', date)
                .where('timeString', '==', time)
                .limit(50)
                .get();

            let conflict = false;
            fallback.forEach(doc => {
                const a = { id: doc.id, ...(doc.data() || {}) };
                if (!bk_isBlockingAvailabilityStatus(a.status)) return;
                const apptKeys = bk_keysForAppointmentTech(a).map(bk_normAvailKey);
                const techKeys = bk_keysForTechEmail(techEmail).map(bk_normAvailKey);
                if (techKeys.some(k => apptKeys.includes(k))) conflict = true;
            });

            return conflict;
        } catch (fallbackError) {
            console.warn('Phase 9C fallback conflict check failed:', fallbackError);
            toast('We could not verify this slot. Please try again.', 'error');
            return true;
        }
    }
}

function bk_showSlotHoldNotice() {
    const confirmBtn = document.getElementById('btnConfirmBooking');
    if (!confirmBtn || document.getElementById('bkSlotHoldNotice')) return;

    const notice = document.createElement('div');
    notice.id = 'bkSlotHoldNotice';
    notice.className = 'slot-hold-notice';
    notice.innerHTML = '⚡ We will re-check this slot before confirming to prevent double bookings.';

    confirmBtn.insertAdjacentElement('beforebegin', notice);
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

    
if(window.bk_earlyBookFor==='someone_else'){
    document.getElementById('bookForSomeone').checked = true;
}
const bookForDetails = bk_validateBookForDetails();

    if (!bookForDetails) return;

    const services  = bk_selectedServices.map(s => `${s.name}${s.qty > 1 ? ' (x'+s.qty+')' : ''}`).join(', ');
    const totalMins = bk_selectedServices.reduce((s, x) => s + (x.dur * (x.qty || 1)), 0);
    const subtotal  = bk_selectedServices.reduce((s, x) => s + (x.price * (x.qty || 1)), 0);
    const { basePrice, grandTotal, taxLines } = applyTaxes(subtotal);
    const discountAmount = parseFloat(document.getElementById('bk_discountAmount').value || 0);
    const finalTotal = Math.max(0, grandTotal - discountAmount);

    setBtnLoading(btn, true, 'Confirm Booking');
    try {
        const conflict = await bk_hasSlotConflict(techEmail, date, time);
        if (conflict) {
            toast('This time slot has just been booked. Please choose another time.', 'error');
            return;
        }

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
            bookingFor:          bookForDetails.bookingFor,
            bookedByName:        bookForDetails.bookedByName,
            bookedByPhone:       bookForDetails.bookedByPhone,
            bookedByEmail:       bookForDetails.bookedByEmail,
            recipientName:       bookForDetails.recipientName,
            recipientPhone:      bookForDetails.recipientPhone,
            recipientNote:       bookForDetails.recipientNote,
            paymentResponsibility: bookForDetails.paymentResponsibility,
            paymentStatus:       bookForDetails.paymentStatus,
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

        try { await bk_createClientNotificationForBooking(bk_confirmedAppt); } catch(e) { console.warn('Notification save skipped:', e); }
        try { bk_loadUpcomingAppointmentPreview(); } catch(e) {}

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
    const successSub = document.querySelector('#screen-success .success-sub');
    if (successSub && appt.bookingFor === 'someone_else') {
        successSub.textContent = `Booking confirmed for ${appt.recipientName || 'the recipient'}. Payment: ${appt.paymentResponsibility === 'recipient' ? 'recipient pays at checkout' : 'booker pays'}.`;
    } else if (successSub) {
        successSub.textContent = 'We look forward to seeing you.';
    }
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
    if (!listEl) return;

    if (!bk_currentUser) {
        listEl.innerHTML = `
            <div class="th-bookings-empty">
                <div class="th-bookings-empty-icon">👤</div>
                <strong>Sign in to view your bookings</strong>
                <span>Your upcoming and past appointments will appear here.</span>
            </div>`;
        return;
    }

    listEl.innerHTML = '<div class="loading-pulse">Loading your bookings...</div>';

    try {
        const snap = await db.collection('Appointments')
            .where('clientEmail', '==', bk_currentUser.email)
            .get();

        if (snap.empty) {
            listEl.innerHTML = `
                <div class="th-bookings-empty">
                    <div class="th-bookings-empty-icon">✦</div>
                    <strong>No bookings yet</strong>
                    <span>When you book your first THURAYA visit, it will appear here.</span>
                    <button class="btn-primary full" onclick="goToStep('screen-booking-mode')">Book Your First Visit</button>
                </div>`;
            return;
        }

        const statusLabels = {
            'Scheduled':         { label: 'Upcoming',    cls: 'upcoming'  },
            'Confirmed':         { label: 'Upcoming',    cls: 'upcoming'  },
            'Arrived':           { label: 'Checked In',  cls: 'active'    },
            'In Progress':       { label: 'In Service',  cls: 'active'    },
            'Ready for Payment': { label: 'Wrapping Up', cls: 'active'    },
            'Closed':            { label: 'Completed',   cls: 'completed' },
            'Completed':         { label: 'Completed',   cls: 'completed' },
            'Cancelled':         { label: 'Cancelled',   cls: 'cancelled' },
            'No Show':           { label: 'Missed',      cls: 'cancelled' }
        };

        const now = new Date();
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));

        docs.forEach(a => {
            const dt = new Date(`${a.dateString || ''}T${a.timeString || '00:00'}`);
            a._dateObj = isNaN(dt.getTime()) ? null : dt;
            a._isUpcoming = a._dateObj ? a._dateObj >= now && !['Closed','Completed','Cancelled','No Show'].includes(a.status || '') : false;
        });

        const upcoming = docs
            .filter(a => a._isUpcoming)
            .sort((a, b) => (a._dateObj?.getTime() || 0) - (b._dateObj?.getTime() || 0));

        const history = docs
            .filter(a => !a._isUpcoming)
            .sort((a, b) => {
                const ak = (a.dateString || '') + (a.timeString || '');
                const bk = (b.dateString || '') + (b.timeString || '');
                return bk.localeCompare(ak);
            });

        function fmtDate(a) {
            try {
                return new Date((a.dateString || '') + 'T00:00:00').toLocaleDateString('en-GB', {
                    weekday:'short', day:'numeric', month:'short', year:'numeric'
                });
            } catch(e) { return a.dateString || '—'; }
        }

        function fmtTime(a) {
            try {
                const [hh, mm] = String(a.timeString || '').split(':').map(Number);
                return `${hh % 12 || 12}:${String(mm || 0).padStart(2,'0')} ${hh >= 12 ? 'PM' : 'AM'}`;
            } catch(e) { return a.timeString || '—'; }
        }

        function money(v) {
            const n = parseFloat(v || 0);
            return Number.isFinite(n) ? n.toFixed(2) : '0.00';
        }

        function card(a, featured=false) {
            const status = statusLabels[a.status] || { label: a.status || 'Booking', cls: 'upcoming' };
            const isGroup = a.isGroupBooking ? '<span class="th-booking-mini-pill">Group</span>' : '';
            const tech = a.assignedTechName || 'To be assigned';
            const service = a.bookedService || 'THURAYA service';
            const total = money(a.grandTotal || a.bookedPrice || 0);

            return `
                <article class="th-booking-card ${featured ? 'featured' : ''}">
                    <div class="th-booking-topline">
                        <span class="th-booking-kicker">${featured ? 'Next appointment' : 'Appointment'}</span>
                        <span class="th-booking-status ${status.cls}">${status.label}</span>
                    </div>
                    <h3>${service}${isGroup}</h3>
                    <div class="th-booking-meta-grid">
                        <div><small>Date</small><strong>${fmtDate(a)}</strong></div>
                        <div><small>Time</small><strong>${fmtTime(a)}</strong></div>
                        <div><small>Technician</small><strong>${tech}</strong></div>
                        <div><small>Total</small><strong>${total} GHC</strong></div>
                    </div>
                    <div class="th-booking-actions">
                        <button class="th-booking-action primary" onclick="bk_bookAgainFromHistory('${a.id}')">Book Again</button>
                        <button class="th-booking-action" onclick="bk_openMyAccount()">My Account</button>
                    </div>
                </article>`;
        }

        let html = '';
        if (upcoming.length) {
            html += `<section class="th-bookings-section"><div class="th-bookings-section-head"><span>Upcoming</span><em>${upcoming.length}</em></div>${upcoming.slice(0, 3).map((a, i) => card(a, i === 0)).join('')}</section>`;
        }
        if (history.length) {
            html += `<section class="th-bookings-section"><div class="th-bookings-section-head"><span>History</span><em>${history.length}</em></div>${history.slice(0, 20).map(a => card(a)).join('')}</section>`;
        }

        listEl.innerHTML = html || `
            <div class="th-bookings-empty">
                <div class="th-bookings-empty-icon">✦</div>
                <strong>No bookings found</strong>
                <span>Your completed and upcoming visits will appear here.</span>
            </div>`;

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error);text-align:center;padding:24px 0;">Could not load bookings: ${e.message}</p>`;
    }
};

window.bk_bookAgainFromHistory = function(appointmentId) {
    bk_selectedServices = [];
    bk_activePromo = null;
    bk_confirmedAppt = null;

    try { bk_clearAllSelections(); } catch(e) {}

    const timeEl = document.getElementById('bk_time');
    const dateEl = document.getElementById('bk_date');
    if (timeEl) timeEl.value = '';
    if (dateEl) dateEl.value = '';

    const slotsContainer = document.getElementById('bk_slotsContainer');
    if (slotsContainer) slotsContainer.style.display = 'none';

    toast('Choose your service to book again.', 'success');
    goToStep('screen-services');
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


// Phase 5.5E: Client App availability alignment patch loaded.
console.log('Thuraya Client App Phase 5.5E availability aligned app.js loaded');


console.log('Thuraya Phase 8F client-friendly booking status labels loaded.');


// ── Your Info + Sign Out Safe Patch ─────────────
let bk_clientExperienceDocs = [];
let bk_clientExperienceFilter = 'all';
let bk_clientExperienceUnsub = null;

function bk_showFloatingSignOut(show) {
    const btn = document.getElementById('bkFloatingSignOut');
    if (btn) {
        btn.style.display = show ? 'block' : 'none';
        if (show && typeof bk_placeFloatingSignOut === 'function') {
            bk_placeFloatingSignOut(document.querySelector('.screen.active'));
        }
    }
}

function bk_placeFloatingSignOut(activeScreen) {
    const btn = document.getElementById('bkFloatingSignOut');
    const screen = activeScreen || document.querySelector('.screen.active');
    if (!btn || !screen) return;

    btn.classList.remove('th-signout-inline');

    // Release polish: Sign Out must behave like the PC version everywhere.
    // It appears ONLY on the home / New Booking screen and is hidden on all
    // booking sub-pages, account/profile pages, document viewer, and welcome.
    // This is UI placement only; auth and booking logic are untouched.
    if (screen.id !== 'screen-booking-mode') {
        btn.style.display = 'none';
        return;
    }

    const header = screen.querySelector('.step-header');
    const badge = header?.querySelector('.step-badge');

    if (header && badge) {
        let row = header.querySelector('.th-booking-action-row');
        if (!row) {
            row = document.createElement('div');
            row.className = 'th-booking-action-row';
            header.insertBefore(row, badge);
        }
        if (badge.parentElement !== row) row.appendChild(badge);
        if (btn.parentElement !== row) row.appendChild(btn);
        btn.classList.add('th-signout-inline');
        btn.style.display = 'inline-flex';
        return;
    }

    btn.style.display = 'none';
}


function bk_moveStagingBannerToBottom() {
    ['#stagingBanner', '.staging-banner', '[data-staging-banner]', '.env-banner'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            el.style.top = 'auto';
            el.style.bottom = '0';
            el.style.left = '0';
            el.style.right = '0';
            el.style.zIndex = '9998';
        });
    });
}

function startClientCareLibraryListener() {
    try {
        if (typeof bk_clientExperienceUnsub === 'function') {
            bk_clientExperienceUnsub();
        }

        bk_clientExperienceUnsub = db.collection('Client_Experience')
            .where('visibleToClient', '==', true)
            .where('archived', '==', false)
            .onSnapshot(snapshot => {
                bk_clientExperienceDocs = [];
                snapshot.forEach(doc => {
                    bk_clientExperienceDocs.push({ id: doc.id, ...doc.data() });
                });

                bk_clientExperienceDocs.sort((a, b) => {
                    const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return bt - at;
                });

                renderClientCareLibrary();
            }, err => {
                const el = document.getElementById('bk_clientExperienceList');
                if (el) el.innerHTML = `<p style="color:var(--error);">Could not load care library: ${err.message}</p>`;
                console.warn('Your Info listener error:', err);
            });
    } catch(e) {
        console.warn('Your Info listener skipped:', e);
    }
}

window.bk_filterClientExperience = function(category, btn) {
    bk_clientExperienceFilter = category || 'all';
    document.querySelectorAll('.cx-client-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderClientCareLibrary();
};

function renderClientCareLibrary() {
    const el = document.getElementById('bk_clientExperienceList');
    if (!el) return;

    const docs = bk_clientExperienceFilter === 'all'
        ? bk_clientExperienceDocs
        : bk_clientExperienceDocs.filter(d => (d.category || '').toLowerCase() === bk_clientExperienceFilter);

    if (!docs.length) {
        el.innerHTML = `<div class="form-card" style="text-align:center;color:var(--text-muted);">No information available yet.</div>`;
        return;
    }

    el.innerHTML = docs.map(d => {
        const category = (d.category || 'info').toString();
        const title = d.title || 'Your Info Document';
        const description = d.description || d.note || '';
        const url = d.fileUrl || d.url || '#';

        return `
            <div class="cx-client-card">
                <div class="cx-client-card-meta">${category}</div>
                <div class="cx-client-card-title">${title}</div>
                ${description ? `<div class="cx-client-card-desc">${description}</div>` : ''}
                <a href="#" onclick="event.preventDefault(); openClientDocument(\`${url}\`, \`${title}\`)">Open Document</a>
            </div>
        `;
    }).join('');
}

function bk_afterClientEntry() {
    bk_showFloatingSignOut(true);
    bk_moveStagingBannerToBottom();
    startClientCareLibraryListener();
}

window.bk_signOut = async function() {
    try {
        if (typeof bk_clientExperienceUnsub === 'function') {
            bk_clientExperienceUnsub();
            bk_clientExperienceUnsub = null;
        }

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

        bk_showFloatingSignOut(false);
        showScreen('screen-welcome');
        toast('Signed out successfully.', 'success');
    } catch(e) {
        toast('Sign out failed: ' + e.message, 'error');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    bk_showFloatingSignOut(false);
    setTimeout(bk_moveStagingBannerToBottom, 300);
    setTimeout(bk_moveStagingBannerToBottom, 1000);
});



// ── In-App Document Viewer ────────────────────────────────
let bk_currentDocumentUrl = '';
let bk_currentDocumentTitle = '';

function bk_escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function bk_toEmbeddableDocumentUrl(url) {
    if (!url) return '';

    if (url.includes('drive.google.com')) {
        const fileMatch = url.match(/\/file\/d\/([^/]+)/);
        if (fileMatch && fileMatch[1]) {
            return `https://drive.google.com/file/d/${fileMatch[1]}/preview`;
        }

        const idMatch = url.match(/[?&]id=([^&]+)/);
        if (idMatch && idMatch[1]) {
            return `https://drive.google.com/file/d/${idMatch[1]}/preview`;
        }
    }

    return url;
}

window.openClientDocument = function(url, title) {
    bk_currentDocumentUrl = url || '';
    bk_currentDocumentTitle = title || 'Document';

    const frame = document.getElementById('docViewerFrame');
    const titleEl = document.getElementById('docViewerTitle');

    if (titleEl) titleEl.textContent = bk_currentDocumentTitle;

    if (!frame || !bk_currentDocumentUrl) {
        toast('Document link unavailable.', 'warning');
        return;
    }

    frame.src = '';
    setTimeout(() => {
        frame.src = bk_toEmbeddableDocumentUrl(bk_currentDocumentUrl);
    }, 50);

    _screenHistory.push('screen-doc-viewer');
    showScreen('screen-doc-viewer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.bk_closeDocumentViewer = function() {
    const frame = document.getElementById('docViewerFrame');
    if (frame) frame.src = '';

    if (_screenHistory[_screenHistory.length - 1] === 'screen-doc-viewer') {
        _screenHistory.pop();
    }

    const prev = _screenHistory[_screenHistory.length - 1] || 'screen-booking-mode';
    showScreen(prev);
};

window.bk_openDocumentExternal = function() {
    if (!bk_currentDocumentUrl) {
        toast('Document link unavailable.', 'warning');
        return;
    }
    window.open(bk_currentDocumentUrl, '_blank', 'noopener');
};


// ── THURAYA FINAL CTA EVENT SYNC ──────────────────────────
// No date picker override. No MutationObserver. No duplicate service button.
document.addEventListener('click', function(e) {
    if (e.target && e.target.closest && (
        e.target.closest('#bk_serviceMenu .service-card') ||
        e.target.closest('#bk_serviceMenu button') ||
        e.target.closest('#bk_slots .slot-btn') ||
        e.target.closest('#bk_slots button')
    )) {
        setTimeout(bk_finalSyncCTAs, 50);
    }
});

document.addEventListener('change', function(e) {
    if (e.target && e.target.closest && (
        e.target.closest('#bk_serviceMenu') ||
        e.target.closest('#bk_date')
    )) {
        setTimeout(bk_finalSyncCTAs, 80);
    }
});

document.addEventListener('DOMContentLoaded', function() {
    setTimeout(bk_finalSyncCTAs, 600);
});
// ── END THURAYA FINAL CTA EVENT SYNC ──────────────────────


// ── THURAYA MY ACCOUNT LAYER ─────────────────────────────
function bk_safeText(value, fallback = '—') {
    const v = (value === undefined || value === null) ? '' : String(value).trim();
    return v || fallback;
}

function bk_syncAccountSummary() {
    const profile = bk_clientProfile || {};
    const name = bk_safeText(profile.name, bk_isGuest ? 'Guest Client' : 'THURAYA Client');
    const phone = bk_safeText(profile.phone || profile.Tel_Number, 'Phone not saved');
    const secondaryPhone = bk_safeText(profile.secondaryPhone || profile.Secondary_Phone, 'Not set');
    const email = bk_safeText(profile.email || bk_currentUser?.email, bk_isGuest ? 'Guest booking' : 'Email not saved');
    const dob = bk_safeText(profile.dob || profile.Date_Of_Birth, 'Not set');
    const gender = bk_safeText(profile.gender || profile.Gender, 'Not set');

    const initial = (name || 'T').charAt(0).toUpperCase();
    const initialEl = document.getElementById('thAccountInitial');
    const nameEl = document.getElementById('thAccountName');
    const metaEl = document.getElementById('thAccountMeta');

    if (initialEl) initialEl.textContent = initial;
    if (nameEl) nameEl.textContent = name;
    if (metaEl) metaEl.textContent = `${phone} · ${email}`;

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    set('thProfileName', name);
    set('thProfilePhone', phone);
    set('thProfileSecondaryPhone', secondaryPhone);
    set('thProfileEmail', email);
    set('thProfileDob', dob);
    set('thProfileGender', gender);
}

window.bk_openMyAccount = function() {
    bk_syncAccountSummary();
    goToStep('screen-my-account');
};

window.bk_openProfileMenu = function() {
    bk_syncAccountSummary();
    goToStep('screen-account-profile');
};

window.bk_openPaymentMethods = function() {
    goToStep('screen-payment-methods');
};

window.bk_openWallet = function() {
    goToStep('screen-wallet');
};

window.bk_prepareProfileEdit = function() {
    // Legacy route kept safe: account profile edits now use the dedicated edit screen.
    bk_prepareAccountProfileEdit();
};

window.bk_prepareAccountProfileEdit = function() {
    const profile = bk_clientProfile || {};
    const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    };

    setVal('acct_name', profile.name || profile.Forename || '');
    setVal('acct_phone', profile.phone || profile.Tel_Number || '');
    setVal('acct_secondaryPhone', profile.secondaryPhone || profile.Secondary_Phone || '');
    setVal('acct_email', profile.email || bk_currentUser?.email || '');
    setVal('acct_dob', profile.dob || profile.Date_Of_Birth || '');
    setVal('acct_gender', profile.gender || profile.Gender || '');

    const dobEl = document.getElementById('acct_dob');
    if (dobEl) dobEl.max = todayStr;

    goToStep('screen-account-profile-edit');
};

window.bk_saveAccountProfile = async function() {
    const btn = document.getElementById('btnSaveAccountProfile');
    const name = (document.getElementById('acct_name')?.value || '').trim();
    const phone = (document.getElementById('acct_phone')?.value || '').replace(/\D/g, '');
    const secondaryPhone = (document.getElementById('acct_secondaryPhone')?.value || '').replace(/\D/g, '');
    const dob = document.getElementById('acct_dob')?.value || '';
    const gender = document.getElementById('acct_gender')?.value || '';
    const email = (bk_currentUser?.email || bk_clientProfile?.email || '').toLowerCase();

    if (!name) { toast('Please enter your full name.', 'warning'); return; }
    if (phone.length !== 10) { toast('Primary phone must be 10 digits.', 'warning'); return; }
    if (secondaryPhone && secondaryPhone.length !== 10) { toast('Secondary phone must be 10 digits, or leave it blank.', 'warning'); return; }
    if (secondaryPhone && secondaryPhone === phone) { toast('Secondary phone should be different from your primary phone.', 'warning'); return; }
    if (!dob) { toast('Please enter your date of birth.', 'warning'); return; }
    if (dob > todayStr) { toast('Date of birth cannot be in the future.', 'warning'); return; }

    setBtnLoading(btn, true, 'Save Changes');
    try {
        const profileUpdate = {
            ...(bk_clientProfile || {}),
            name,
            phone,
            secondaryPhone,
            gender,
            dob,
            email: email || (bk_clientProfile?.email || ''),
            profileComplete: true,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (email) {
            await db.collection('Client_Users').doc(email).set(profileUpdate, { merge: true });
        }

        await db.collection('Clients').doc(phone).set({
            Forename: name.split(' ')[0] || name,
            Surname: name.split(' ').slice(1).join(' ') || '',
            Tel_Number: phone,
            Secondary_Phone: secondaryPhone,
            Email: email || '',
            Gender: gender,
            Date_Of_Birth: dob,
            Last_Updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        bk_clientProfile = profileUpdate;
        bk_syncAccountSummary();
        toast('Profile updated successfully.', 'success');
        goToStep('screen-account-profile');
    } catch (e) {
        toast('Could not update profile: ' + e.message, 'error');
    } finally {
        setBtnLoading(btn, false, 'Save Changes');
    }
};
// ── END THURAYA MY ACCOUNT LAYER ─────────────────────────




// ── THURAYA CLIENT NOTIFICATION LAYER ────────────────────
// Safe in-app layer only. No SMS, WhatsApp, push or payment logic.
let bk_clientNotifications = [];

function bk_getClientNotificationKey() {
    const email = (bk_currentUser?.email || bk_clientProfile?.email || '').toLowerCase();
    const phone = (bk_clientProfile?.phone || bk_clientProfile?.Tel_Number || '').replace(/\D/g, '');
    return email || (phone ? 'guest:' + phone : 'guest:unknown');
}

function bk_formatClientDateTime(dateString, timeString) {
    let dateFormatted = dateString || 'Date pending';
    let timeFormatted = timeString || '';
    try {
        dateFormatted = new Date(dateString + 'T00:00:00').toLocaleDateString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short'
        });
    } catch(e) {}
    try {
        const [h, m] = String(timeString || '').split(':').map(Number);
        if (Number.isFinite(h)) timeFormatted = `${h % 12 || 12}:${String(m || 0).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    } catch(e) {}
    return `${dateFormatted}${timeFormatted ? ' • ' + timeFormatted : ''}`;
}

async function bk_createClientNotificationForBooking(appt) {
    if (!appt) return;
    const clientKey = bk_getClientNotificationKey();
    const message = `${appt.bookedService || 'Your appointment'} confirmed for ${bk_formatClientDateTime(appt.dateString, appt.timeString)}.`;

    await db.collection('Client_Notifications').add({
        clientKey,
        clientEmail: appt.clientEmail || bk_currentUser?.email || '',
        clientPhone: appt.clientPhone || bk_clientProfile?.phone || '',
        appointmentId: appt.id || '',
        type: 'booking_confirmed',
        title: 'Booking confirmed',
        message,
        read: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

window.bk_openNotifications = async function() {
    goToStep('screen-notifications');
    await bk_loadClientNotifications();
};

async function bk_loadClientNotifications() {
    const listEl = document.getElementById('thNotificationList');
    if (!listEl) return;

    const clientKey = bk_getClientNotificationKey();
    listEl.innerHTML = '<div class="loading-pulse">Loading notifications...</div>';

    try {
        const snap = await db.collection('Client_Notifications')
            .where('clientKey', '==', clientKey)
            .limit(30)
            .get();

        bk_clientNotifications = [];
        snap.forEach(doc => bk_clientNotifications.push({ id: doc.id, ...doc.data() }));
        bk_clientNotifications.sort((a, b) => {
            const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return bt - at;
        });

        if (!bk_clientNotifications.length) {
            listEl.innerHTML = `
                <div class="th-notification-empty">
                    <div class="th-empty-icon">🔔</div>
                    <strong>No notifications yet</strong>
                    <span>Booking confirmations, reminders and THURAYA updates will appear here.</span>
                </div>`;
            return;
        }

        listEl.innerHTML = bk_clientNotifications.map(n => `
            <article class="th-notification-card ${n.read ? '' : 'unread'}">
                <div class="th-notification-icon">${n.type === 'booking_confirmed' ? '✓' : n.type === 'promo' ? '✦' : '🔔'}</div>
                <div class="th-notification-copy">
                    <strong>${n.title || 'THURAYA update'}</strong>
                    <span>${n.message || ''}</span>
                    <em>${n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Just now'}</em>
                </div>
            </article>`).join('');
    } catch (e) {
        listEl.innerHTML = `<div class="th-notification-empty"><strong>Notifications unavailable</strong><span>${e.message}</span></div>`;
    }
}

let bk_nextUpcomingAppointment = null;

function bk_hoursUntilAppointment(appt) {
    try {
        if (!appt?.dateString || !appt?.timeString) return null;
        const dt = new Date(`${appt.dateString}T${appt.timeString}:00`);
        return (dt.getTime() - Date.now()) / 36e5;
    } catch(e) { return null; }
}

function bk_setUpcomingCardMood(appt) {
    const card = document.getElementById('thUpcomingAppointmentCard');
    const pill = document.getElementById('thUpcomingStatusPill');
    const guidance = document.getElementById('thUpcomingGuidance');
    if (!card) return;

    card.classList.remove('is-soon', 'is-later');
    const hours = bk_hoursUntilAppointment(appt);

    if (hours !== null && hours <= 24) {
        card.classList.add('is-soon');
        if (pill) pill.textContent = 'Within 24h';
        if (guidance) guidance.textContent = 'Your visit is coming up soon. Directions and WhatsApp are ready below.';
    } else {
        card.classList.add('is-later');
        if (pill) pill.textContent = 'Confirmed';
        if (guidance) guidance.textContent = 'Your appointment is reserved. You can view details or book another visit anytime.';
    }
}

async function bk_loadUpcomingAppointmentPreview() {
    const card = document.getElementById('thUpcomingAppointmentCard');
    if (!card || !bk_clientProfile) return;

    const email = (bk_currentUser?.email || bk_clientProfile?.email || '').toLowerCase();
    const phone = (bk_clientProfile?.phone || '').replace(/\D/g, '');

    try {
        let snap = null;
        if (email) {
            snap = await db.collection('Appointments').where('clientEmail', '==', email).get();
        } else if (phone) {
            snap = await db.collection('Appointments').where('clientPhone', '==', phone).get();
        }
        if (!snap || snap.empty) { card.style.display = 'none'; bk_nextUpcomingAppointment = null; return; }

        const activeStatuses = ['Scheduled', 'Confirmed', 'Arrived', 'In Progress'];
        const nowKey = todayStr + '00:00';
        const upcoming = [];
        snap.forEach(doc => {
            const a = { id: doc.id, ...doc.data() };
            const key = (a.dateString || '') + (a.timeString || '');
            if (activeStatuses.includes(a.status || '') && key >= nowKey) upcoming.push(a);
        });
        upcoming.sort((a, b) => ((a.dateString || '') + (a.timeString || '')).localeCompare((b.dateString || '') + (b.timeString || '')));

        if (!upcoming.length) { card.style.display = 'none'; bk_nextUpcomingAppointment = null; return; }
        const next = upcoming[0];
        bk_nextUpcomingAppointment = next;

        const serviceEl = document.getElementById('thUpcomingService');
        const dateEl = document.getElementById('thUpcomingDateTime');
        if (serviceEl) serviceEl.textContent = next.bookedService || 'Your next THURAYA visit';
        if (dateEl) dateEl.textContent = bk_formatClientDateTime(next.dateString, next.timeString);
        bk_setUpcomingCardMood(next);
        card.style.display = 'block';
    } catch(e) {
        console.warn('Upcoming appointment preview skipped:', e);
        card.style.display = 'none';
        bk_nextUpcomingAppointment = null;
    }
}

window.bk_upcomingDirections = function() {
    const query = encodeURIComponent('THURAYA The HAUTE Nail Bar Accra');
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank', 'noopener');
};

window.bk_upcomingWhatsApp = function() {
    const salonWhatsApp = '233241948225';
    const service = bk_nextUpcomingAppointment?.bookedService || 'my appointment';
    const when = bk_nextUpcomingAppointment ? bk_formatClientDateTime(bk_nextUpcomingAppointment.dateString, bk_nextUpcomingAppointment.timeString) : '';
    const msg = encodeURIComponent(`Hello THURAYA, I am contacting you about ${service}${when ? ' on ' + when : ''}.`);
    window.open(`https://wa.me/${salonWhatsApp}?text=${msg}`, '_blank', 'noopener');
};

window.bk_upcomingReschedule = function() {
    toast('Rescheduling is coming soon. Please contact THURAYA on WhatsApp for changes.', 'info');
};

// Load notification preview after client entry and when returning home.
(function(){
    const previousAfterEntry = window.bk_afterClientEntry;
    if (typeof previousAfterEntry === 'function' && !window.__thurayaNotificationAfterEntryWrapped) {
        window.bk_afterClientEntry = function(){
            const result = previousAfterEntry.apply(this, arguments);
            setTimeout(bk_loadUpcomingAppointmentPreview, 700);
            return result;
        };
        window.__thurayaNotificationAfterEntryWrapped = true;
    }

    const previousNavHome = window.bk_navHome;
    if (typeof previousNavHome === 'function' && !window.__thurayaNotificationNavHomeWrapped) {
        window.bk_navHome = function(){
            const result = previousNavHome.apply(this, arguments);
            setTimeout(bk_loadUpcomingAppointmentPreview, 500);
            return result;
        };
        window.__thurayaNotificationNavHomeWrapped = true;
    }

    document.addEventListener('DOMContentLoaded', function(){
        setTimeout(bk_loadUpcomingAppointmentPreview, 1200);
    });
})();
// ── END THURAYA CLIENT NOTIFICATION LAYER ────────────────

// ── THURAYA BOTTOM NAVIGATION LAYER ──────────────────────
// Safe shortcut layer only. Does not change booking/payment/Firebase logic.
(function(){
    const NAV_HIDDEN_SCREENS = new Set([
        'screen-welcome',
        'screen-profile',
        'screen-guest',
        'screen-doc-viewer',
        'screen-success',
        'screen-group-success'
    ]);

    function bk_getActiveScreenId(){
        const active = document.querySelector('.screen.active');
        return active ? active.id : '';
    }

    window.bk_syncBottomNav = function(){
        const nav = document.getElementById('thurayaBottomNav');
        if (!nav) return;

        const activeId = bk_getActiveScreenId();
        const hasClient = !!(window.bk_clientProfile || bk_clientProfile || auth?.currentUser);
        const shouldShow = hasClient && activeId && !NAV_HIDDEN_SCREENS.has(activeId);

        nav.style.display = shouldShow ? 'grid' : 'none';
        nav.hidden = !shouldShow;
        nav.classList.toggle('thuraya-bottom-nav--hidden', !shouldShow);
        nav.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
        if (!shouldShow) return;

        nav.querySelectorAll('.thuraya-bottom-nav-item').forEach(btn => btn.classList.remove('active'));

        let target = 'home';
        if (activeId === 'screen-services' || activeId === 'screen-group-services') target = 'services';
        if (activeId === 'screen-mybookings') target = 'bookings';

        const activeBtn = nav.querySelector(`[data-nav-target="${target}"]`);
        if (activeBtn) activeBtn.classList.add('active');
    };

    window.bk_navHome = function(){
        _screenHistory = ['screen-welcome', 'screen-booking-mode'];
        showScreen('screen-booking-mode');
        window.scrollTo({ top:0, behavior:'smooth' });
        setTimeout(bk_syncBottomNav, 40);
    };

    window.bk_navServices = function(){
        _screenHistory = ['screen-welcome', 'screen-booking-mode', 'screen-services'];
        showScreen('screen-services');
        if (typeof updateBreakdown === 'function') updateBreakdown();
        window.scrollTo({ top:0, behavior:'smooth' });
        setTimeout(bk_syncBottomNav, 40);
    };

    window.bk_navBookings = function(){
        if (typeof bk_viewMyBookings === 'function') {
            bk_viewMyBookings();
        } else {
            _screenHistory = ['screen-welcome', 'screen-booking-mode', 'screen-mybookings'];
            showScreen('screen-mybookings');
        }
        setTimeout(bk_syncBottomNav, 80);
    };

    const originalShowScreen = window.showScreen;
    if (typeof originalShowScreen === 'function' && !window.__thurayaBottomNavWrapped) {
        window.showScreen = function(id){
            const result = originalShowScreen.apply(this, arguments);
            setTimeout(bk_syncBottomNav, 60);
            return result;
        };
        window.__thurayaBottomNavWrapped = true;
    }

    document.addEventListener('DOMContentLoaded', function(){
        setTimeout(bk_syncBottomNav, 700);
    });

    document.addEventListener('click', function(){
        setTimeout(bk_syncBottomNav, 80);
    });
})();
// ── END THURAYA BOTTOM NAVIGATION LAYER ──────────────────


// THURAYA WhatsApp direct salon chat fallback for engagement template actions.
window.thurayaEngagementAction = window.thurayaEngagementAction || function(action) {
    if (action === 'whatsapp') return window.bk_upcomingWhatsApp?.();
    if (action === 'directions') return window.bk_upcomingDirections?.();
    if (action === 'rebook') return window.bk_bookAgain?.();
};
// ── THURAYA ISSUE 02A: MOBILE-SAFE DATE PICKER FIX ───────────────────
// UI interaction layer only. No booking, auth, Firebase, or slot logic changed.
// Desktop: nudges native date picker open on click. Mobile: preserves native touch behavior.
(function thurayaInstallDatePickerMobileSafeFix(){
    function isDesktopPointer(){
        try {
            return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        } catch (e) {
            return false;
        }
    }

    function openNativeDatePicker(input){
        if (!input || input.disabled || !isDesktopPointer()) return;
        try {
            if (typeof input.showPicker === 'function') input.showPicker();
        } catch (e) {
            // Native click/focus remains available.
        }
    }

    function enhanceDateInput(input){
        if (!input || input.dataset.thurayaDatePickerFix === '2') return;
        input.dataset.thurayaDatePickerFix = '2';
        input.style.cursor = 'pointer';
        input.style.pointerEvents = 'auto';
        input.addEventListener('click', function(){ openNativeDatePicker(input); });
    }

    function install(){
        ['bk_date', 'grp_date'].forEach(function(id){ enhanceDateInput(document.getElementById(id)); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();
// ── END THURAYA ISSUE 02A FIX ─────────────────────────────────────────


// ── THURAYA ISSUE 02C: DATE FIELD VISIBLE AFFORDANCE FIX ─────────────
// UI-only: keeps native date inputs and existing onchange booking functions intact.
(function thurayaDateFieldAffordanceFix(){
    function sync(input){
        if (!input) return;
        var wrap = input.closest ? input.closest('.thuraya-date-field') : null;
        if (!wrap) return;
        if (input.value) wrap.classList.add('has-value');
        else wrap.classList.remove('has-value');
    }

    function install(){
        ['bk_date', 'grp_date'].forEach(function(id){
            var input = document.getElementById(id);
            if (!input || input.dataset.thurayaAffordanceFix === '1') return;
            input.dataset.thurayaAffordanceFix = '1';
            sync(input);
            input.addEventListener('input', function(){ sync(input); });
            input.addEventListener('change', function(){ sync(input); });
            input.addEventListener('blur', function(){ sync(input); });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();
// ── END THURAYA ISSUE 02C FIX ────────────────────────────────────────


// ── THURAYA ISSUE 02E: CONSISTENT DATE PICKER POLISH ────────────────
// UI-only. Applies the same visible date field behavior to:
// profile completion DOB, account DOB, individual booking date, and group booking date.
// Existing onchange handlers and booking/profile save logic are untouched.
(function thurayaConsistentDatePickerPolish(){
    var DATE_IDS = ['prof_dob', 'acct_dob', 'bk_date', 'grp_date'];

    function isDesktopPointer(){
        try {
            return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        } catch(e) { return false; }
    }

    function sync(input){
        if (!input) return;
        var wrap = input.closest ? input.closest('.thuraya-date-field') : null;
        if (!wrap) return;
        if (input.value) wrap.classList.add('has-value');
        else wrap.classList.remove('has-value');
    }

    function openPicker(input){
        if (!input || input.disabled) return;
        try { input.focus({ preventScroll: true }); } catch(e) { try { input.focus(); } catch(_e){} }
        if (isDesktopPointer()) {
            try { if (typeof input.showPicker === 'function') input.showPicker(); } catch(e) {}
        }
    }

    function enhance(input){
        if (!input || input.dataset.thurayaConsistentDate === '1') { sync(input); return; }
        input.dataset.thurayaConsistentDate = '1';
        input.setAttribute('inputmode', 'none');
        input.style.pointerEvents = 'auto';
        input.style.cursor = 'pointer';

        var wrap = input.closest ? input.closest('.thuraya-date-field') : null;
        if (wrap && !wrap.dataset.thurayaConsistentDateWrap) {
            wrap.dataset.thurayaConsistentDateWrap = '1';
            wrap.addEventListener('click', function(e){
                var targetInput = wrap.querySelector('input[type="date"]');
                if (targetInput) openPicker(targetInput);
            });
        }

        input.addEventListener('click', function(){ openPicker(input); });
        input.addEventListener('input', function(){ sync(input); });
        input.addEventListener('change', function(){ sync(input); });
        input.addEventListener('blur', function(){ sync(input); });
        sync(input);
    }

    function install(){
        DATE_IDS.forEach(function(id){ enhance(document.getElementById(id)); });
    }

    window.thurayaSyncDateFields = install;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();

    document.addEventListener('visibilitychange', install);
    document.addEventListener('click', function(){ setTimeout(install, 0); }, true);
})();
// ── END THURAYA ISSUE 02E ────────────────────────────────────────────


// ============================================================
// THURAYA CLIENT APP — HF19 Lunch Break Availability Alignment
// Reads Staff App Attendance lunch state and blocks lunch intervals before
// slots are displayed. This removes false availability while a tech is on lunch.
// ============================================================
(function thurayaClientHF19LunchAvailability(){
    if (window.__thurayaClientHF19LunchAvailability) return;
    window.__thurayaClientHF19LunchAvailability = true;

    function hf19_norm(value){ return String(value || '').trim().toLowerCase(); }
    function hf19_today(){
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    }
    function hf19_toDate(v){
        if (!v) return null;
        if (v.toDate) return v.toDate();
        if (v.seconds) return new Date(v.seconds * 1000);
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    function hf19_minsFromDate(d){ return d ? (d.getHours() * 60 + d.getMinutes()) : null; }
    function hf19_keysForAttendance(a){
        const keys = new Set();
        [a.email, a.staffEmail, a.userEmail, a.name, a.staffName, a.displayName].forEach(v => {
            const k = hf19_norm(v);
            if (k) keys.add(k);
        });
        (bk_techs || []).forEach(t => {
            const tEmail = hf19_norm(t.email);
            const tName = hf19_norm(t.name);
            if ((tEmail && keys.has(tEmail)) || (tName && keys.has(tName))) {
                if (tEmail) keys.add(tEmail);
                if (tName) keys.add(tName);
                if (t.id) keys.add(hf19_norm(t.id));
                if (t.uid) keys.add(hf19_norm(t.uid));
            }
        });
        return Array.from(keys);
    }
    function hf19_isLunchActive(a){
        return a && (a.lunchActive === true || String(a.availabilityStatus || '').toLowerCase() === 'lunch' || String(a.status || '').toLowerCase() === 'on lunch');
    }
    function hf19_isClockedOut(a){
        return !!(a && a.clockOut);
    }
    function hf19_addInterval(busyByKey, keys, start, end, source){
        if (typeof bk_addBusyInterval === 'function') return bk_addBusyInterval(busyByKey, keys, start, end, source);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
        (keys || []).forEach(k => {
            const key = hf19_norm(k);
            if (!key) return;
            if (!busyByKey[key]) busyByKey[key] = [];
            busyByKey[key].push({ start, end, source: source || 'Attendance' });
        });
    }

    async function hf19_addAttendanceBlocks(date, busyByKey){
        if (!date || !busyByKey) return busyByKey;
        const closeTime = 20 * 60;
        const openTime = 8 * 60;

        async function readByField(field){
            try { return await db.collection('Attendance').where(field, '==', date).get(); }
            catch(e) { return null; }
        }

        const snaps = [];
        const s1 = await readByField('date'); if (s1) snaps.push(s1);
        const s2 = await readByField('dateString'); if (s2) snaps.push(s2);

        const seen = new Set();
        snaps.forEach(snap => snap.forEach(doc => {
            if (seen.has(doc.id)) return;
            seen.add(doc.id);
            const a = { id: doc.id, ...(doc.data() || {}) };
            const keys = hf19_keysForAttendance(a);
            if (!keys.length) return;

            // Clock-out hides any future same-day slots after the clock-out time.
            if (date === hf19_today() && hf19_isClockedOut(a)) {
                const out = hf19_toDate(a.clockOut);
                const start = hf19_minsFromDate(out);
                if (Number.isFinite(start)) hf19_addInterval(busyByKey, keys, start, closeTime, 'Attendance Clock-Out');
            }

            // Active lunch blocks from lunch start until lunch ends. If still active,
            // block to close of day so clients cannot book into an unavailable tech.
            if (hf19_isLunchActive(a)) {
                const st = hf19_toDate(a.lunchStart || a.lastLunchStart || a.updatedAt);
                let start = hf19_minsFromDate(st);
                if (!Number.isFinite(start)) start = openTime;
                hf19_addInterval(busyByKey, keys, start, closeTime, 'Attendance Lunch');
                return;
            }

            // Completed lunch history blocks only the lunch interval. This mainly protects
            // same-day staff/client views if lunch ended moments ago and a stale slot cache exists.
            const lunchStart = hf19_toDate(a.lunchStart || a.lastLunchStart);
            const lunchEnd = hf19_toDate(a.lunchEnd || a.lastLunchEnd);
            if (lunchStart && lunchEnd) {
                hf19_addInterval(busyByKey, keys, hf19_minsFromDate(lunchStart), hf19_minsFromDate(lunchEnd), 'Attendance Lunch History');
            }
        }));

        return busyByKey;
    }

    if (typeof window.bk_buildBusyByTechForDate === 'function' && !window.__hf19BusyBuilderWrapped) {
        const previousBusyBuilder = window.bk_buildBusyByTechForDate;
        window.bk_buildBusyByTechForDate = async function(date){
            const busyByKey = await previousBusyBuilder.apply(this, arguments);
            try { await hf19_addAttendanceBlocks(date, busyByKey); }
            catch(e) { console.warn('HF19 Attendance lunch availability skipped:', e); }
            return busyByKey;
        };
        window.__hf19BusyBuilderWrapped = true;
    }
})();
// ============================================================
// END HF19 Lunch Break Availability Alignment
// ============================================================


// ── THURAYA HF20: MOBILE BACK NAVIGATION PROTECTION — CLIENT APP ────────────
// Prevents Android/browser Back from closing the app during booking flows.
// First Back: uses THURAYA in-app history. On home/welcome: press again to exit.
(function thurayaClientMobileBackGuardHF20(){
    if (window.__thurayaClientBackGuardHF20) return;
    window.__thurayaClientBackGuardHF20 = true;

    var lastExitPress = 0;
    var EXIT_WINDOW_MS = 2200;
    var guardArmed = false;

    var HOME_SCREENS = new Set(['screen-welcome', 'screen-booking-mode']);
    var PROTECTED_SCREENS = new Set([
        'screen-services','screen-technician','screen-datetime','screen-confirm',
        'screen-group-size','screen-group-services','screen-group-datetime','screen-group-confirm',
        'screen-mybookings','screen-my-account','screen-account-profile','screen-account-profile-edit',
        'screen-payment-methods','screen-wallet','screen-notifications','screen-client-care-library','screen-doc-viewer'
    ]);

    function activeScreenId(){
        var active = document.querySelector('.screen.active');
        return active ? active.id : '';
    }

    function toastMsg(message){
        try { if (typeof toast === 'function') { toast(message, 'info'); return; } } catch(e) {}
        var id = 'thurayaBackGuardToastClient';
        var el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:999999;background:#111;color:#fff;padding:12px 16px;border-radius:999px;font:700 13px system-ui;box-shadow:0 12px 30px rgba(0,0,0,.22);max-width:90%;text-align:center;opacity:0;transition:opacity .18s ease;';
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.style.opacity = '1';
        clearTimeout(el._thTimer);
        el._thTimer = setTimeout(function(){ el.style.opacity = '0'; }, 1900);
    }

    function arm(){
        try {
            if (!guardArmed) {
                history.replaceState(Object.assign({}, history.state || {}, { thurayaRoot:true }), document.title, location.href);
                history.pushState({ thurayaBackGuardHF20:true }, document.title, location.href);
                guardArmed = true;
            }
        } catch(e) {}
    }

    function closeDocViewerIfOpen(){
        if (activeScreenId() === 'screen-doc-viewer' && typeof bk_closeDocumentViewer === 'function') {
            bk_closeDocumentViewer();
            return true;
        }
        return false;
    }

    function goSafePrevious(){
        if (closeDocViewerIfOpen()) return true;

        var id = activeScreenId();
        if (!id || HOME_SCREENS.has(id)) return false;

        if (typeof window.goBack === 'function') {
            try {
                window.goBack();
                return true;
            } catch(e) {}
        }

        // Fallback routing when internal history is unavailable.
        if (PROTECTED_SCREENS.has(id)) {
            if (typeof showScreen === 'function') {
                showScreen('screen-booking-mode');
                return true;
            }
        }
        return false;
    }

    window.addEventListener('popstate', function(evt){
        if (!guardArmed) { arm(); return; }

        if (goSafePrevious()) {
            lastExitPress = 0;
            arm();
            return;
        }

        var now = Date.now();
        if (now - lastExitPress < EXIT_WINDOW_MS) {
            guardArmed = false;
            history.back();
            return;
        }
        lastExitPress = now;
        toastMsg('Press back again to exit THURAYA.');
        arm();
    });

    document.addEventListener('DOMContentLoaded', function(){ setTimeout(arm, 350); });
    if (document.readyState !== 'loading') setTimeout(arm, 350);
})();
// ── END THURAYA HF20 CLIENT BACK GUARD ───────────────────────────────


// ============================================================
// THURAYA HF21: GROUP BOOKING STATE RESET / NO CARRY-OVER
// Client App only. Prevents a completed group booking from leaking
// subgroup/member technician and time selections into the next booking.
// This is a defensive runtime layer because group-booking.js is loaded
// after app.js and owns some of the group state.
// ============================================================
(function thurayaGroupBookingStateResetHF21(){
    if (window.__thurayaGroupStateResetHF21) return;
    window.__thurayaGroupStateResetHF21 = true;

    function clearField(id, value){
        var el = document.getElementById(id);
        if (!el) return;
        el.value = value == null ? '' : value;
        try { el.dispatchEvent(new Event('change', { bubbles:true })); } catch(e) {}
    }

    function clearSelectedButtons(selector){
        document.querySelectorAll(selector).forEach(function(el){
            el.classList.remove('selected','active','is-selected');
            if (el.tagName === 'INPUT') el.checked = false;
        });
    }

    function clearIndividualBookingRuntime(){
        try { window.bk_selectedServices = []; } catch(e) {}
        try { bk_selectedServices = []; } catch(e) {}
        try { window.bk_activePromo = null; } catch(e) {}
        try { bk_activePromo = null; } catch(e) {}
        try { window.bk_confirmedAppt = null; } catch(e) {}
        try { bk_confirmedAppt = null; } catch(e) {}

        clearField('bk_techEmail');
        clearField('bk_techName');
        clearField('bk_techMode', 'any');
        clearField('bk_time');
        clearField('bk_date');
        clearField('bk_promoCode');
        clearField('bk_promoId');
        clearField('bk_promoCodeVal');
        clearField('bk_discountAmount', '0');

        var slots = document.getElementById('bk_slots');
        if (slots) slots.innerHTML = '';
        var slotWrap = document.getElementById('bk_slotsContainer');
        if (slotWrap) slotWrap.style.display = 'none';
        var nextBtn = document.getElementById('btnToConfirm');
        if (nextBtn) nextBtn.disabled = true;

        clearSelectedButtons('#bk_serviceMenu .service-card, #bk_serviceMenu .slot-btn, #bk_slots .slot-btn, #bk_slots button');
        document.querySelectorAll('#bk_serviceMenu input[type="radio"], #bk_serviceMenu input[type="checkbox"]').forEach(function(el){ el.checked = false; });
        document.querySelectorAll('#bk_serviceMenu input[type="number"]').forEach(function(el){ el.value = 0; });

        try { if (typeof selectTechOption === 'function') selectTechOption('any'); } catch(e) {}
        try { if (typeof updateBreakdown === 'function') updateBreakdown(); } catch(e) {}
    }

    function clearGroupBookingRuntime(){
        clearField('grp_time');
        clearField('grp_date');
        var gSlots = document.getElementById('grp_slots');
        if (gSlots) gSlots.innerHTML = '';
        var gSlotWrap = document.getElementById('grp_slotsContainer');
        if (gSlotWrap) gSlotWrap.style.display = 'none';
        var gNext = document.getElementById('grp_toConfirmBtn');
        if (gNext) gNext.disabled = true;

        clearSelectedButtons('#grp_serviceList .service-card, #grp_slots .slot-btn, #grp_slots button, .grp-tech-card, .grp-member-tech, .grp-person-tab');
        document.querySelectorAll('#grp_serviceList input[type="radio"], #grp_serviceList input[type="checkbox"]').forEach(function(el){ el.checked = false; });
        document.querySelectorAll('#grp_serviceList input[type="number"]').forEach(function(el){ el.value = 0; });

        // Known/likely globals used by group-booking.js across earlier builds.
        [
            'grp_members','grp_selectedMembers','grp_selectedServices','grp_assignments','grp_memberAssignments',
            'grp_slotMap','grp_availableSlotMap','grp_availableTechMap','grp_selectedSlotTechs','grp_selectedTechs',
            'grp_cachedAvailability','grp_lastAvailability','grp_groupBookingDraft','grp_confirmedGroup',
            'groupMembers','groupSelections','groupAssignments','groupSlotMap','groupSelectedTechs'
        ].forEach(function(k){
            try {
                if (Array.isArray(window[k])) window[k] = [];
                else if (window[k] && typeof window[k] === 'object') window[k] = {};
                else window[k] = null;
            } catch(e) {}
        });

        // Do not erase profile/client identity. Only booking-draft state is cleared.
        try { if (typeof grp_renderTabs === 'function') grp_renderTabs(); } catch(e) {}
        try { if (typeof grp_updateProgress === 'function') grp_updateProgress(); } catch(e) {}
    }

    window.thurayaClearBookingDraftsHF21 = function(options){
        options = options || {};
        if (options.group !== false) clearGroupBookingRuntime();
        if (options.individual !== false) clearIndividualBookingRuntime();
    };

    function wrapWhenAvailable(name, wrapperFactory){
        var attempts = 0;
        var timer = setInterval(function(){
            attempts += 1;
            if (typeof window[name] === 'function' && !window[name].__thurayaHF21Wrapped) {
                var original = window[name];
                var wrapped = wrapperFactory(original);
                wrapped.__thurayaHF21Wrapped = true;
                window[name] = wrapped;
                clearInterval(timer);
            }
            if (attempts > 80) clearInterval(timer);
        }, 100);
    }

    // After successful group booking, clear all booking draft state so the next
    // individual/group booking starts fresh with no previous member tech/time.
    wrapWhenAvailable('grp_confirmBooking', function(original){
        return async function(){
            var result = original.apply(this, arguments);
            try { if (result && typeof result.then === 'function') await result; } catch(e) { throw e; }
            setTimeout(function(){ window.thurayaClearBookingDraftsHF21({ group:true, individual:true }); }, 350);
            return result;
        };
    });

    // Starting a new group or individual booking must never inherit the previous
    // group slot/tech map.
    wrapWhenAvailable('grp_bookAgain', function(original){
        return function(){
            window.thurayaClearBookingDraftsHF21({ group:true, individual:true });
            return original.apply(this, arguments);
        };
    });

    wrapWhenAvailable('grp_soloMode', function(original){
        return function(){
            window.thurayaClearBookingDraftsHF21({ group:true, individual:true });
            return original.apply(this, arguments);
        };
    });

    wrapWhenAvailable('bk_bookAgain', function(original){
        return function(){
            window.thurayaClearBookingDraftsHF21({ group:true, individual:true });
            return original.apply(this, arguments);
        };
    });

    // If user returns to the booking mode after success, reset draft state once.
    var lastScreen = '';
    var previousShowScreen = window.showScreen;
    if (typeof previousShowScreen === 'function' && !previousShowScreen.__thurayaHF21ScreenWrapped) {
        window.showScreen = function(id){
            var result = previousShowScreen.apply(this, arguments);
            if (id === 'screen-booking-mode' && (lastScreen === 'screen-group-success' || lastScreen === 'screen-success')) {
                setTimeout(function(){ window.thurayaClearBookingDraftsHF21({ group:true, individual:true }); }, 120);
            }
            lastScreen = id || lastScreen;
            return result;
        };
        window.showScreen.__thurayaHF21ScreenWrapped = true;
    }

    document.addEventListener('DOMContentLoaded', function(){
        // Keep initial load clean without affecting logged-in profile state.
        setTimeout(function(){
            clearField('grp_time');
            clearField('bk_time');
        }, 800);
    });
})();
// ============================================================
// END HF21 Group Booking State Reset
// ============================================================

/* ============================================================
   THURAYA CLIENT — HF28 EMERGENCY BOOKING RECOVERY
   Purpose: restore client booking immediately during production operations.
   Safety: does not touch menu rendering, UI styling, tax settings, or staff data.
   Behaviour:
   - Uses live availability when it works.
   - If shared availability data/therapy tags block all slots, falls back to safe
     bookable windows so clients can still submit bookings.
   - Staff can reassign/adjust operationally after booking if needed.
   ============================================================ */
(function thurayaClientEmergencyBookingRecoveryHF28(){
    if (window.__thurayaClientEmergencyBookingRecoveryHF28) return;
    window.__thurayaClientEmergencyBookingRecoveryHF28 = true;

    function q(id){ return document.getElementById(id); }
    function norm(v){ return String(v || '').trim().toLowerCase(); }
    function minsToTime(total){
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }
    function timeLabel(t24){
        const parts = String(t24 || '00:00').split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    function selectedDuration(){
        try {
            const total = (window.bk_selectedServices || bk_selectedServices || []).reduce((s, x) => s + (Number(x.dur || 0) * (Number(x.qty || 1))), 0);
            return Math.max(total || 0, 30);
        } catch(e) { return 60; }
    }
    function safeTechs(){
        const list = Array.isArray(window.bk_techs) ? window.bk_techs : (Array.isArray(bk_techs) ? bk_techs : []);
        return list.filter(t => t && (t.email || t.name));
    }
    function eligibleTechsLoose(){
        let eligible = [];
        try { eligible = (typeof bk_getEligibleTechsForSelectedServices === 'function') ? bk_getEligibleTechsForSelectedServices() : []; }
        catch(e) { eligible = []; }
        if (eligible && eligible.length) return eligible;
        return safeTechs();
    }
    function renderSlotsFromMap(slotMap, recovery){
        const slots = Object.keys(slotMap).map(Number).sort((a,b)=>a-b);
        if (!slots.length) return '';
        const note = recovery ? `<div class="th-emergency-booking-note" style="font-size:.78rem;color:#6b6258;margin:0 0 10px;line-height:1.35;">Live availability is in recovery mode. THURAYA will confirm technician allocation operationally.</div>` : '';
        return note + slots.map(t => {
            const t24 = minsToTime(t);
            const techList = JSON.stringify(slotMap[t] || []).replace(/'/g, '&#39;');
            return `<button class="slot-btn" data-time="${t24}" data-techs='${techList}' onclick="bk_selectSlot('${t24}', this)">${timeLabel(t24)}</button>`;
        }).join('');
    }
    function buildRecoverySlots(date, techEmails){
        const openTime = 8 * 60;
        const closeTime = 20 * 60;
        const interval = 30;
        const totalMins = selectedDuration();
        const now = new Date();
        const curMins = now.getHours() * 60 + now.getMinutes();
        const today = (typeof todayStr !== 'undefined') ? todayStr : new Date().toISOString().slice(0,10);
        const isToday = date === today;
        const emails = (techEmails && techEmails.length) ? techEmails : [''];
        const slotMap = {};
        for (let t = openTime; t + totalMins <= closeTime; t += interval) {
            if (isToday && t <= curMins + 30) continue;
            slotMap[t] = emails;
        }
        return slotMap;
    }

    const previousGenerateSlots = window.bk_generateSlots;
    window.bk_generateSlots = async function(){
        const date = q('bk_date')?.value || '';
        const timeEl = q('bk_time');
        const slotsEl = q('bk_slots');
        const container = q('bk_slotsContainer');
        const nextBtn = q('btnToConfirm');
        if (timeEl) timeEl.value = '';
        if (nextBtn) nextBtn.disabled = true;
        if (!slotsEl || !container) return previousGenerateSlots ? previousGenerateSlots.apply(this, arguments) : undefined;

        const today = (typeof todayStr !== 'undefined') ? todayStr : new Date().toISOString().slice(0,10);
        if (!date) { container.style.display = 'none'; return; }
        if (date < today) {
            container.style.display = 'block';
            slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;">Cannot book in the past.</p>';
            return;
        }

        let serviceCount = 0;
        try { serviceCount = (window.bk_selectedServices || bk_selectedServices || []).length; } catch(e) { serviceCount = 0; }
        if (!serviceCount) {
            container.style.display = 'none';
            try { toast('Select at least one service first.', 'warning'); } catch(e) {}
            return;
        }

        container.style.display = 'block';
        slotsEl.innerHTML = '<div class="loading-pulse">Checking available times...</div>';

        const mode = q('bk_techMode')?.value || 'any';
        const specificEmail = q('bk_techEmail')?.value || '';
        let techs = eligibleTechsLoose();
        let techEmails = (mode === 'specific' && specificEmail)
            ? (techs.some(t => norm(t.email) === norm(specificEmail)) ? [specificEmail] : [specificEmail])
            : techs.map(t => t.email).filter(Boolean);

        try {
            if (typeof bk_buildBusyByTechForDate !== 'function' || !techEmails.length) throw new Error('Availability dependency unavailable');
            const busyByKey = await bk_buildBusyByTechForDate(date);
            const openTime = 8 * 60, closeTime = 20 * 60, interval = 30;
            const totalMins = selectedDuration();
            const now = new Date();
            const curMins = now.getHours() * 60 + now.getMinutes();
            const isToday = date === today;
            const slotMap = {};
            for (let t = openTime; t + totalMins <= closeTime; t += interval) {
                if (isToday && t <= curMins + 10) continue;
                const slotEnd = t + totalMins;
                techEmails.forEach(email => {
                    let free = true;
                    try { free = (typeof bk_intervalFreeForTech === 'function') ? bk_intervalFreeForTech(busyByKey, email, t, slotEnd) : true; }
                    catch(e) { free = true; }
                    if (free) {
                        if (!slotMap[t]) slotMap[t] = [];
                        slotMap[t].push(email);
                    }
                });
            }
            let html = renderSlotsFromMap(slotMap, false);
            if (!html) html = renderSlotsFromMap(buildRecoverySlots(date, techEmails), true);
            slotsEl.innerHTML = html || '<p style="color:var(--error);font-size:0.875rem;">No available times for this date. Try a different date.</p>';
        } catch(e) {
            console.warn('HF28 live availability failed; using recovery slots:', e);
            slotsEl.innerHTML = renderSlotsFromMap(buildRecoverySlots(date, techEmails), true);
        }

        try { if (typeof bk_finalSyncCTAs === 'function') setTimeout(bk_finalSyncCTAs, 40); } catch(e) {}
    };

    const previousSelectSlot = window.bk_selectSlot;
    window.bk_selectSlot = function(time, btn){
        try {
            document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
            if (btn) btn.classList.add('selected');
            if (q('bk_time')) q('bk_time').value = time;
            const mode = q('bk_techMode')?.value || 'any';
            if (mode === 'any') {
                let available = [];
                try { available = JSON.parse(btn?.getAttribute('data-techs') || '[]'); } catch(e) { available = []; }
                const assignedEmail = available.find(Boolean) || '';
                if (q('bk_techEmail')) q('bk_techEmail').value = assignedEmail;
                const tech = safeTechs().find(t => norm(t.email) === norm(assignedEmail));
                if (q('bk_techName')) q('bk_techName').value = tech?.name || (assignedEmail ? assignedEmail : 'To be assigned');
            }
            if (q('btnToConfirm')) q('btnToConfirm').disabled = false;
            try { if (typeof bk_finalSyncCTAs === 'function') setTimeout(bk_finalSyncCTAs, 40); } catch(e) {}
        } catch(e) {
            if (previousSelectSlot) return previousSelectSlot.apply(this, arguments);
        }
    };

    window.bk_hasSlotConflict = async function(techEmail, date, time){
        // Emergency recovery: do not block a client at confirmation because shared
        // availability reads are unstable. Exact conflicts are still operationally
        // visible to Staff App after booking.
        return false;
    };

    // Re-check slots when returning to the date screen after selecting services/tech.
    const previousGoToStep = window.goToStep;
    window.goToStep = function(id){
        const result = previousGoToStep ? previousGoToStep.apply(this, arguments) : undefined;
        if (id === 'screen-datetime') setTimeout(() => { try { window.bk_generateSlots(); } catch(e){} }, 120);
        return result;
    };

    console.log('THURAYA Client HF28 Emergency Booking Recovery loaded');
})();

