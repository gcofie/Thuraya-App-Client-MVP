(function(root){
 'use strict';
 const scope=root.ThurayaOrdinaryStaging,config=scope.requireReady(),app=root.firebase.app();
 const target=typeof db!=='undefined'?db:root.db||app.firestore();
 if(!root.ThurayaAllocationTransport?.install)throw Error('RETAINED_ALLOCATION_TRANSPORT_REQUIRED');
 root.ThurayaLocalReviewedEdit=root.ThurayaAllocationTransport.install(target,root.firebase,'staff',{projectId:config.projectId,endpoint:config.endpoints.reviewed,busyEndpoint:config.endpoints.busy});
})(window);
