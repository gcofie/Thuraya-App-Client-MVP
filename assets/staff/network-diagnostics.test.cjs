'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { normalizeTarget, publicAddress, checkHost, canonicalIp } = require('./hubtel-diagnostics-backend/target-policy');
const { createTransport, probeTarget } = require('./hubtel-diagnostics-backend/network-engine');
const { PROFILES } = require('./hubtel-diagnostics-backend/profiles');
const { createService, CAPABILITIES, VIEW, RUN } = require('./hubtel-diagnostics-backend/service');
const PROJECT = 'thuraya-staging';
const auth = { uid: 'synthetic-network-operator', token: { email: 'network@example.invalid', aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT } };
const request = data => ({ auth, data: { projectId: PROJECT, ...data } });
const custom = (value = 'https://public.example.org/synthetic-path', method = 'HEAD') => ({ mode: 'URL', value, method });
const fake = overrides => ({ egress: async () => '8.8.8.8', resolve: async () => ({ ipv4: ['8.8.8.8'], ipv6: [] }),
    tcp: async () => ({ connectedIp: '8.8.8.8' }), tls: async () => ({ hostnameMatches: true, certificateValid: true }),
    https: async () => ({ httpStatus: 204, requestSent: true, connectedIp: '8.8.8.8' }), ...overrides });
function service(overrides = {}) {
    const audit = [];
    const handle = createService({ projectId: PROJECT, readStaff: async () => ({ role: 'Manager' }), transport: fake(), audit: async event => audit.push(event), ...overrides });
    return { handle, audit };
}
for (const [mode, value] of [['IP','8.8.8.8'], ['IP','2606:4700:4700::1111'], ['HOSTNAME','public.example.org'], ['URL','https://public.example.org/path']])
    test('generic target accepts explicit public ' + mode + ' ' + value, () => assert.equal(normalizeTarget({ mode, value }).port, 443));
for (const profile of PROFILES) test('Hubtel preset data compatibility ' + profile.id, () => {
    const t = normalizeTarget({ mode: 'PREDEFINED', profile: profile.id }); assert.equal(t.hostname, profile.hostname); assert.equal(t.path, '/'); assert.equal(t.method, 'HEAD');
});
for (const ip of ['0.0.0.0','0.1.2.3','10.0.0.1','127.0.0.1','127.255.255.254','100.64.0.1','100.127.255.254','169.254.169.254','169.254.170.2','172.16.0.1','172.31.255.254','192.168.0.1','192.0.2.1','192.0.0.1','192.88.99.1','198.18.0.1','198.19.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','168.63.129.16','::','::1','0:0:0:0:0:0:0:1','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fd00:ec2::254','fe80::1','ff02::1','64:ff9b::a00:1','2001:db8::1','2001:0000::1','2002:7f00:1::','3ffe::1','3fff::1'])
    test('SSRF prohibited address ' + ip, () => { assert.equal(publicAddress(ip), false); assert.throws(() => normalizeTarget({ mode: 'IP', value: ip })); });
for (const host of ['localhost','localhost.localdomain','metadata.google.internal','metadata.google.com','instance-data.ec2.internal','kubernetes.default.svc.cluster.local','service.internal','service.lan','service.home','service.private','service.consul','x.home.arpa','local','singlelabel','public.example.org.','example.org:80','user@example.org','example.org/path','evil.invalid','example.org\\@127.0.0.1'])
    test('SSRF prohibited hostname ' + host, () => assert.throws(() => checkHost(host)));
for (const value of ['http://example.org/','file:///etc/passwd','ftp://example.org/','gopher://example.org/','unix:/tmp/socket','https://example.org:80/','https://example.org:8443/','https://user:pass@example.org/','https://@example.org/','https://127.1/','https://2130706433/','https://0x7f000001/','https://0177.0.0.1/','https://[::1]/','https://[::ffff:127.0.0.1]/','https://example.org/?token=secret','https://example.org/#token','https://example.org/%0d%0aHeader:value','https://example.org\\@127.0.0.1/'])
    test('SSRF URL rejected ' + value, () => assert.throws(() => normalizeTarget(custom(value))));
for (const extra of [{ headers: { Authorization: 'secret' } }, { body: '' }, { cookie: 'secret' }, { credentials: 'secret' }, { port: 443 }, { targets: [] }, { profile: 'HUBTEL_CHECKOUT' }])
    test('custom strict target rejects ' + Object.keys(extra)[0], () => assert.throws(() => normalizeTarget({ ...custom(), ...extra })));
