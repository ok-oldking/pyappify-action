const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const exec = require('@actions/exec').exec;
const { buildLocalSetupConfig, createSourceSnapshot, hasGitSource, listSourceFiles, stripGitSource, usesLocalSource } = require('./local-source');

function tempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function write(root, file, text = 'x') {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

test('packages local files when use_git_url is off or no profile has a git_url', () => {
    const withUrl = { profiles: [{ name: 'a', git_url: 'https://example.com/a.git' }, { name: 'b' }] };
    assert.equal(usesLocalSource(withUrl, true), false);
    assert.equal(usesLocalSource(withUrl, false), true);
    assert.equal(usesLocalSource({ profiles: [{ name: 'a' }] }, true), true);
});

test('lists every file outside a git repository except build and env folders', async t => {
    const root = tempDir(t, 'pyappify-local-');
    for (const file of ['main.py', 'pkg/a.py', '.venv/x', 'pyappify_dist/y', 'pkg/__pycache__/a.pyc']) write(root, file);
    assert.deepEqual(await listSourceFiles(exec, root), ['main.py', 'pkg/a.py']);
});

test('lists tracked and untracked files of a git work tree, without ignored ones', async t => {
    const root = tempDir(t, 'pyappify-local-');
    git(root, 'init', '-q');
    write(root, '.gitignore', 'secret.txt\n');
    for (const file of ['main.py', 'new.py', 'secret.txt', 'gone.py']) write(root, file);
    git(root, 'add', '.gitignore', 'main.py', 'gone.py');
    fs.rmSync(path.join(root, 'gone.py'));
    assert.deepEqual(await listSourceFiles(exec, root), ['.gitignore', 'main.py', 'new.py']);
});

test('commits the files into a tagged one-commit bare repository that can be cloned', async t => {
    const root = tempDir(t, 'pyappify-local-');
    const source = path.join(root, 'app');
    write(source, 'main.py', 'print(1)\n');
    write(source, 'sub dir/data.txt', 'data');
    const snapshot = path.join(root, 'snapshot');
    const silent = (command, args, options = {}) => exec(command, args, { ...options, silent: true });
    const count = await createSourceSnapshot(silent, { sourceDir: source, snapshotDir: snapshot, appName: 'demo', version: 'v1.2.0' });
    assert.equal(count, 2);
    assert.equal(git(root, '--git-dir', snapshot, 'rev-list', '--count', 'v1.2.0').trim(), '1');
    assert.deepEqual(git(root, '--git-dir', snapshot, 'ls-tree', '-r', '--name-only', 'HEAD').trim().split('\n'),
        ['main.py', 'sub dir/data.txt']);
    const clone = path.join(root, 'clone');
    const config = buildLocalSetupConfig({ name: 'demo', keep_releases: 3, profiles: [{ name: 'a' }, { name: 'b' }] }, snapshot);
    assert.equal(config.keep_releases, undefined);
    assert.equal(config.profiles[1].git_url, config.profiles[0].git_url);
    git(root, '-c', 'core.autocrlf=false', 'clone', '-q', config.profiles[0].git_url, clone);
    assert.equal(fs.readFileSync(path.join(clone, 'main.py'), 'utf8'), 'print(1)\n');
    assert.ok(!fs.existsSync(`${snapshot}-files.txt`));
});

test('commits a replacement in place of a file, such as pyappify.yml without git_url', async t => {
    const root = tempDir(t, 'pyappify-local-');
    const source = path.join(root, 'app');
    write(source, 'pyappify.yml', 'original');
    const snapshot = path.join(root, 'snapshot');
    const silent = (command, args, options = {}) => exec(command, args, { ...options, silent: true });
    await createSourceSnapshot(silent, {
        sourceDir: source, snapshotDir: snapshot, appName: 'demo', replacements: { 'pyappify.yml': 'stripped' },
    });
    assert.equal(git(root, '--git-dir', snapshot, 'show', 'HEAD:pyappify.yml'), 'stripped');
    assert.equal(fs.readFileSync(path.join(source, 'pyappify.yml'), 'utf8'), 'original');
});

test('strips git_url and keep_releases for local packaging', () => {
    const config = { name: 'demo', keep_releases: 2, profiles: [{ name: 'a', git_url: 'https://x' }, { name: 'b' }] };
    assert.ok(hasGitSource(config));
    const stripped = stripGitSource(config);
    assert.deepEqual(stripped, { name: 'demo', profiles: [{ name: 'a' }, { name: 'b' }] });
    assert.ok(!hasGitSource(stripped));
});
