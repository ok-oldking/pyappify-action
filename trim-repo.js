// Trims the app repository bundled into installers and packages to the
// releases kept by pyappify.yml's `keep_releases`, like the PyAppify launcher
// does for its own clones: other tags and branches are deleted and history
// older than the oldest kept release is cut off (a shallow repository).
const fs = require('fs');
const path = require('path');

// Same tag format and ordering as the launcher (src-tauri/src/git.rs).
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:(?:-|\.)(alpha|beta|rc)(?:\.(\d+))?)?$/;
const PRERELEASE_RANK = { alpha: 0, beta: 1, rc: 2 };
const RELEASE_RANK = 3;
const KEEP_RELEASES_CONFIG_KEY = 'pyappify.keepreleases';

function versionKey(tag) {
    const match = VERSION_RE.exec(tag);
    if (!match) return null;
    return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] ? PRERELEASE_RANK[match[4]] : RELEASE_RANK,
        match[5] === undefined ? -1 : Number(match[5]),
    ];
}

function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

// The `keep` newest releases and the prereleases newer than the oldest of
// them, newest first. With fewer releases than `keep`, every version tag.
function selectKeptTags(tags, keep) {
    const versions = tags
        .map(tag => ({ tag, key: versionKey(tag) }))
        .filter(item => item.key)
        .sort((a, b) => compareKeys(b.key, a.key));
    const kept = [];
    let releases = 0;
    for (const { tag, key } of versions) {
        if (releases >= keep) break;
        if (key[3] === RELEASE_RANK) releases++;
        kept.push(tag);
    }
    return kept;
}

// pyappify.yml's top-level keep_releases as a positive integer, else null (keep all).
function getKeepReleases(config) {
    const value = config && config.keep_releases;
    if (value === undefined || value === null || value === '') return null;
    const keep = Number(value);
    if (!Number.isInteger(keep) || keep <= 0) {
        throw new Error(`keep_releases must be a positive integer, got '${value}'`);
    }
    return keep;
}

// Commits whose parents are cut off when keeping only `commits` and the history
// between them: the commits reachable from them but not from the parents of
// `oldest`, whose parents are not all in that set.
function findShallowRoots(revListParents) {
    const parentsOf = new Map();
    for (const line of revListParents.split('\n')) {
        const [commit, ...parents] = line.trim().split(/\s+/).filter(Boolean);
        if (commit) parentsOf.set(commit, parents);
    }
    const roots = [];
    for (const [commit, parents] of parentsOf) {
        if (parents.some(parent => !parentsOf.has(parent))) roots.push(commit);
    }
    return { commits: parentsOf, roots };
}

function dirSize(dir) {
    let size = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        size += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
    }
    return size;
}

async function trimRepo(exec, repoDir, keep, log = () => {}) {
    const git = async (args, options = {}) => {
        let stdout = '';
        await exec('git', ['-C', repoDir, ...args], {
            silent: true,
            ...options,
            listeners: { stdout: data => (stdout += data.toString()) },
        });
        return stdout;
    };

    const sizeBefore = dirSize(repoDir);
    await git(['config', KEEP_RELEASES_CONFIG_KEY, String(keep)]);

    // refname, object, and the commit an annotated tag points to.
    const refs = (await git(['for-each-ref', '--format=%(refname) %(objectname) %(*objectname)']))
        .split('\n')
        .map(line => line.trim().split(' '))
        .filter(parts => parts[0]);
    const tagCommits = new Map(
        refs
            .filter(([ref]) => ref.startsWith('refs/tags/'))
            .map(([ref, object, peeled]) => [ref.slice('refs/tags/'.length), peeled || object]),
    );
    const kept = selectKeptTags([...tagCommits.keys()], keep);
    if (kept.length === 0) {
        log(`No version tags in ${repoDir}; keeping the repository as is.`);
        return { trimmed: false };
    }

    const head = (await git(['rev-parse', 'HEAD'])).trim();
    const keptSet = new Set(kept);
    for (const [tag, commit] of tagCommits) {
        if (commit === head) keptSet.add(tag);
    }

    // Detach HEAD so deleting branches leaves it valid.
    await git(['update-ref', '--no-deref', 'HEAD', head]);
    const deletions = refs
        .map(([ref]) => ref)
        .filter(ref => !(ref.startsWith('refs/tags/') && keptSet.has(ref.slice('refs/tags/'.length))))
        .map(ref => `delete ${ref}\n`)
        .join('');
    if (deletions) await git(['update-ref', '--stdin'], { input: Buffer.from(deletions) });

    const oldest = tagCommits.get(kept[kept.length - 1]);
    const oldestParents = (await git(['rev-list', '--parents', '-n', '1', oldest])).trim().split(/\s+/).slice(1);
    const keptCommits = [...new Set([head, ...[...keptSet].map(tag => tagCommits.get(tag))])];
    if (oldestParents.length > 0) {
        const { commits, roots } = findShallowRoots(
            await git(['rev-list', '--parents', ...keptCommits, '--not', ...oldestParents]),
        );
        const shallowPath = path.join(repoDir, 'shallow');
        const existing = fs.existsSync(shallowPath)
            ? fs.readFileSync(shallowPath, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
            : [];
        const shallow = [...new Set([...roots, ...existing.filter(commit => commits.has(commit))])].sort();
        fs.writeFileSync(shallowPath, shallow.map(commit => `${commit}\n`).join(''));
    }

    await git(['reflog', 'expire', '--expire=now', '--all']);
    await git(['gc', '--prune=now', '--quiet']);
    const sizeAfter = dirSize(repoDir);
    log(
        `Kept ${keptSet.size} tag(s) (${keep} releases) in ${repoDir}: ` +
        `${(sizeBefore / 1048576).toFixed(1)} MB -> ${(sizeAfter / 1048576).toFixed(1)} MB`,
    );
    return { trimmed: true, kept: [...keptSet], sizeBefore, sizeAfter };
}

module.exports = { findShallowRoots, getKeepReleases, selectKeptTags, trimRepo };
