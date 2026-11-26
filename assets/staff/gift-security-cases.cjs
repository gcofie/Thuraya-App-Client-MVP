'use strict';
const cases = [];
const roles = ['Unauthenticated', 'Technician', 'FOH', 'Manager', 'System Admin', 'Other authenticated Staff', 'Unknown authenticated account'];
function probe(name, collection, method, role, before = {}, after = {}, allow = false, nested = false) {
    const path = '/databases/(default)/documents/' + collection + '/synthetic' + (nested ? '/nested/record' : '');
    cases.push({ name, test: { expectation: allow ? 'ALLOW' : 'DENY', request: { path, method,
        auth: role === 'Unauthenticated' ? null : { uid: 'synthetic-' + role.replace(/\W/g,''), token: { role } }, resource: { data: after } }, resource: { data: before }, pathEncoding: 'PLAIN' } });
}
for (const role of roles) for (const collection of ['Gift_Cards','Gift_Card_Redemptions']) for (const method of ['get','list','create','update','delete']) {
    probe(`${role} direct ${collection} ${method}`, collection, method, role, { amount: 100, status: 'Active' }, { amount: 9999, status: 'Active' });
}
for (const role of ['Technician','FOH','Unknown authenticated account']) for (const field of ['amount','remainingBalance','status','expiryDate','totalAllowedUses','usedCount','remainingUses','issuedBy','lastRedeemedBy']) {
    probe(`${role} direct tampering ${field}`, 'Gift_Cards','update',role,{amount:100,status:'Active'},{amount:100,status:'Active',[field]:'tampered'});
}
for (const role of roles) for (const collection of ['Gift_Cards','Gift_Card_Redemptions','Gift_Checkouts']) for (const method of ['get','list','create','update','delete']) {
    probe(`Nested ${role} ${collection} ${method}`,collection,method,role,{}, {}, false, true);
}
for (const collection of ['Active_Jobs','Appointments']) {
    for (const role of roles) for (const method of ['get','list','create','update','delete']) {
        probe(`Unrelated nested ${collection} ${role} ${method}`,collection,method,role,{}, {},['get','list'].includes(method)||role!=='Unauthenticated',true);
    }
    for (const patch of [{giftCheckoutId:'fake'},{giftCardCode:'THGC-SYNT-HET1'},{giftCardAppliedAmount:100},{hasGiftCardApplied:true},{paymentMethod:'Gift Card / Voucher'},{paymentSplits:[{method:'Gift Card / Voucher',amount:100}]},{paymentSplits:[{method:'Cash',amount:10},{method:'Card / POS',code:'THGC-SYNT-HET1',amount:90}]}]) {
        for (const method of ['create','update']) probe(`Gift settlement forgery ${collection} ${method} ${Object.keys(patch)[0]} ${JSON.stringify(patch)}`,collection,method,'FOH',{status:'Ready for Payment'},{status:'Closed',...patch});
    }
    const settled = { giftCheckoutId:'gc_synthetic',status:'Closed',paymentStatus:'Paid',amountDue:100 };
    for (const field of ['amountDue','status','giftCheckoutId','paymentSplits','newFinancialOverride','sourceAppointmentId']) {
        probe(`Settled ${collection} immutable ${field}`,collection,'update','System Admin',settled,{...settled,[field]:'tampered'});
    }
    probe(`Settled ${collection} delete denied`,collection,'delete','System Admin',settled,{});
    probe(`Settled ${collection} notes allowed`,collection,'update','FOH',settled,{...settled,notes:'Nonfinancial note'},true);
    probe(`Nongift ${collection} checkout unchanged`,collection,'update','FOH',{status:'Ready for Payment'},{status:'Closed',paymentStatus:'Paid',paymentMethod:'Cash',paymentSplits:[{method:'Cash',amount:50},{method:'Card / POS',amount:50}]},true);
    probe(`Nongift ${collection} public read unchanged`,collection,'get','Unauthenticated',{}, {},true);
}
for(const collection of ['Clients','Bookings','Users','Sales','Sales_Promotions','Sales_Redemptions','Commission_Rules','Commission_Locks','Commission_Records']) {
    for(const role of ['Unauthenticated','FOH']) for(const method of ['get','list','create','update','delete']) {
        const commission=collection.startsWith('Commission_');
        const allow=!commission && (['get','list'].includes(method)||role==='FOH'||method==='create'&&['Clients','Bookings'].includes(collection)||method==='update'&&collection==='Clients');
        probe(`Unrelated ${collection} ${role} ${method}`,collection,method,role,{}, {},allow);
    }
}
module.exports = cases;
