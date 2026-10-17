'use strict';
const vm = require('node:vm');
const acorn = {};
vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'], { exports: acorn, module: { exports: acorn } });
const names = new Set(['bk_dynamicTodayStr', 'bk_currentMins', 'grp_todayString', 'grp_getBookedSlots',
    'grp_getFreeTechsAt', 'grp_isPastSlot', 'grp_findEarliestFullGroup']);
function stripScheduling(source) {
    const spans = [];
    function walk(node) {
        if (!node?.type) return;
        if (node.type === 'FunctionDeclaration' && names.has(node.id.name)) { spans.push(node); return; }
        for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(walk) : value?.type && walk(value);
    }
    walk(acorn.parse(source, { ecmaVersion: 'latest' }));
    for (const node of spans.sort((a,b) => b.start-a.start)) source = source.slice(0,node.start) + '<scheduling:'+node.id.name+'>' + source.slice(node.end);
    return source;
}
// Reverse only the reviewed lifecycle adapters before comparing the original
// financial source. Exact matches are mandatory; arbitrary edits still fail.
function stripLifecycle(source) {
    const pairs = [
        ["const batch = window.ThurayaTechnicianEligibility.bookingBatch(db, { client:true });", "const batch = db.batch();"],
        ["if (!window.ThurayaTechnicianEligibility.eligible(d, { client:true })) return;", "if (d.visibleToClients === false) return;"],
        ["                roles: d.roles || [d.role], active: d.active, disabled: d.disabled, status: d.status,\n                ...(Object.prototype.hasOwnProperty.call(d, 'technicianOperational') ? { technicianOperational:d.technicianOperational } : {}),\n", ""],
        ["return (bk_techs || []).filter(t => window.ThurayaTechnicianEligibility.eligible(t, { client:true })).filter(bk_techMatchesSelectedTherapy);", "return (bk_techs || []).filter(bk_techMatchesSelectedTherapy);"]
    ];
    for (const [after,before] of pairs) {
        if (!source.includes(after)) continue;
        if (source.indexOf(after) !== source.lastIndexOf(after)) throw Error('Duplicate lifecycle adapter');
        source = source.replace(after,before);
    }
    return source;
}
module.exports = { stripScheduling, stripLifecycle };
