'use strict';
// Compatibility exports for the certified preset contract; all I/O uses the
// provider-neutral engine and the same target policy as custom diagnostics.
const engine = require('./network-engine');
const { SERVICES } = require('./profiles');
const { normalizeTarget } = require('./target-policy');
function probeService(service, transport, now) {
    const target = normalizeTarget({ mode: 'HOSTNAME', value: service.hostname });
    return engine.probeTarget({ ...target, name: service.name, targetType: 'PREDEFINED' }, transport, now);
}
module.exports = { ...engine, SERVICES, probeService };
