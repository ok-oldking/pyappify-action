// Release notes for the packaged app version, like the update notes of the
// PyAppify launcher and pyappify-python: the app's CHANGELOG.md entries when the
// version has one, otherwise the commit messages since the previous version.
const { compareKeys, versionKey } = require('./trim-repo');

const CHANGELOG_FILE = 'CHANGELOG.md';
const MAX_COMMIT_LINES = 50;

// `[v1.3.0]` and `1.3.0` both name the tag `v1.3.0`: compare without them.
function changelogVersion(version) {
    let text = String(version).trim().replace(/^\[+|\]+$/g, '').trim();
    if (/^[vV]\d/.test(text)) text = text.slice(1);
    return text;
}

// { version: [note, ...] } for each `## <version>` section, parsed as the launcher does:
// `- ` or `* ` starts a note, an indented line continues it, everything else is ignored.
function parseChangelog(text) {
    const notes = new Map();
    let current = null;
    for (const rawLine of (text || '').replace(/^﻿/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (rawLine.startsWith('## ')) {
            const words = line.slice(3).split(/\s+/).filter(Boolean);
            if (words.length) {
                const key = changelogVersion(words[0]);
                if (!notes.has(key)) notes.set(key, []);
                current = notes.get(key);
            } else {
                current = null;
            }
        } else if (rawLine.startsWith('# ')) {
            current = null;
        } else if (current === null || !line || line.startsWith('#')) {
            continue;
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
            current.push(line.slice(2).trim());
        } else if ((rawLine[0] === ' ' || rawLine[0] === '\t') && current.length) {
            current[current.length - 1] = `${current[current.length - 1]} ${line}`;
        }
    }
    return notes;
}

// The version tags after `previous` up to and including `version`, newest first.
// A release looks back to the previous release, a prerelease to the previous version tag.
function versionsSince(tags, version) {
    const target = versionKey(version);
    if (!target) return { versions: [version], previous: '' };
    const releaseOnly = target[3] === 3;
    const sorted = tags
        .map(tag => ({ tag, key: versionKey(tag) }))
        .filter(item => item.key && compareKeys(item.key, target) <= 0)
        .sort((a, b) => compareKeys(b.key, a.key));
    const versions = [version];
    let previous = '';
    for (const { tag, key } of sorted) {
        if (compareKeys(key, target) === 0) continue;
        if (releaseOnly && key[3] !== 3) {
            versions.push(tag);
            continue;
        }
        previous = tag;
        break;
    }
    return { versions, previous };
}

// The changelog notes of `versions` (newest first), repeated notes once; null when
// `version` itself has no entry.
function changelogNotes(changelogText, version, versions) {
    const changelog = parseChangelog(changelogText);
    if (!changelog.has(changelogVersion(version))) return null;
    const notes = [];
    for (const item of versions) {
        for (const note of changelog.get(changelogVersion(item)) || []) {
            if (note && !notes.includes(note)) notes.push(note);
        }
    }
    return notes;
}

// Unique non-empty commit subject lines, newest first.
function commitNotes(logOutput) {
    const notes = [];
    for (const line of logOutput.split(/\r?\n/)) {
        const text = line.trim();
        if (text && !notes.includes(text)) notes.push(text);
        if (notes.length >= MAX_COMMIT_LINES) break;
    }
    return notes;
}

function formatNotes(notes) {
    return notes.length ? notes.map(note => `- ${note}`).join('\n') + '\n' : '';
}

// Markdown release notes for `version` from the app repository at `repoDir`.
async function buildReleaseNotes(exec, repoDir, version) {
    const git = async (args) => {
        let stdout = '';
        const code = await exec('git', ['-C', repoDir, ...args], {
            silent: true,
            ignoreReturnCode: true,
            listeners: { stdout: data => (stdout += data.toString()) },
        });
        return code === 0 ? stdout : null;
    };

    const tags = ((await git(['tag', '--list'])) || '').split(/\r?\n/).map(tag => tag.trim()).filter(Boolean);
    const { versions, previous } = versionsSince(tags, version);

    const changelogText = await git(['show', `${version}:${CHANGELOG_FILE}`]);
    const fromChangelog = changelogText === null ? null : changelogNotes(changelogText, version, versions);
    if (fromChangelog) return { source: 'changelog', previous, notes: formatNotes(fromChangelog) };

    const range = previous ? `${previous}..${version}` : version;
    const log = await git(['log', '--no-merges', '--format=%s', range]);
    return { source: 'commits', previous, notes: formatNotes(commitNotes(log || '')) };
}

module.exports = {
    CHANGELOG_FILE,
    buildReleaseNotes,
    changelogNotes,
    changelogVersion,
    commitNotes,
    parseChangelog,
    versionsSince,
};
