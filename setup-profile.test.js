const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getSetupVersion, setupProfile } = require('./setup-profile');

test('selects an explicit app version or the exact workflow tag, never a branch name', () => {
    const env = { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v3.7.14-beta.5' };
    assert.equal(getSetupVersion('', env), 'v3.7.14-beta.5');
    assert.equal(getSetupVersion('v3.7.13', env), 'v3.7.13');
    assert.equal(getSetupVersion('', { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'master' }), '');
    assert.equal(getSetupVersion('', {}), '');
});

function preparedApp(t, version, installed = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyappify-setup-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const configPath = path.join(root, 'data', 'apps', 'example', 'app.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ current_version: version, installed }));
    return root;
}

test('passes a prerelease to setup and accepts the matching installed payload', async t => {
    const version = 'v3.7.14-beta.5';
    const root = preparedApp(t, version);
    const calls = [];
    await setupProfile(async (...args) => calls.push(args), 'example.exe', 'China', 'example', root, version);
    assert.deepEqual(calls, [[path.resolve('example.exe'), ['-c', 'setup', '-p', 'China', '--setup-version', version], { cwd: root }]]);
});

test('rejects an older reused launcher that silently prepares latest stable', async t => {
    const root = preparedApp(t, 'v3.7.13');
    await assert.rejects(
        setupProfile(async () => {}, 'old.exe', 'Global', 'example', root, 'v3.7.14-beta.5'),
        /requested v3\.7\.14-beta\.5 but prepared v3\.7\.13/,
    );
});

test('does not accept an incomplete setup or suppress a missing-tag failure', async t => {
    const root = preparedApp(t, 'v3.7.14-beta.5', false);
    await assert.rejects(setupProfile(async () => {}, 'app.exe', 'China', 'example', root, 'v3.7.14-beta.5'));
    await assert.rejects(setupProfile(async () => { throw new Error('tag not found'); }, 'app.exe', 'China', 'example', root, 'v9.0.0'), /tag not found/);
});

test('keeps latest stable setup when no application tag is specified', async () => {
    const calls = [];
    await setupProfile(async (...args) => calls.push(args), 'app.exe', 'China', 'example', 'unused', '');
    assert.deepEqual(calls, [[path.resolve('app.exe'), ['-c', 'setup', '-p', 'China'], { cwd: 'unused' }]]);
});

test('the launcher cache is lent from the persistent folder and returned, even on failure', async () => {
    const { withPersistentCache } = require('./setup-profile');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcache-'));
    const persistent = path.join(root, 'p', 'cache');
    const dist = path.join(root, 'dist', 'app');
    fs.mkdirSync(path.join(persistent, 'pip'), { recursive: true });
    fs.writeFileSync(path.join(persistent, 'pip', 'torch.whl'), 'wheel');
    fs.mkdirSync(dist, { recursive: true });
    await withPersistentCache(persistent, dist, async () => {
        assert.strictEqual(fs.readFileSync(path.join(dist, 'cache', 'pip', 'torch.whl'), 'utf8'), 'wheel');
        assert.ok(!fs.existsSync(persistent));
        fs.writeFileSync(path.join(dist, 'cache', 'pip', 'numpy.whl'), 'new');
    });
    assert.deepStrictEqual(fs.readdirSync(path.join(persistent, 'pip')).sort(), ['numpy.whl', 'torch.whl']);
    assert.ok(!fs.existsSync(path.join(dist, 'cache')));
    await assert.rejects(withPersistentCache(persistent, dist, async () => { throw new Error('setup failed'); }), /setup failed/);
    assert.ok(fs.existsSync(path.join(persistent, 'pip', 'torch.whl')), 'kept after a failed setup');
    // First run: no persistent cache yet, the launcher's new one is kept.
    const fresh = path.join(root, 'p2', 'cache');
    await withPersistentCache(fresh, dist, async () => {
        fs.mkdirSync(path.join(dist, 'cache', 'pip'), { recursive: true });
        fs.writeFileSync(path.join(dist, 'cache', 'pip', 'a.whl'), 'a');
    });
    assert.ok(fs.existsSync(path.join(fresh, 'pip', 'a.whl')));
    fs.rmSync(root, { recursive: true, force: true });
});
