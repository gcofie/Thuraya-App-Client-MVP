// ============================================================
//  THURAYA — Firebase Environment Config
//  Place this file in the ROOT of BOTH app repos.
//  Load it BEFORE app.js in index.html.
//
//  How it works:
//  - Staging index.html has <meta name="thuraya-env" content="staging">
//  - Production index.html does NOT have that meta tag
//  - This file auto-selects the correct Firebase project
// ============================================================
(function() {

    const PROD_CONFIG = {
        apiKey:            "AIzaSyBTZOVjppINaVyYslRnAkC04EjJyMt40j8",
        authDomain:        "thuraya-client-telling.firebaseapp.com",
        projectId:         "thuraya-client-telling",
        storageBucket:     "thuraya-client-telling.firebasestorage.app",
        messagingSenderId: "1061064260367",
        appId:             "1:1061064260367:web:ffedb019649bcf1cbadc7a"
    };

    const STAGING_CONFIG = {
        apiKey:            "AIzaSyDuQtIiyWmLSOYrjRwuxG7XBWBT4OCsHPc",
        authDomain:        "thuraya-staging.firebaseapp.com",
        projectId:         "thuraya-staging",
        storageBucket:     "thuraya-staging.firebasestorage.app",
        messagingSenderId: "649346361608",
        appId:             "1:649346361608:web:20c42de70c6f7c75e0e4bd"
    };

    const isStaging = !!document.querySelector('meta[name="thuraya-env"][content="staging"]');
    const activeConfig = isStaging ? STAGING_CONFIG : PROD_CONFIG;

    window.THURAYA_CONFIG = activeConfig;
    window.THURAYA_ENV    = isStaging ? 'staging' : 'production';

    // Yellow staging banner
    if (isStaging) {
        document.addEventListener('DOMContentLoaded', function() {
            const bar = document.createElement('div');
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#f59e0b;color:#1a1f2e;text-align:center;padding:7px 16px;font-size:0.78rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:12px;';
            bar.innerHTML = '⚠️ STAGING ENVIRONMENT — Test data only. Not live. <button onclick="this.parentElement.remove()" style="background:rgba(0,0,0,0.15);border:none;color:#1a1f2e;padding:2px 8px;border-radius:3px;cursor:pointer;font-weight:700;">✕</button>';
            document.body.prepend(bar);
        });
    }

    console.log('🔧 Thuraya ENV:', window.THURAYA_ENV, '| Project:', activeConfig.projectId);
})();
