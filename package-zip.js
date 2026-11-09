const fs = require('fs');
const path = require('path');

const PYTHON_ENVS_TO_CLEAR = [
    'PYTHONHOME',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'PYTHONUSERBASE',
    'PYTHONEXECUTABLE',
    'VIRTUAL_ENV',
    'CONDA_PREFIX',
    'CONDA_DEFAULT_ENV',
];

function getProfileValue(profiles, profile, key) {
    if (profile[key] !== undefined && profile[key] !== null && profile[key] !== '') return profile[key];
    const first = profiles[0] || {};
    return first[key];
}

function getZipPackageFileName(appName, platform, profileName, version) {
    const base = `${appName}-${platform}-${profileName}`;
    return version ? `${base}-${version.replace(/^v/, '')}.zip` : `${base}.zip`;
}

// Mirrors pyappify's find_script_or_executable: working dir first, then python/Scripts (with extensions).
// Returns a path relative to the package root (the folder containing the .cmd), using backslashes.
function resolveMainScript(dataDir, appName, mainScript) {
    const appBase = path.join(dataDir, 'apps', appName);
    const candidates = [
        ['working', mainScript],
        ['python', 'Scripts', mainScript],
        ...['.exe', '.bat', '.cmd', '.ps1', ''].map(ext => ['python', 'Scripts', `${mainScript}${ext}`]),
    ];
    for (const parts of candidates) {
        if (fs.existsSync(path.join(appBase, ...parts)) && fs.statSync(path.join(appBase, ...parts)).isFile()) {
            return ['data', 'apps', appName, ...parts].join('\\').replace(/\//g, '\\');
        }
    }
    throw new Error(`Main script '${mainScript}' not found in ${path.join(appBase, 'working')} or ${path.join(appBase, 'python', 'Scripts')}`);
}

function buildRunCmd({ appName, profileName, scriptRelPath, pythonPath, appVersion }) {
    const appBase = `%~dp0data\\apps\\${appName}`;
    const isPy = scriptRelPath.toLowerCase().endsWith('.py');
    const target = `"%~dp0${scriptRelPath}"`;
    const command = isPy ? `"${appBase}\\python\\python.exe" ${target} %*` : `${target} %*`;
    const lines = [
        '@echo off',
        'chcp 65001 >nul',
        'setlocal',
        ...PYTHON_ENVS_TO_CLEAR.map(name => `set "${name}="`),
    ];
    if (pythonPath) lines.push(`set "PYTHONPATH=${pythonPath}"`);
    if (appVersion) {
        lines.push(`set "PYAPPIFY_APP_VERSION=${appVersion}"`);
        lines.push(`set "PYAPPIFY_APP_STARTING_VERSION=${appVersion}"`);
    }
    lines.push(
        `set "PYAPPIFY_APP_PROFILE=${profileName}"`,
        `set "PYAPPIFY_APP_JSON_PATH=${appBase}\\app.json"`,
        'set "PYAPPIFY_UPGRADEABLE=0"',
        'set "PYTHONIOENCODING=utf-8"',
        'set "PYTHONUNBUFFERED=1"',
        'set "PYTHONNOUSERSITE=1"',
        `cd /d "${appBase}\\working"`,
        command,
        'exit /b %ERRORLEVEL%',
    );
    return lines.join('\r\n') + '\r\n';
}

function readPreparedAppVersion(dataDir, appName) {
    const appJsonPath = path.join(dataDir, 'apps', appName, 'app.json');
    if (!fs.existsSync(appJsonPath)) return '';
    try {
        return JSON.parse(fs.readFileSync(appJsonPath, 'utf8')).current_version || '';
    } catch {
        return '';
    }
}

function createZipPackage(archiver, dataDir, cmdContent, zipFilePath, appName) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(dataDir, `${appName}/data`);
        archive.append(cmdContent, { name: `${appName}/${appName}.cmd` });
        archive.finalize();
    });
}

module.exports = {
    buildRunCmd,
    createZipPackage,
    getProfileValue,
    getZipPackageFileName,
    readPreparedAppVersion,
    resolveMainScript,
};