for (const method of ['HEAD','GET','EMPTY_POST']) test('custom HTTPS method ' + method, () => assert.equal(normalizeTarget(custom(undefined, method)).method, method));
for (const method of ['POST','PUT','DELETE','PATCH','OPTIONS']) test('unsupported method ' + method, () => assert.throws(() => normalizeTarget(custom(undefined, method))));
for (const method of ['GET','EMPTY_POST']) test('Hubtel custom method cannot invoke provider operations ' + method, () => assert.throws(() => normalizeTarget(custom('https://payproxyapi.hubtel.com/', method))));
for (const host of PROFILES.map(p => p.hostname)) test('Hubtel custom path remains root-only ' + host, () => assert.throws(() => normalizeTarget(custom('https://' + host + '/not-a-probe'))));
test('URL tokens are replaced by a stable non-reversible display identifier', () => {
    const t = normalizeTarget(custom('https://webhook.site/synthetic-private-token','EMPTY_POST'));
    assert.ok(!t.safeTarget.includes('synthetic-private-token')); assert.match(t.safeTarget,/webhook\.site\/\[path-[a-f0-9]{12}\]/);
});
test('IPv6 uses normalized address comparison', () => assert.equal(canonicalIp('2606:4700:4700:0:0:0:0:1111'),'2606:4700:4700::1111'));
function harness(options = {}) {
    const calls = [], sockets = []; let resolution = 0;
    class Resolver {
        async resolve4(host) { calls.push({ phase: 'dns4', host }); return options.answers ? options.answers(++resolution) : ['8.8.8.8']; }
        async resolve6() { if (options.partialDnsFailure) throw Object.assign(Error(), { code: 'ETIMEOUT' }); return options.ipv6 || []; }
        cancel() {}
    }
    function socket(config, hostname = config.servername || 'public.example.org') {
        const s = new EventEmitter(); s.remoteAddress = options.actual || config.host || '8.8.8.8'; s.authorized = options.authorized !== false;
        s.getPeerCertificate = () => ({ subjectaltname: 'DNS:' + (options.wrongHost ? 'other.example.org' : hostname), valid_to: options.expired ? 'Jan 1 2000' : 'Jan 1 2035' });
        s.getProtocol = () => 'TLSv1.3'; s.destroy = () => { s.destroyed = true; }; sockets.push(s); return s;
    }
    function connect(config, secure) { calls.push({ phase: secure ? 'tls' : 'tcp', config }); const s = socket(config); queueMicrotask(() => s.emit(secure ? 'secureConnect' : 'connect')); return s; }
    function request(config, callback) {
        const req = new EventEmitter(); req.destroy = () => {}; req.end = (...args) => {
            calls.push({ phase: 'http', config, bodyArguments: args });
            queueMicrotask(() => {
                const s = socket({ host: '8.8.8.8' }, config.hostname); req.emit('socket',s); s.emit('secureConnect'); req.emit('finish');
                const res = new EventEmitter(); res.socket = s; res.statusCode = options.status || 204; res.headers = { location: options.location }; res.destroy = () => {};
                callback(res);
                if (config.hostname === 'api.ipify.org') { res.emit('data',Buffer.from('8.8.8.8')); res.emit('end'); }
            });
        }; return req;
    }
    return { calls, sockets, transport: createTransport({ Resolver, connect: c => connect(c,false), secureConnect: c => connect(c,true), request, timeoutMs: 50 }) };
}
for (const method of ['HEAD','GET','EMPTY_POST']) test('wire method has no credentials, cookies, body or payload capture: ' + method, async () => {
    const h = harness(); const result = await probeTarget(normalizeTarget(custom(undefined,method)),h.transport);
    assert.equal(result.httpsStatus,'NETWORK_REACHABLE'); assert.equal(result.connectedIp,'8.8.8.8');
    const req = h.calls.find(c=>c.phase==='http'); assert.equal(req.config.method,method==='EMPTY_POST'?'POST':method); assert.deepEqual(req.bodyArguments,[]);
    assert.deepEqual(Object.keys(req.config.headers).sort(), (method==='EMPTY_POST'?['Accept','Content-Length','User-Agent']:['Accept','User-Agent']).sort());
    if(method==='EMPTY_POST') assert.equal(req.config.headers['Content-Length'],'0');
    assert.equal(req.config.agent,false); assert.equal(req.config.rejectUnauthorized,true); assert.equal(req.config.port,443);
    assert.ok(!JSON.stringify(result).includes('synthetic-path'));
});
test('every resolved family is validated even when IPv4 was selected', async () => {
    const h = harness({ ipv6:['fd00::1'] }); const r = await probeTarget(normalizeTarget(custom()),h.transport);
    assert.equal(r.errorCategory,'UNSAFE_ADDRESS'); assert.equal(h.calls.filter(c=>c.phase!=='dns4').length,0);
});
test('incomplete DNS family lookup fails closed', async () => {
    const h = harness({ partialDnsFailure:true }); const r=await probeTarget(normalizeTarget(custom()),h.transport);
    assert.equal(r.errorCategory,'TIMEOUT'); assert.equal(h.calls.filter(c=>c.phase!=='dns4').length,0);
});
test('rebinding to private before first connect is rejected', async () => {
    const h=harness({ answers:n=>[n===1?'8.8.8.8':'127.0.0.1'] }); const r=await probeTarget(normalizeTarget(custom()),h.transport);
    assert.equal(r.errorCategory,'UNSAFE_ADDRESS'); assert.equal(h.calls.filter(c=>c.phase==='tcp').length,0);
});
test('rebinding to a different public destination requires a new deliberate run', async () => {
    const h=harness({ answers:n=>[n===1?'8.8.8.8':'1.1.1.1'] }); const r=await probeTarget(normalizeTarget(custom()),h.transport);
    assert.equal(r.errorCategory,'DNS_REBINDING_BLOCKED'); assert.equal(h.calls.filter(c=>c.phase==='tcp').length,0);
});
test('rebinding immediately before HTTP cannot transmit a POST', async () => {
    const h=harness({ answers:n=>[n<4?'8.8.8.8':'10.0.0.1'] }); const r=await probeTarget(normalizeTarget(custom(undefined,'EMPTY_POST')),h.transport);
    assert.equal(r.errorCategory,'UNSAFE_ADDRESS'); assert.equal(h.calls.filter(c=>c.phase==='http').length,0);
});
for(const actual of ['127.0.0.1','10.0.0.1','1.1.1.1']) test('actual destination validation blocks '+actual, async()=>{
    const h=harness({actual}); const r=await probeTarget(normalizeTarget(custom()),h.transport); assert.equal(r.httpsReachable,false); assert.equal(h.calls.filter(c=>c.phase==='http').length,0);
});
for(const opts of [{authorized:false},{wrongHost:true},{expired:true}]) test('TLS is mandatory '+JSON.stringify(opts),async()=>{
    const h=harness(opts); const r=await probeTarget(normalizeTarget(custom()),h.transport); assert.equal(r.tlsStatus,'FAIL'); assert.equal(r.httpsReachable,false); assert.equal(h.calls.filter(c=>c.phase==='http').length,0);
});
for(const status of [200,204,301,302,400,401,403,404,405]) test('HTTP response is independent of reachability '+status,async()=>{
    const r=await probeTarget(normalizeTarget(custom()),harness({status}).transport);assert.equal(r.httpsReachable,true);assert.equal(r.httpStatus,status);
});
for(const location of ['http://example.org/','https://127.0.0.1/','https://169.254.169.254/','https://metadata.google.internal/','https://[::1]/','https://user:pass@example.org/','https://example.org:8080/']) test('redirect is blocked without a second HTTP request: '+location,async()=>{
    const h=harness({status:302,location});const r=await probeTarget(normalizeTarget(custom()),h.transport);assert.equal(r.redirectStatus,'BLOCKED');assert.equal(r.httpsReachable,true);assert.equal(h.calls.filter(c=>c.phase==='http').length,1);assert.ok(!JSON.stringify(r).includes(location));
});
test('safe public redirect is validated but never followed',async()=>{
    const h=harness({status:302,location:'https://other.example.org/next'});const r=await probeTarget(normalizeTarget(custom()),h.transport);assert.equal(r.redirectStatus,'VALIDATED_NOT_FOLLOWED');assert.equal(h.calls.filter(c=>c.phase==='http').length,1);
});
test('redirect hostname resolving privately is blocked',async()=>{
    const h=harness({status:302,location:'https://other.example.org/',answers:n=>[n<5?'8.8.8.8':'10.0.0.1']});const r=await probeTarget(normalizeTarget(custom()),h.transport);assert.equal(r.redirectStatus,'BLOCKED');assert.equal(h.calls.filter(c=>c.phase==='http').length,1);
});
test('single custom target stays single',async()=>{
    const r=await service().handle(request({command:'runTarget',target:custom()}));assert.equal(r.services.length,1);assert.equal(r.services[0].targetType,'URL');
});
test('Run All selects exactly presets, sequentially, without custom target',async()=>{
    let active=0,maximum=0;const hosts=[];
    const f=service({transport:fake({https:async host=>{active++;maximum=Math.max(maximum,active);hosts.push(host);await new Promise(r=>setTimeout(r,1));active--;return {httpStatus:404};}})});
    const r=await f.handle(request({command:'runAll'}));assert.equal(r.services.length,3);assert.equal(maximum,1);assert.deepEqual(hosts,PROFILES.map(p=>p.hostname));
    await assert.rejects(service().handle(request({command:'runAll',target:custom()})),{code:'invalid-argument'});
});
test('comparison deliberately adds exactly one empty POST after three presets',async()=>{
    const calls=[];const f=service({transport:fake({https:async(host,ip,options)=>{calls.push([host,options.method]);return {httpStatus:204,requestSent:true};}})});
    const r=await f.handle(request({command:'compare',target:custom('https://webhook.site/synthetic-private-token','EMPTY_POST'),confirmEmptyPost:true}));
    assert.deepEqual(calls,[...PROFILES.map(p=>[p.hostname,'HEAD']),['webhook.site','EMPTY_POST']]);assert.equal(r.services.length,4);
    assert.equal(new Set(r.services.map(s=>s.executionPath)).size,1);assert.equal(new Set(r.services.map(s=>s.egressIp)).size,1);
    assert.ok(r.services.every(s=>s.correlationId===r.correlationId&&s.environment==='STAGING'));
    assert.equal(r.providerConfirmation,'AWAITING PROVIDER CONFIRMATION');assert.equal(f.audit.filter(e=>e.event==='NETWORK_EGRESS_CONFIRMATION_POST_SENT').length,1);
    assert.ok(!JSON.stringify([r,f.audit]).includes('synthetic-private-token'));assert.ok(!JSON.stringify(f.audit).includes('network@example.invalid'));
});
for(const data of [{command:'compare'},{command:'compare',target:{mode:'IP',value:'8.8.8.8'}},{command:'runTarget',target:custom(undefined,'EMPTY_POST')},{command:'runTarget',target:custom(),confirmEmptyPost:true},{command:'runAll',targets:[]},{command:'runTarget',target:[custom()]}]) test('explicit command selection rejects '+JSON.stringify(data),async()=>{
    await assert.rejects(service().handle(request(data)),{code:'invalid-argument'});
});
test('capabilities are read/run only with legacy compatibility, not management',async()=>{
    const r=await service().handle(request({command:'capabilities'}));assert.deepEqual(r.capabilities,[...CAPABILITIES]);assert.ok(r.capabilities.includes(VIEW)&&r.capabilities.includes(RUN));assert.ok(!r.capabilities.some(c=>/manage|payment|refund/.test(c)));
});
for(const role of ['Manager','Admin','System Admin'])test('generic RBAC supports '+role,async()=>{
    const r=await service({readStaff:async()=>({role})}).handle(request({command:'runTarget',target:custom()}));assert.equal(r.services.length,1);
});
for(const role of ['Technician','Assistant Manager','Client'])test('generic RBAC denies '+role,async()=>{
    await assert.rejects(service({readStaff:async()=>({role})}).handle(request({command:'runAll'})),{code:'permission-denied'});
});
test('anonymous invocation never touches DNS',async()=>{
    let probes=0;await assert.rejects(service({transport:fake({resolve:async()=>{probes++;}})}).handle({...request({command:'runAll'}),auth:null}),{code:'unauthenticated'});assert.equal(probes,0);
});
test('exhausted batch deadline cannot send remaining custom POST',async()=>{
    let clock=0,posts=0;const f=service({now:()=>clock,transport:fake({https:async(_h,_ip,o)=>{clock+=25000;if(o.method==='EMPTY_POST')posts++;return {httpStatus:200};}})});
    const r=await f.handle(request({command:'compare',target:custom(undefined,'EMPTY_POST'),confirmEmptyPost:true}));assert.equal(posts,0);assert.equal(r.services[3].errorCategory,'TIMEOUT');
});
test('generic engine has no provider host literals or credential inputs',()=>{
    const source=fs.readFileSync('hubtel-diagnostics-backend/network-engine.js','utf8');assert.doesNotMatch(source,/hubtel\.com|webhook\.site|Authorization:|Cookie:|process\.env/);
});
