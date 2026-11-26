'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const cp = require('node:child_process'), crypto = require('node:crypto');
const parity = require('./hubtel-diagnostics-production-parity.cjs');
const BASE = 'b1fa8540a1cf069a33ecd74e77cc56f660d4ed6b';
const policyFile = 'hubtel-diagnostics-backend/pnpm-workspace.yaml';
const policy = 'strictDepBuilds: true\nallowBuilds:\n  protobufjs@7.6.6: true\n';
const source = path.join(__dirname, 'hubtel-diagnostics-backend');
const node = process.env.HUBTEL_PACKAGING_NODE || process.execPath;
const pnpm = process.env.HUBTEL_PACKAGING_PNPM || require.resolve('pnpm/bin/pnpm.cjs');
const env = { ...process.env, CI: 'true', PATH: path.dirname(node) + path.delimiter + process.env.PATH };
const normalize = value => value.toString().replace(/\r\n/g, '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const git = args => cp.execFileSync('git', args, { cwd: __dirname, maxBuffer: 30e6 });
const bundle = ['.gitignore', 'index.js', 'network-engine.js', 'network.js', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'profiles.js', 'service.js', 'target-policy.js'];
const allowed = ['hubtel-diagnostics-backend/package.json', 'hubtel-diagnostics-backend/pnpm-lock.yaml', 'hubtel-diagnostics-integration-parity.cjs', 'hubtel-diagnostics-packaging.test.cjs'];
const dependencies = { '@google-cloud/functions-framework': '3.5.1', 'firebase-admin': '12.7.0', 'firebase-functions': '5.1.1' };

test('packaging uses configured Node 22 and exact pnpm 11.19.0', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
    assert.equal(pkg.engines.node, '22'); assert.equal(pkg.engines.pnpm, '11.19.0');
    assert.match(cp.execFileSync(node, ['--version'], { encoding: 'utf8' }), /^v22\./);
    assert.equal(cp.execFileSync(node, [pnpm, '--version'], { encoding: 'utf8', env }).trim(), '11.19.0');
});
test('packaging policy enables strict builds and only protobufjs@7.6.6', () => {
    assert.equal(normalize(fs.readFileSync(path.join(__dirname, policyFile))), policy);
});
test('reviewed packaging manifest retains full certified source parity', () => assert.equal(parity.assertTree(), true));
test('production extraction contains only exact diagnostics and explicit certification files', () => {
    const names = normalize(git(['ls-tree', '-r', '--name-only', parity.MAIN])).trim().split('\n');
    const view = parity.workingTree();
    assert.deepEqual([...view.keys()].sort(), [...new Set([...names, ...parity.files])].sort());
    assert.equal(parity.assertTree(view), true);
    assert.equal(normalize(git(['diff', parity.MAIN, '--', '.', ...parity.files.map(file => ':(exclude)' + file)])).trim(), '');
});
for (const [label, value] of [
    ['strict builds disabled', policy.replace('strictDepBuilds: true', 'strictDepBuilds: false')],
    ['all builds enabled', policy + 'dangerouslyAllowAllBuilds: true\n'],
    ['package-wide approval', policy.replace('protobufjs@7.6.6', 'protobufjs')],
    ['different version', policy.replace('7.6.6', '7.6.7')],
    ['second approval', policy + '  arbitrary-package: true\n'],
    ['global script bypass', policy + 'ignoreScripts: true\n'],
    ['approval removed', 'strictDepBuilds: true\n']
]) test('manifest rejects ' + label, () => {
    const view = parity.workingTree(); view.set(policyFile, Buffer.from(value));
    assert.throws(() => parity.assertTree(view), /Only exact reviewed protobufjs build approval/);
});
test('manifest rejects missing packaging policy', () => {
    const view = parity.workingTree(); view.delete(policyFile);
    assert.throws(() => parity.assertTree(view), /Reviewed packaging policy required/);
});
for (const file of ['unexpected-runtime.js', 'hubtel-diagnostics-backend/unexpected.js', 'arbitrary-extra-config.yaml', 'hubtel-diagnostics-backend/generated-artifact.json', 'hubtel-diagnostics-backend/.env', 'hubtel-diagnostics-backend/credentials.json']) test('manifest rejects unexpected file: ' + file, () => {
    const view = parity.workingTree(); view.set(file, Buffer.from('synthetic forbidden file'));
    assert.throws(() => parity.assertTree(view), /Exact union manifest/);
});
test('backend package has only expected source/metadata and no credentials', () => {
    const names = fs.readdirSync(source).filter(name => name !== 'node_modules').sort();
    assert.deepEqual(names, bundle);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).dependencies, dependencies);
    for (const file of bundle) assert.doesNotMatch(fs.readFileSync(path.join(source, file), 'utf8'), /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|(?:_authToken|client_secret|private_key)\s*[=:]\s*["']?[^\s"']{8}/);
});

