'use strict';
const fs = require('node:fs'), cp = require('node:child_process'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const baseline = '170250581dbf90c974a6dce4c561b7213270253a';
const read = file => fs.readFileSync(__dirname + '/' + file, 'utf8').replace(/\r\n/g, '\n');
const original = file => cp.execFileSync('git', ['show', baseline + ':' + file], { cwd: __dirname, encoding: 'utf8', maxBuffer: 16e6 }).replace(/\r\n/g, '\n');
function strip(file, text) {
    if (file === 'app.js') {
        const originalText = original(file);
        const old = originalText.split('\n');
        const begin = '/* ============================================================\n   THURAYA STAFF — GO-LIVE HOTFIX 10';
        const finish = '/* === END THURAYA STAFF — GO-LIVE HOTFIX 10 === */';
        const start = text.indexOf(begin), stop = text.indexOf(finish, start);
        const oldStart = originalText.indexOf(begin), oldStop = originalText.indexOf(finish, oldStart);
        assert.ok(start >= 0 && stop > start && oldStart >= 0 && oldStop > oldStart);
        assert.equal(text.indexOf(begin, start + 1), -1);
        const quickEditV4 = text.slice(start, stop + finish.length);
        assert.equal(crypto.createHash('sha256').update(quickEditV4).digest('hex'),
            '0eb35350f0a30db83e49e6b84dc46fd28cefe5f5bbfe0fde71797fc2094ce008');
        text = text.slice(0, start) + originalText.slice(oldStart, oldStop + finish.length) + text.slice(stop + finish.length);
        const replacements = [
            ["${window.ThurayaNoShow?.buttons(appt) || ''}", old.find(l => l.includes("onclick=\"markNoShow('${appt.id}')\""))?.trim()],
            ["${canNoShow ? (window.ThurayaNoShow?.buttons(a) || '') : ''}", old.find(l => l.includes('${canNoShow ?'))?.trim()],
            ['window.ThurayaNoShowModel.distinctGroups(rows)', 'rows.filter(a => a.isGroupBooking || a.groupId).length'],
            ['window.ThurayaNoShowModel.isNoShow(a.status)', "statusText(a.status) === 'No Show' || a.autoNoShow === true"]
        ];
        for (const [next, prior] of replacements) { assert.ok(prior && text.includes(next)); text = text.replace(next, prior); }
        function restoreRange(current, reference, startMarker, endMarker) {
            const start = current.indexOf(startMarker);
            if (start < 0) return current;
            const end = current.indexOf(endMarker, start);
            assert.ok(end > start, 'Missing reviewed Intelligence end marker: ' + endMarker);
            const currentStop = end + endMarker.length;
            const refStart = reference.indexOf(startMarker);
            const refEnd = reference.indexOf(endMarker, refStart);
            if (refStart >= 0 && refEnd > refStart) {
                return current.slice(0, start) + reference.slice(refStart, refEnd + endMarker.length) + current.slice(currentStop);
            }
            return current.slice(0, start) + current.slice(currentStop);
        }
        const issue4Marker = text.indexOf('// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS');
        if (issue4Marker >= 0) {
            const issue4Start = text.lastIndexOf('// ============================================================================', issue4Marker);
            const issue4End = text.indexOf('\n})();', issue4Marker);
            assert.ok(issue4Start >= 0 && issue4End > issue4Marker, 'Missing Issue 4 helper bounds');
            text = text.slice(0, issue4Start) + text.slice(issue4End + '\n})();'.length);
            text = text.replace(/\n{3}(console\.log\('✅ Reports v2 no-index query patch loaded: reports-v2-no-index-20260425'\);)/, '\n\n$1');
        }
        text = restoreRange(text, originalText,
            '// PHASE 5.3D – ALERTS / ADVANCED INTELLIGENCE',
            '// END THURAYA PHASE 5.5C CLIENT INTEL GROUP BOOKING READER');
        text = restoreRange(text, originalText,
            '// THURAYA PHASE 6 — PREDICTIVE INTELLIGENCE',
            '// END THURAYA PHASE 6.4 — AI ACTION LAYER');
    }
    if (file === 'index.html') text = text.replace('<script src="no-show-model.js?v=group-noshow-1"></script>\n<script src="no-show-ui.js?v=group-noshow-1"></script>\n', '');
    if (file === 'reports-v2.js') {
        text = text.replace('        async function includeAppointmentNoShows(rows, start, end) {\n            const appointments = filterRows(await fetchDateRange("Appointments", start, end));\n            return window.ThurayaNoShowModel.appendNoShows(rows, appointments);\n        }\n', '');
        assert.equal(text.split('                if (rows.length) rows = await includeAppointmentNoShows(rows, start, end);\n').length, 5);
        text = text.replaceAll('                if (rows.length) rows = await includeAppointmentNoShows(rows, start, end);\n', '');
    }
    return text;
}
function check(file) { assert.equal(strip(file, read(file)), original(file), 'Only reviewed No Show integration may change: ' + file); }
module.exports = { check, strip, read, original };
