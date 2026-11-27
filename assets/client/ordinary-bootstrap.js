'use strict';
(function(root){
 const config=root.ThurayaOrdinaryStaging?.requireReady();
 if(!config)throw Error('EXACT_ORDINARY_STAGING_CONFIGURATION_REQUIRED');
 if(root.firebase.apps.length)throw Error('FRESH_FIREBASE_INITIALIZATION_REQUIRED');
 root.firebase.initializeApp(config.firebase);
})(window);