function temporary(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thuraya-packaging-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('thuraya-packaging-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}
function install(root, extra = []) {
    return cp.spawnSync(node, [pnpm, 'install', '--prod', '--frozen-lockfile', '--store-dir', path.join(root, '.pnpm-store'), '--reporter', 'append-only', ...extra], { cwd: root, env, encoding: 'utf8', maxBuffer: 20e6, timeout: 240000 });
}
test('clean production install executes approved build, preserves package integrity, loads backend; removing approval fails closed', { timeout: 300000 }, async t => {
    const root = temporary(t);
    for (const file of bundle) fs.copyFileSync(path.join(source, file), path.join(root, file));
    const hashes = Object.fromEntries(bundle.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
    const result = install(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /protobufjs.*postinstall/);
    assert.match(result.stdout, /postinstall: Done/);
    assert.doesNotMatch(result.stdout + result.stderr, /-----BEGIN .*PRIVATE KEY-----|Authorization:|Bearer [A-Za-z0-9_.-]+/);
    for (const file of bundle) assert.equal(hash(fs.readFileSync(path.join(root, file))), hashes[file], 'Install preserves ' + file);
    assert.deepEqual(fs.readdirSync(root).filter(name => !['node_modules', '.pnpm-store'].includes(name)).sort(), bundle);
    const scripts = [];
    const store = path.join(root, 'node_modules/.pnpm');
    for (const entry of fs.readdirSync(store, { withFileTypes: true }).filter(item => item.isDirectory())) {
        const modules = path.join(store, entry.name, 'node_modules');
        if (!fs.existsSync(modules)) continue;
        for (const item of fs.readdirSync(modules, { withFileTypes: true }).filter(item => item.isDirectory())) {
            const names = item.name.startsWith('@') ? fs.readdirSync(path.join(modules, item.name)).map(name => item.name + '/' + name) : [item.name];
            for (const name of names) {
                const filename = path.join(modules, name, 'package.json');
                if (!fs.existsSync(filename)) continue;
                const pkg = JSON.parse(fs.readFileSync(filename));
                if (['preinstall', 'install', 'postinstall'].some(key => pkg.scripts?.[key])) scripts.push(pkg.name + '@' + pkg.version);
            }
        }
    }
    assert.deepEqual(scripts, ['protobufjs@7.6.6']);
    const loaded = cp.spawnSync(node, ['-e', "const a=require('node:assert/strict'); a.deepEqual(Object.keys(require('./index.js')),['hubtelNetworkDiagnostics']); console.log('BACKEND_LOAD_PASS');"], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(loaded.status, 0, loaded.stderr); assert.match(loaded.stdout, /BACKEND_LOAD_PASS/);
    await frameworkSmoke(t, root);
    const deniedRoot = path.join(root, 'missing-approval'); fs.mkdirSync(deniedRoot);
    for (const file of bundle) fs.copyFileSync(path.join(source, file), path.join(deniedRoot, file));
    fs.writeFileSync(path.join(deniedRoot, 'pnpm-workspace.yaml'), 'strictDepBuilds: true\n');
    const denied = install(deniedRoot, ['--offline', '--store-dir', path.join(root, '.pnpm-store')]);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stdout + denied.stderr, /ERR_PNPM_IGNORED_BUILDS/);
    assert.match(denied.stdout + denied.stderr, /protobufjs@7\.6\.6/);
    assert.doesNotMatch(denied.stdout + denied.stderr, /postinstall: Done/);
});
test('an unrelated local dependency postinstall remains unapproved and does not execute', { timeout: 60000 }, t => {
    const root = temporary(t), dependency = path.join(root, 'unreviewed'); fs.mkdirSync(dependency);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'packaging-negative', private: true, version: '1.0.0', dependencies: { 'unreviewed-build-fixture': 'file:./unreviewed' } }));
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), policy);
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'unreviewed-build-fixture', version: '1.0.0', scripts: { postinstall: "node -e \"throw new Error('UNAPPROVED_SCRIPT_EXECUTED')\"" } }));
    const result = install(root, ['--offline', '--no-frozen-lockfile']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /ERR_PNPM_IGNORED_BUILDS/);
    assert.match(result.stdout + result.stderr, /Ignored build scripts: unreviewed-build-fixture/);
    assert.doesNotMatch(result.stdout + result.stderr, /Error: UNAPPROVED_SCRIPT_EXECUTED/);
});

