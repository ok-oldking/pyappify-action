const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    buildReleaseNotes,
    changelogNotes,
    commitNotes,
    parseChangelog,
    versionsSince,
} = require('./release-notes');

const CHANGELOG = `﻿# Changelog

## v1.3.0 (2026-11-12)
### Added
- Added a dark theme
- Fixed a crash when a folder name
  contained emoji

## [1.3.0-beta.1]
* Faster duplicate detection
- Added a dark theme

## 1.2.0
- First public release
`;

test('parseChangelog reads versions and notes like the launcher', () => {
    const notes = parseChangelog(CHANGELOG);
    assert.deepEqual([...notes.keys()], ['1.3.0', '1.3.0-beta.1', '1.2.0']);
    assert.deepEqual(notes.get('1.3.0'), [
        'Added a dark theme',
        'Fixed a crash when a folder name contained emoji',
    ]);
});

test('versionsSince looks back to the previous release, or any version for a prerelease', () => {
    const tags = ['v1.2.0', 'v1.3.0-beta.1', 'v1.3.0', 'v1.4.0', 'not-a-version'];
    assert.deepEqual(versionsSince(tags, 'v1.3.0'), { versions: ['v1.3.0', 'v1.3.0-beta.1'], previous: 'v1.2.0' });
    assert.deepEqual(versionsSince(tags, 'v1.3.0-beta.1'), { versions: ['v1.3.0-beta.1'], previous: 'v1.2.0' });
    assert.deepEqual(versionsSince(tags, 'v1.2.0'), { versions: ['v1.2.0'], previous: '' });
});

test('changelogNotes merges the versions brought in, and is null without an entry', () => {
    assert.deepEqual(changelogNotes(CHANGELOG, 'v1.3.0', ['v1.3.0', 'v1.3.0-beta.1']), [
        'Added a dark theme',
        'Fixed a crash when a folder name contained emoji',
        'Faster duplicate detection',
    ]);
    assert.equal(changelogNotes(CHANGELOG, 'v1.4.0', ['v1.4.0']), null);
});

test('commitNotes keeps unique non-empty lines', () => {
    assert.deepEqual(commitNotes('Fix a\n\nFix a\r\nAdd b\n'), ['Fix a', 'Add b']);
});

function git(cwd, ...args) {
    const result = spawnSync('git', [
        '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args,
    ], { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
}

async function exec(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'buffer' });
    if (result.status !== 0 && !options.ignoreReturnCode) throw new Error(`${command} failed`);
    if (options.listeners && options.listeners.stdout) options.listeners.stdout(result.stdout);
    return result.status;
}

test('buildReleaseNotes uses the changelog entry, else the commits since the previous version', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
    try {
        git(repo, 'init', '-q');
        const commit = (message) => {
            fs.writeFileSync(path.join(repo, 'file.txt'), message);
            git(repo, 'add', '.');
            git(repo, 'commit', '-q', '-m', message);
        };
        commit('First release');
        git(repo, 'tag', 'v1.2.0');
        commit('Add dark theme');
        commit('Fix emoji crash\n\nLonger body that is not a subject.');
        git(repo, 'tag', 'v1.3.0');
        fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '## v1.4.0\n- Curated note\n');
        commit('Write the changelog');
        git(repo, 'tag', 'v1.4.0');

        assert.deepEqual(await buildReleaseNotes(exec, repo, 'v1.3.0'), {
            source: 'commits',
            previous: 'v1.2.0',
            notes: '- Fix emoji crash\n- Add dark theme\n',
        });
        assert.deepEqual(await buildReleaseNotes(exec, repo, 'v1.4.0'), {
            source: 'changelog',
            previous: 'v1.3.0',
            notes: '- Curated note\n',
        });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});
