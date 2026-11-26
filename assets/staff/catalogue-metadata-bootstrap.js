(function(root){
 'use strict';
 if(root.THURAYA_ORDINARY_CATALOGUE!==true||!root.installThurayaCatalogueMetadata||
    !root.navigator?.locks||!root.crypto?.randomUUID)return;
 const app=root.firebase.app();
 if(app.options.projectId!=='thuraya-client-telling')return;
 const invoke=app.functions('us-central1').httpsCallable('thurayaMenuPricing');
 root.ThurayaCatalogueMetadata=root.installThurayaCatalogueMetadata({
  call:(action,args)=>invoke({action,args}).then(reply=>reply.data),
  sessionScope:()=>app.auth().currentUser?.uid?'thuraya-client-telling.'+app.auth().currentUser.uid:null,
  storage:root.localStorage,locks:root.navigator.locks,uuid:()=>root.crypto.randomUUID()
 });
})(window);
