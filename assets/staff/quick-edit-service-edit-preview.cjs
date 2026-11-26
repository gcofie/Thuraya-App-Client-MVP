'use strict';
const http = require('node:http');
const { scripts } = require('./quick-edit-service-edit-fixture.cjs');
const fixtureScripts = scripts();
const port = Number(process.env.PORT || 4332);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Quick Edit fixture</title>
<body style="font-family:Arial,sans-serif;margin:24px;background:#fff;color:#111">
<h1 style="font-size:22px">Local Quick Edit fixture</h1><p>Synthetic booking only. No production data or network access.</p>
<button id="open" style="padding:12px;font:inherit">Open synthetic appointment</button>
<p>Changes persist only in this browser tab. Reload resets the fixture.</p>
${fixtureScripts.map((_, i) => '<script src="/fixture-' + i + '.js"></script>').join('')}
<script src="/open.js"></script></body></html>`;
const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    const match = /^\/fixture-(\d+)\.js$/.exec(url.pathname);
    const content = url.pathname === '/' ? html : url.pathname === '/open.js'
        ? "document.getElementById('open').onclick=()=>thOpenExpectedTodayQuickEditV4('synthetic');"
        : match ? fixtureScripts[Number(match[1])] : null;
    if (content == null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
        'Content-Type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(content);
});
server.listen(port, '127.0.0.1', () => console.log('Synthetic Quick Edit preview: http://127.0.0.1:' + port));
