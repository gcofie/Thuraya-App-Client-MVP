'use strict';
const PROFILES = Object.freeze([
    Object.freeze({ id: 'HUBTEL_CHECKOUT', name: 'Hubtel Checkout', hostname: 'payproxyapi.hubtel.com' }),
    Object.freeze({ id: 'HUBTEL_STATUS', name: 'Hubtel Transaction Status', hostname: 'api-txnstatus.hubtel.com' }),
    Object.freeze({ id: 'HUBTEL_REFUND', name: 'Hubtel Refund', hostname: 'refund-api.hubtel.com' })
]);
const SERVICES = Object.freeze(PROFILES.map(({ hostname }, index) => Object.freeze({
    name: ['Checkout', 'Transaction Status', 'Refund'][index], hostname
})));
module.exports = { PROFILES, SERVICES };
