// extra_files: paths in the app directory (often git-ignored data such as model
// weights) that are put into the prepared working folder as is, outside the
// app's git repository. The launcher keeps untracked files in working across
// updates, so they stay in place after an update.
const fs = require('fs');
const path = require('path');
const { getProfileValue } = require('./package-zip');

// The profile's extra_files (inherited from the first profile) as a list of
// '/'-separated paths relative to appDir. Rejects paths outside appDir and
// paths that do not exist.
function getExtraFiles(profiles, profile, appDir = '.') {
    const value = getProfileValue(profiles, profile, 'extra_files');
    if (value === undefined || value === null || value === '') return [];
    const list = Array.isArray(value) ? value : [value];
    const root = path.resolve(appDir);
    return list.map(entry => {
        if (typeof entry !== 'string' || !entry.trim()) {
            throw new Error(`extra_files of profile ${profile.name} must be a list of paths, got ${JSON.stringify(entry)}.`);
        }
        const resolved = path.resolve(root, entry.trim());
        const relative = path.relative(root, resolved);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`extra_files entry '${entry}' must be inside the app directory.`);
        }
        if (!fs.existsSync(resolved)) {
            throw new Error(`extra_files entry '${entry}' does not exist in ${root}.`);
        }
        return relative.split(path.sep).join('/');
    });
}

// Hard-links (or copies, across volumes) one file over target.
function placeFile(source, target, stats) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { force: true });
    try {
        fs.linkSync(source, target);
    } catch {
        fs.copyFileSync(source, target);
    }
    stats.files++;
    stats.bytes += fs.statSync(source).size;
}

function placeTree(source, target, stats) {
    const entry = fs.statSync(source);
    if (entry.isDirectory()) {
        for (const child of fs.readdirSync(source)) {
            placeTree(path.join(source, child), path.join(target, child), stats);
        }
    } else if (entry.isFile()) {
        placeFile(source, target, stats);
    }
}

// Puts every entry of extraFiles from appDir into workingDir at the same
// relative path. Files are hard-linked when possible, so large models are
// not copied. Returns { files, bytes }.
function placeExtraFiles(appDir, workingDir, extraFiles) {
    const stats = { files: 0, bytes: 0 };
    for (const entry of extraFiles) {
        placeTree(path.join(appDir, entry), path.join(workingDir, entry), stats);
    }
    return stats;
}

module.exports = { getExtraFiles, placeExtraFiles };
