// UPDATED THURAYA app.js (Phase 8 FIX)
// Welcome screen routing fixed + force reset added

const firebaseConfig = window.THURAYA_CONFIG;

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// State
let bk_currentUser    = null;
let bk_clientProfile  = null;
let bk_isGuest        = false;
let bk_techs          = [];
let _screenHistory    = ['screen-welcome'];

const todayStr = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
})();

// Navigation
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
}

// Force reset (fix disappearing welcome)
window.bk_forceWelcome = function() {
    bk_currentUser = null;
    bk_clientProfile = null;
    bk_isGuest = false;

    auth.signOut().finally(() => {
        _screenHistory = ['screen-welcome'];
        showScreen('screen-welcome');
    });
};

// Init
document.addEventListener('DOMContentLoaded', () => {

    const dateEl = document.getElementById('bk_date');
    if (dateEl) dateEl.min = todayStr;

    auth.onAuthStateChanged(async user => {

        if (!_screenHistory || !_screenHistory.length) {
            _screenHistory = ['screen-welcome'];
        }

        if (user) {
            bk_currentUser = user;

            try {
                const doc = await db.collection('Client_Users')
                    .doc(user.email.toLowerCase())
                    .get();

                if (doc.exists) {
                    bk_clientProfile = doc.data();
                    loadTechs();

                    // FIX: stay on welcome
                    showScreen('screen-welcome');

                } else {
                    document.getElementById('prof_email').value = user.email || '';
                    document.getElementById('prof_name').value  = user.displayName || '';
                    showScreen('screen-profile');
                }

            } catch (e) {
                showScreen('screen-welcome');
            }

        } else {
            showScreen('screen-welcome');
        }
    });

    document.getElementById('btnGoogleSignIn')
        .addEventListener('click', signInWithGoogle);
});

// Google sign in
async function signInWithGoogle() {
    try {
        await auth.signInWithPopup(googleProvider);
    } catch (e) {
        alert('Sign-in failed. Try again.');
    }
}

// Load techs
async function loadTechs() {
    try {
        const usersSnap = await db.collection('Users').get();
        bk_techs = [];

        usersSnap.forEach(doc => {
            const d = doc.data();
            const roles = (Array.isArray(d.roles) ? d.roles : [d.role || ''])
                .map(r => (r || '').toLowerCase());

            if (!roles.some(r => r.includes('tech'))) return;
            if (d.visibleToClients === false) return;

            bk_techs.push({ email: doc.id, name: d.name || doc.id });
        });

    } catch (e) {
        bk_techs = [];
    }
}
