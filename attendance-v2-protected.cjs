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
module.exports = { stripScheduling };
