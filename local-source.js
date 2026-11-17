// Packaging without a git repository: the launcher always sets an app up by
// cloning a repo, so the action snapshots the app's local files into a
// one-commit repository and points the setup at it instead of git_url.
const fs = require('fs');
const path = require('path');

// Top-level names never copied into the snapshot.
const SKIPPED_NAMES = new Set([
    '.git', '.venv', 'venv', 'node_modules', '__pycache__',
    'pyappify_dist', 'pyappify_release_notes.md',
]);
const SNAPSHOT_GIT_CONFIG = [
    '-c', 'user.name=pyappify', '-c', 'user.email=pyappify@localhost',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=',
];

// True when the app is packaged from its local files: use_git_url is false,
// or no profile in pyappify.yml sets a git_url.
function usesLocalSource(config, useGitUrl) {
    return !useGitUrl || !(config.profiles || []).some(profile => profile && profile.git_url);
}

function isSkipped(relativePath, excluded = []) {
    return relativePath.split('/').some(part => SKIPPED_NAMES.has(part)) ||
        excluded.some(dir => relativePath === dir || relativePath.startsWith(`${dir}/`));
}

// The folders of dirs inside sourceDir, '/'-separated, such as a local build's p/.
function excludedDirs(sourceDir, dirs) {
    return dirs.map(dir => path.relative(path.resolve(sourceDir), path.resolve(dir)).split(path.sep).join('/'))
        .filter(dir => dir && !dir.startsWith('..') && !path.isAbsolute(dir));
}

function walkFiles(root, excluded, relative = '', files = []) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (isSkipped(child, excluded)) continue;
        if (entry.isDirectory()) walkFiles(root, excluded, child, files);
        else if (entry.isFile()) files.push(child);
    }
    return files;
}

// The files to package, '/'-separated and relative to sourceDir: in a git work
// tree its tracked and untracked files minus ignored ones, otherwise every file.
async function listSourceFiles(exec, sourceDir, excludeDirs = []) {
    const excluded = excludedDirs(sourceDir, excludeDirs);
    let stdout = '';
    const code = await exec('git', ['-C', sourceDir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        ignoreReturnCode: true,
        silent: true,
        listeners: { stdout: data => (stdout += data.toString()) },
    });
    if (code !== 0) return walkFiles(sourceDir, excluded).sort();
    const files = stdout.split('\0').filter(Boolean)
        .filter(file => !isSkipped(file, excluded))
        // Skips deleted files, submodules and symlinks.
        .filter(file => {
            try {
                return fs.lstatSync(path.join(sourceDir, file)).isFile();
            } catch {
                return false;
            }
        });
    return [...new Set(files)].sort();
}

// pyappify.yml as packaged from local files: no git_url, so the launcher uses the
// bundled repository without fetching, and no keep_releases.
function stripGitSource(config) {
    const { keep_releases: _keepReleases, ...rest } = config;
    return {
        ...rest,
        profiles: (config.profiles || []).map(({ git_url: _gitUrl, ...profile }) => profile),
    };
}

function hasGitSource(config) {
    return 'keep_releases' in config || (config.profiles || []).some(profile => profile && 'git_url' in profile);
}

// Commits the files of sourceDir into a new bare repository at snapshotDir,
// tagged with version when given. replacements maps a file to the content
// committed in its place. Returns the number of files committed.
async function createSourceSnapshot(exec, { sourceDir, snapshotDir, appName, version, replacements = {}, excludeDirs = [] }) {
    const files = await listSourceFiles(exec, sourceDir, [...excludeDirs, snapshotDir]);
    if (!files.length) throw new Error(`No files to package in ${path.resolve(sourceDir)}.`);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(snapshotDir), { recursive: true });
    const pathspecFile = `${snapshotDir}-files.txt`;
    fs.writeFileSync(pathspecFile, files.join('\0'));
    const git = (args, options = {}) => exec('git', [
        ...SNAPSHOT_GIT_CONFIG,
        `--git-dir=${path.resolve(snapshotDir)}`, `--work-tree=${path.resolve(sourceDir)}`,
        ...args,
    ], { silent: true, ...options });
    try {
        await exec('git', ['init', '-q', '--bare', '--initial-branch=main', snapshotDir], { silent: true });
        await git(['add', '-f', `--pathspec-from-file=${path.resolve(pathspecFile)}`, '--pathspec-file-nul']);
        for (const [file, content] of Object.entries(replacements)) {
            if (!files.includes(file)) continue;
            fs.writeFileSync(pathspecFile, content);
            let blob = '';
            await git(['hash-object', '-w', path.resolve(pathspecFile)], {
                listeners: { stdout: data => (blob += data.toString()) },
            });
            await git(['update-index', '--cacheinfo', `100644,${blob.trim()},${file}`]);
        }
        await git(['commit', '-q', '--no-verify', '-m', version ? `${appName} ${version}` : appName]);
        if (version) await git(['tag', version]);
    } finally {
        fs.rmSync(pathspecFile, { force: true });
    }
    return files.length;
}

// pyappify.yml for the headless setup: every profile clones the snapshot. The
// snapshot has one commit, so keep_releases (a shallow clone) does not apply.
function buildLocalSetupConfig(config, snapshotDir) {
    const url = path.resolve(snapshotDir).replace(/\\/g, '/');
    const stripped = stripGitSource(config);
    return { ...stripped, profiles: stripped.profiles.map(profile => ({ ...profile, git_url: url })) };
}

module.exports = {
    buildLocalSetupConfig,
    createSourceSnapshot,
    hasGitSource,
    listSourceFiles,
    stripGitSource,
    usesLocalSource,
};
