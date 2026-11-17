const assert = require('node:assert/strict');
const test = require('node:test');
const {
    changelogVersion,
    isReleaseVersion,
    isVersionTag,
    sortVersionTags,
} = require('./versions');

// Shared with the launcher (git.rs, versions.ts) and pyappify-python (TestVersion.py).
const VERSION_TAGS = [
    'v1.2.3', '1.2.3', 'V1.2.3', 'v1.2', '1.2', 'v1', 'v1.2.3.4', '2026.11.17',
    'v1.2.3-beta', 'v1.2.3.rc.2', 'v1.2.3-beta.2', '1.2.3b2', '1.2.3rc1', '1.2.3-RC1',
    '1.2.3-preview', '1.2.3.dev4', '1.2.3_alpha_1', '1.2.3.post1', '1.2.3-hotfix',
    'release-1.2.3', 'app-v1.2.3', 'app/v1.2.3-beta.1', 'my_app_1.0', 'app-v5',
];
const NOT_VERSION_TAGS = [
    '', 'latest', 'main', '1', '2024', '1234567', 'a1b2c3d', '1234e56', '7fa243f331892d478c4e450f6215495ca3b48258',
    'v1.2.3.4.5', '1.2.3-', '-1.2.3', 'v', 'release', 'release-', '1..2', 'build-5', 'pr/7', 'local/feature',
];

test('accepts the version tag formats and rejects names and commit hashes', () => {
    for (const tag of VERSION_TAGS) assert.ok(isVersionTag(tag), tag);
    for (const tag of NOT_VERSION_TAGS) assert.ok(!isVersionTag(tag), tag);
});

test('orders dev < alpha < beta < other words < rc < release < post, missing parts as 0', () => {
    const ascending = [
        'v1.0.0', 'v1.2', '1.2.0.1', 'v1.2.3.dev1', 'v1.2.3a1', 'v1.2.3-alpha.2', 'v1.2.3-beta',
        'v1.2.3b1', 'v1.2.3-beta.2', 'v1.2.3-hotfix', 'v1.2.3-preview', 'v1.2.3rc1',
        'v1.2.3', 'v1.2.3.post1', 'release-1.3', 'app-v2',
    ];
    const shuffled = [...ascending].reverse().concat(['latest', 'main']);
    // v1.2 and 1.2.0 would tie; only one of them is listed here.
    assert.deepEqual(sortVersionTags(shuffled), [...ascending].reverse());
    assert.deepEqual(sortVersionTags(['1.2.0', 'v1.2']), ['1.2.0', 'v1.2']);
});

test('releases include post releases, not prereleases or other words', () => {
    for (const tag of ['v1.2.3', '1.2', 'release-1.2.3', '1.2.3.post1', 'v1']) assert.ok(isReleaseVersion(tag), tag);
    for (const tag of ['v1.2.3-beta', '1.2.3rc1', '1.2.3-hotfix', '1.2.3.dev1', 'latest']) {
        assert.ok(!isReleaseVersion(tag), tag);
    }
});

test('changelog names drop brackets, the name prefix and the v', () => {
    assert.equal(changelogVersion('[v1.3.0]'), '1.3.0');
    assert.equal(changelogVersion('release-v1.3.0-beta.1'), '1.3.0-beta.1');
    assert.equal(changelogVersion('app/1.3'), '1.3');
    assert.equal(changelogVersion('Unreleased'), 'Unreleased');
});
