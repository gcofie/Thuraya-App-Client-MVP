// ============================================================
//  THURAYA — Firebase Environment Config + Initialization
//  HF29 Environment Isolation Guard
//  Uses hostname detection only. HTML meta tags are ignored so
//  Main/Production cannot accidentally point to staging after merges.
// ============================================================
(function() {

    const PROD_CONFIG = {
        apiKey: "AIzaSyBTZOVjppINaVyYslRnAkC04EjJyMt40j8",
        authDomain: "thuraya-client-telling.firebaseapp.com",
        projectId: "thuraya-client-telling",
        storageBucket: "thuraya-client-telling.firebasestorage.app",
        messagingSenderId: "1061064260367",
        appId: "1:1061064260367:web:ffedb019649bcf1cbadc7a"
    };

    const STAGING_CONFIG = {
        apiKey: "AIzaSyDuQtIiyWmLSOYrjRwuxG7XBWBT4OCsHPc",
        authDomain: "thuraya-staging.firebaseapp.com",
        projectId: "thuraya-staging",
        storageBucket: "thuraya-staging.firebasestorage.app",
        messagingSenderId: "649346361608",
        appId: "1:649346361608:web:20c42de70c6f7c75e0e4bd"
    };

    const hostname = String(window.location.hostname || '').toLowerCase();

    // IMPORTANT:
    // Environment is determined by URL only. Do not use <meta name="thuraya-env">.
    // This prevents a staging meta tag from being merged into Main and sending
    // production users to the staging Firebase project.
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    const isStagingHost = hostname.includes('staging') || hostname.includes('stage');
    const isStaging = isLocal || isStagingHost;

    const activeConfig = isStaging ? STAGING_CONFIG : PROD_CONFIG;

    window.THURAYA_CONFIG = activeConfig;
    window.THURAYA_ENV = isStaging ? 'staging' : 'production';

    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(activeConfig);
            console.log('🔥 Firebase initialized from firebase-config.js:', window.THURAYA_ENV, '| Project:', activeConfig.projectId);
        } else {
            console.log('🔥 Firebase already initialized:', window.THURAYA_ENV, '| Project:', activeConfig.projectId);
        }
    } else {
        console.error('Firebase SDK not loaded before firebase-config.js');
    }

    if (isStaging) {
        document.addEventListener('DOMContentLoaded', function() {
            if (document.getElementById('thurayaStagingEnvBanner')) return;
            const bar = document.createElement('div');
            bar.id = 'thurayaStagingEnvBanner';
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#f59e0b;color:#1a1f2e;text-align:center;padding:7px 16px;font-size:0.78rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:12px;';
            bar.innerHTML = '⚠️ STAGING ENVIRONMENT — Test data only. Not live. <button onclick="this.parentElement.remove()" style="background:rgba(0,0,0,0.15);border:none;color:#1a1f2e;padding:2px 8px;border-radius:3px;cursor:pointer;font-weight:700;">✕</button>';
            document.body.prepend(bar);
        });
    }

})();
