'use strict';
const assert = require('node:assert/strict');
const css = '    <link rel="stylesheet" href="hubtel-diagnostics.css?v=network-diagnostics-1">\n';
const script = '<script src="hubtel-diagnostics.js?v=network-diagnostics-1"></script>\n';
function baselineSource(file, source) {
    if (file !== 'index.html') return source;
    let text = source.replace(/\r\n/g, '\n');
    if (!text.includes('hubtel-diagnostics')) return text;
    for (const [anchor, addition] of [
        ['    <link rel="stylesheet" href="styles.css?v=staff-golive-tax-mode-hf16-20260509">\n', css],
        ['<script src="intelligence-engine-v1.js?v=phase-5-4-final2"></script>\n', script]
    ]) {
        assert.equal(text.split(addition).length, 2, 'One exact diagnostic include');
        assert.ok(text.includes(anchor + addition), 'Exact diagnostic include position');
        text = text.replace(addition, '');
    }
    assert.ok(!text.includes('hubtel-diagnostics'), 'No other diagnostic HTML changes');
    return text;
}
module.exports = { baselineSource, css, script };