const yaml = require('yaml');
const manifest = () => JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
const lock = () => yaml.parse(fs.readFileSync(path.join(source, 'pnpm-lock.yaml'), 'utf8'));
const previousLock = () => yaml.parse(git(['show', BASE + ':hubtel-diagnostics-backend/pnpm-lock.yaml']).toString());
function closure(value) {
    const seen = new Set();
    function visit(key) {
        if (seen.has(key)) return;
        seen.add(key); assert.ok(value.snapshots[key], 'Resolved framework dependency: ' + key);
        for (const [name, version] of Object.entries({ ...value.snapshots[key].dependencies, ...value.snapshots[key].optionalDependencies })) visit(name + '@' + version);
    }
    visit('@google-cloud/functions-framework@3.5.1');
    return seen;
}
function assertLockScope(current) {
    const previous = previousLock(), reachable = closure(current);
    assert.equal(current.lockfileVersion, previous.lockfileVersion);
    assert.deepEqual(current.settings, previous.settings);
    assert.deepEqual(Object.keys(current).sort(), Object.keys(previous).sort());
    for (const section of ['packages', 'snapshots']) {
        for (const [key, value] of Object.entries(previous[section])) {
            const actual = current[section][key]; assert.ok(actual, 'Retain existing ' + section + ': ' + key);
            if (section === 'snapshots' && reachable.has(key) && value.optional === true && actual.optional === undefined) {
                const copy = { ...value }; delete copy.optional;
                assert.deepEqual(actual, copy, 'Only optional-to-required promotion in framework closure: ' + key);
            } else assert.deepEqual(actual, value, 'Unchanged existing lock resolution: ' + key);
        }
        for (const key of Object.keys(current[section]).filter(key => !previous[section][key])) {
            assert.ok([...reachable].some(item => item === key || (section === 'packages' && item.split('(')[0] === key)), 'New lock entry belongs to framework closure: ' + key);
        }
    }
}
test('Functions Framework is an exact direct production dependency', () => {
    assert.deepEqual(manifest().dependencies, dependencies);
    assert.match(manifest().dependencies['@google-cloud/functions-framework'], /^\d+\.\d+\.\d+$/);
});
test('manifest changes only the approved direct Functions Framework dependency', () => {
    const previous = JSON.parse(git(['show', BASE + ':hubtel-diagnostics-backend/package.json']));
    previous.dependencies['@google-cloud/functions-framework'] = '3.5.1';
    assert.deepEqual(manifest(), previous);
});
test('lockfile importer changes only the exact direct framework pin', () => {
    const previous = previousLock().importers;
    previous['.'].dependencies['@google-cloud/functions-framework'] = { specifier: '3.5.1', version: '3.5.1' };
    assert.deepEqual(lock().importers, previous);
});
test('lockfile preserves all previous resolutions and adds only the framework transitive closure', () => assertLockScope(lock()));
test('lockfile scope rejects an unrelated transitive resolution change', () => {
    const value = lock(); value.snapshots['@types/request@2.48.13'].dependencies['@types/node'] = '26.6.4';
    assert.throws(() => assertLockScope(value), /Unchanged existing lock resolution/);
});
test('framework lock integrity matches reviewed official release', () => {
    assert.equal(lock().packages['@google-cloud/functions-framework@3.5.1'].resolution.integrity, 'sha512-J01F8mCAb9SEsEGOJjKR/1UHmZTzBWIBNjAETtiPx7Xie3WgeWTvMnfrbsZbaBG0oePkepRxo28R8Fi9B2J++A==');
});
test('all resolved framework dependency engines support the certified Node 22 runtime', () => {
    const current = lock(), version = cp.execFileSync(node, ['--version'], { encoding: 'utf8' }).trim();
    for (const key of closure(current)) {
        const range = current.packages[key.split('(')[0]].engines?.node;
        if (range) assert.ok(require('semver').satisfies(version, range), key + ': ' + range);
    }
});
test('existing strict protobufjs-only build approval is byte-equivalent to parent', () => {
    assert.equal(normalize(fs.readFileSync(path.join(__dirname, policyFile))), normalize(git(['show', BASE + ':' + policyFile])));
});
test('framework runtime parity permits only exact authorized generic diagnostic source', () => {
    assert.equal(parity.assertTree(), true);
    for (const file of ['index.html', 'app.js', 'styles.css', 'firebase.hubtel-diagnostics.json'])
        assert.equal(normalize(fs.readFileSync(path.join(__dirname, file))), normalize(git(['show', '48a614bd370956420a145792f57da2f6a7d6bced:' + file])), file);
    assert.match(fs.readFileSync('hubtel-diagnostics.js', 'utf8'), /const desired = allowed \? 'flex' : 'none';/);
});
for (const file of ['hubtel-diagnostics-backend/package.json', 'hubtel-diagnostics-backend/pnpm-lock.yaml']) test('exact framework packaging fingerprint rejects unreviewed changes: ' + file, () => {
    const view = parity.workingTree(); view.set(file, Buffer.concat([view.get(file), Buffer.from('\n# unexpected\n')]));
    assert.throws(() => parity.assertTree(view), /Exact reviewed Functions Framework packaging/);
});

