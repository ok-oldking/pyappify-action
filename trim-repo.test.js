const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getKeepReleases, selectKeptTags, trimRepo } = require('./trim-repo');

test('selectKeptTags keeps the newest releases and newer prereleases', () => {
    const tags = ['v1.0.0', 'v1.1.0-beta.1', 'v1.1.0', 'v1.2.0-beta.1', 'v1.2.0', 'v1.3.0-beta.2', 'latest'];
    assert.deepStrictEqual(selectKeptTags(tags, 2), ['v1.3.0-beta.2', 'v1.2.0', 'v1.2.0-beta.1', 'v1.1.0']);
    assert.deepStrictEqual(selectKeptTags(tags, 1), ['v1.3.0-beta.2', 'v1.2.0']);
    assert.strictEqual(selectKeptTags(tags, 10).length, 6);
});

test('getKeepReleases is optional and must be a positive integer', () => {
    assert.strictEqual(getKeepReleases({}), null);
    assert.strictEqual(getKeepReleases({ keep_releases: 30 }), 30);
    assert.throws(() => getKeepReleases({ keep_releases: 0 }));
    assert.throws(() => getKeepReleases({ keep_releases: 'many' }));
});

// Runs git like @actions/exec: captures stdout through listeners, takes input.
async function exec(command, args, options = {}) {
    const result = spawnSync(command, args, { input: options.input, encoding: 'buffer' });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
    }
    if (options.listeners && options.listeners.stdout) options.listeners.stdout(result.stdout);
    return result.status;
}

function git(cwd, ...args) {
    const result = spawnSync('git', [
        '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args,
    ], { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
}

test('trimRepo keeps only the kept releases and the history between them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-repo-'));
    try {
        const source = path.join(root, 'source');
        fs.mkdirSync(source);
        git(source, 'init', '-q', '-b', 'main');
        const commit = (name) => {
            fs.writeFileSync(path.join(source, 'app.txt'), `${name}\n`);
            git(source, 'add', '-A');
            git(source, 'commit', '-q', '-m', name);
        };
        for (const tag of ['v1.0.0', 'v1.1.0', 'v1.2.0-beta.1', 'v1.2.0', 'v1.3.0-beta.1']) {
            commit(`work before ${tag}`);
            commit(tag);
            git(source, 'tag', '-a', tag, '-m', tag);
        }
        // A side branch forked before the oldest kept release, merged later.
        git(source, 'checkout', '-q', '-b', 'side', 'v1.0.0');
        fs.writeFileSync(path.join(source, 'side.txt'), 'side\n');
        git(source, 'add', '-A');
        git(source, 'commit', '-q', '-m', 'side work');
        git(source, 'checkout', '-q', 'main');
        git(source, 'merge', '-q', '--no-ff', 'side', '-m', 'merge side');
        git(source, 'tag', 'v1.3.0');

        const repo = path.join(root, 'repo');
        git(root, 'clone', '-q', '--bare', source, repo);
        git(repo, 'update-ref', '--no-deref', 'HEAD', git(repo, 'rev-parse', 'v1.2.0^{commit}'));

        const result = await trimRepo(exec, repo, 2);

        assert.strictEqual(result.trimmed, true);
        assert.deepStrictEqual(
            git(repo, 'tag', '--list').split('\n').sort(),
            ['v1.2.0', 'v1.3.0', 'v1.3.0-beta.1'],
        );
        assert.strictEqual(git(repo, 'for-each-ref', 'refs/heads', 'refs/remotes'), '');
        assert.strictEqual(git(repo, 'config', 'pyappify.keepreleases'), '2');
        assert.strictEqual(git(repo, 'rev-parse', 'HEAD'), git(repo, 'rev-parse', 'v1.2.0^{commit}'));
        assert.strictEqual(git(repo, 'rev-parse', '--is-shallow-repository'), 'true');
        // History from v1.3.0 back to v1.2.0 (including the side branch) is complete.
        const log = git(repo, 'log', '--format=%s', 'v1.2.0..v1.3.0').split('\n');
        assert.deepStrictEqual(log.sort(), [
            'merge side', 'side work', 'v1.3.0-beta.1', 'work before v1.3.0-beta.1',
        ].sort());
        assert.ok(!git(repo, 'log', '--format=%s', 'v1.3.0').includes('v1.0.0\n'));
        assert.strictEqual(spawnSync('git', ['-C', repo, 'fsck', '--connectivity-only']).status, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
