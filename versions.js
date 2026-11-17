// Version tags, parsed and ordered the same way as the PyAppify launcher
// (src-tauri/src/git.rs, src/versions.ts) and pyappify-python (pyappify/versions.py).
//
//   [prefix] [v] N[.N[.N[.N]]] [prerelease word [number]]
//
// - prefix: a name ending in "-", "_" or "/", such as release-, app-v or app/; ignored for ordering.
// - one to four number parts; missing parts count as 0 (v1.2 == v1.2.0). A single number
//   needs the v (v5, app-v5), so plain numbers, pr/7 and commit hashes are no versions.
// - the prerelease word may follow with or without "-", "." or "_", and so may its number:
//   1.2.3-beta.2, 1.2.3b2, 1.2.3rc1, 1.2.3-preview, 1.2.3.post1. Case does not matter.
//   dev < alpha (a) < beta (b) < any other word < rc (c, pre, preview) < release < post.
//   A missing prerelease number sorts before any number.
const VERSION_RE = /^([A-Za-z][A-Za-z0-9_.-]*?[-_/])??([vV])?(\d+(?:\.\d+){0,3})(?:[-._]?([A-Za-z]+)(?:[-._]?(\d+))?)?$/;
const OTHER_RANK = 3;
const RELEASE_RANK = 5;
const WORD_RANK = {
    dev: 0,
    alpha: 1, a: 1,
    beta: 2, b: 2,
    rc: 4, c: 4, pre: 4, preview: 4,
    post: 6,
};

function parseVersion(tag) {
    const match = VERSION_RE.exec(String(tag || ''));
    if (!match) return null;
    const [, prefix, v, numbers, rawWord, number] = match;
    const parts = numbers.split('.').map(Number);
    if (parts.length === 1 && !v) return null;
    return { prefix: prefix || '', v: v || '', parts, word: rawWord ? rawWord.toLowerCase() : '', number };
}

// [n1, n2, n3, n4, rank, number, word] for a version tag, else null.
function versionKey(tag) {
    const parsed = parseVersion(tag);
    if (!parsed) return null;
    const parts = [...parsed.parts];
    while (parts.length < 4) parts.push(0);
    const rank = parsed.word ? (WORD_RANK[parsed.word] ?? OTHER_RANK) : RELEASE_RANK;
    return [
        ...parts,
        rank,
        parsed.number === undefined ? -1 : Number(parsed.number),
        rank === OTHER_RANK ? parsed.word : '',
    ];
}

function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        if (typeof a[i] === 'string') return a[i] < b[i] ? -1 : 1;
        return a[i] - b[i];
    }
    return 0;
}

function isVersionTag(tag) {
    return versionKey(tag) !== null;
}

// A release, or a post release.
function isReleaseKey(key) {
    return key[4] >= RELEASE_RANK;
}

function isReleaseVersion(tag) {
    const key = versionKey(tag);
    return key !== null && isReleaseKey(key);
}

// The version tags in `tags`, newest first; equal versions by name.
function sortVersionTags(tags) {
    return tags
        .map(tag => ({ tag, key: versionKey(tag) }))
        .filter(item => item.key)
        .sort((a, b) => compareKeys(b.key, a.key) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
        .map(item => item.tag);
}

// The name a version has in a changelog heading: without brackets, name prefix or v,
// so `## 1.3.0`, `## [v1.3.0]` and the tag release-v1.3.0 all match.
function changelogVersion(version) {
    const text = String(version).trim().replace(/^\[+|\]+$/g, '').trim();
    const parsed = parseVersion(text);
    if (parsed) return text.slice(parsed.prefix.length + parsed.v.length);
    return /^[vV]\d/.test(text) ? text.slice(1) : text;
}

module.exports = {
    changelogVersion,
    compareKeys,
    isReleaseKey,
    isReleaseVersion,
    isVersionTag,
    sortVersionTags,
    versionKey,
};