async function frameworkSmoke(t, root) {
    const net = require('node:net'), events = require('node:events');
    const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await events.once(listener, 'listening');
    const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
    const guard = path.join(root, 'test-no-outbound.cjs');
    // The real callable runs unchanged; packaging smoke cannot reach Firebase or Hubtel.
    fs.writeFileSync(guard, "const deny=()=>{console.error('UNEXPECTED_OUTBOUND');throw new Error('TEST_NETWORK_DENIED')};require('node:net').Socket.prototype.connect=deny;require('node:dns').lookup=deny;require('node:dns').promises.lookup=deny;require('node:tls').connect=deny;global.fetch=deny;\n");
    const cli = path.join(root, 'node_modules/@google-cloud/functions-framework/build/src/main.js');
    const child = cp.spawn(node, ['--require', guard, cli, '--target=hubtelNetworkDiagnostics', '--signature-type=http', '--port=' + port], {
        cwd: root, env: { PATH: env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), NODE_ENV: 'production', GCLOUD_PROJECT: 'thuraya-client-telling', GOOGLE_CLOUD_PROJECT: 'thuraya-client-telling', FIREBASE_CONFIG: JSON.stringify({ projectId: 'thuraya-client-telling' }) },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    const closed = events.once(child, 'close');
    try {
        const deadline = Date.now() + 20000;
        let ready = false;
        while (!ready && Date.now() < deadline && child.exitCode === null) {
            ready = await new Promise(resolve => {
                const socket = net.createConnection({ host: '127.0.0.1', port });
                const finish = value => { socket.destroy(); resolve(value); };
                socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(200, () => finish(false));
            });
            if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(ready, 'Framework HTTP listener must start: ' + output);
        const url = 'http://127.0.0.1:' + port + '/';
        await t.test('real framework HTTP callable denies unauthenticated diagnostics without external access', async () => {
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { command: 'run', projectId: 'thuraya-client-telling' } }), signal: AbortSignal.timeout(5000) });
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), { error: { message: 'Network diagnostics unavailable, target rejected or not authorized.', status: 'UNAUTHENTICATED' } });
        });
        await t.test('real framework callable rejects malformed protocol with safe JSON', async () => {
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: { message: 'Bad Request', status: 'INVALID_ARGUMENT' } });
        });
        await t.test('real framework permits production preflight without invoking business logic', async () => {
            const response = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://thuraya-app.netlify.app', 'Access-Control-Request-Method': 'POST' }, signal: AbortSignal.timeout(5000) });
            assert.equal(response.status, 204);
            assert.equal(response.headers.get('access-control-allow-origin'), 'https://thuraya-app.netlify.app');
        });
        assert.doesNotMatch(output, /UNEXPECTED_OUTBOUND|HUBTEL_DIAGNOSTIC_RUN|-----BEGIN .*PRIVATE KEY-----|Bearer [A-Za-z0-9_.-]+/);
    } finally {
        child.kill(); await closed;
        fs.unlinkSync(guard);
    }
}
