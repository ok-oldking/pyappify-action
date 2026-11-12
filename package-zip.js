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

// pyappify.yml spells the profile's PYTHONPATH key in upper case, as the launcher reads it.
function getProfilePythonPath(profiles, profile) {
    return getProfileValue(profiles, profile, 'PYTHONPATH') || '';
}

const PACKAGE_FORMATS = ['7z', 'zip'];

function getPackageFormat(input) {
    const format = (input || '7z').trim().toLowerCase();
    if (!PACKAGE_FORMATS.includes(format)) {
        throw new Error(`package_zip_format must be one of ${PACKAGE_FORMATS.join(', ')}, got '${input}'`);
    }
    return format;
}

function getZipPackageFileName(appName, platform, profileName, version, format = 'zip') {
    const base = `${appName}-${platform}-${profileName}`;
    return version ? `${base}-${version.replace(/^v/, '')}.${format}` : `${base}.${format}`;
}

// Removes every __pycache__ directory under dir; Python regenerates them on first import.
function removePycache(dir) {
    let removed = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === '__pycache__') {
            fs.rmSync(full, { recursive: true, force: true });
            removed++;
        } else {
            removed += removePycache(full);
        }
    }
    return removed;
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

function buildRunCmd({ appName, profileName, scriptRelPath, pythonPath, appVersion, admin = false, usePythonw = false }) {
    const appBase = `%~dp0data\\apps\\${appName}`;
    const isPy = scriptRelPath.toLowerCase().endsWith('.py');
    const target = `"%~dp0${scriptRelPath}"`;
    const pythonExe = `"${appBase}\\python\\${usePythonw ? 'pythonw.exe' : 'python.exe'}"`;
    const invocation = isPy ? `${pythonExe} ${target} %*` : `${target} %*`;
    // pythonw: detach with start so the console closes immediately; otherwise run in this console.
    const command = usePythonw ? `start "" ${invocation}` : invocation;
    const lines = [
        '@echo off',
        'chcp 65001 >nul',
        'setlocal',
    ];
    if (admin) {
        // Relaunch elevated via UAC when not already admin. Paths/args go through env vars to avoid quoting issues.
        const windowStyle = usePythonw ? ' -WindowStyle Hidden' : '';
        lines.push(
            'fltmc >nul 2>&1',
            'if errorlevel 1 (',
            '    set "PYAPPIFY_SELF=%~f0"',
            '    set "PYAPPIFY_ARGS=%*"',
            `    powershell -NoProfile -WindowStyle Hidden -Command "$a=$env:PYAPPIFY_ARGS; if ($a) { Start-Process -FilePath $env:PYAPPIFY_SELF -Verb RunAs${windowStyle} -ArgumentList $a } else { Start-Process -FilePath $env:PYAPPIFY_SELF -Verb RunAs${windowStyle} }"`,
            '    exit /b',
            ')',
        );
    }
    lines.push(...PYTHON_ENVS_TO_CLEAR.map(name => `set "${name}="`));
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
        usePythonw ? 'exit /b 0' : 'exit /b %ERRORLEVEL%',
    );
    return lines.join('\r\n') + '\r\n';
}

function getUpdaterCmdName(appName) {
    return `${appName}-updater.cmd`;
}

// The updater window ships with pyappify 1.0.20+ (pyappify/updater_ui.py) and needs Dulwich to read the repo.
// Returns '' when the bundled Python can run it, otherwise the reason it cannot.
function checkUpdaterSupport(dataDir, appName) {
    const sitePackages = path.join(dataDir, 'apps', appName, 'python', 'Lib', 'site-packages');
    if (!fs.existsSync(path.join(sitePackages, 'pyappify', 'updater_ui.py'))) {
        return 'the bundled Python has no pyappify package with the updater window (pyappify 1.0.20 or newer)';
    }
    if (!fs.existsSync(path.join(sitePackages, 'dulwich'))) {
        return 'the bundled Python has no Dulwich; depend on "pyappify[standalone]" (Python 3.10+)';
    }
    if (!fs.existsSync(path.join(dataDir, 'apps', appName, 'repo'))) {
        return `no app repository at ${path.join(dataDir, 'apps', appName, 'repo')}`;
    }
    return '';
}

// Python run by the updater cmd. It must not contain ", %, ^, &, |, < or > so it survives cmd.exe quoting.
// It writes the session the window reads (and deletes): the app's repo and profile, and how to restart
// the app afterwards (the run cmd). The window detects the current version from the repo itself.
const UPDATER_SESSION_SCRIPT = [
    'import json,os,sys,tempfile',
    'from pyappify import updater_ui',
    'e=os.environ',
    'r=e[\'PYAPPIFY_PACKAGE_ROOT\']',
    'n=e[\'PYAPPIFY_APP_NAME\']',
    'f,p=tempfile.mkstemp(prefix=\'pyappify-updater-\',suffix=\'.json\')',
    'os.write(f,json.dumps(dict(repo_path=os.path.join(r,\'data\',\'apps\',n,\'repo\'),app_name=n,app_profile=e[\'PYAPPIFY_APP_PROFILE\'],relaunch=dict(argv=[e.get(\'ComSpec\',\'cmd.exe\'),\'/c\',os.path.join(r,e[\'PYAPPIFY_RUN_CMD\'])],cwd=r,pythonpath=None))).encode(\'utf-8\'))',
    'os.close(f)',
    'sys.exit(updater_ui.main([\'--session\',p]))',
].join(';');

function buildUpdaterCmd({ appName, profileName, runCmdName }) {
    const appBase = `%~dp0data\\apps\\${appName}`;
    const lines = [
        '@echo off',
        'chcp 65001 >nul',
        'setlocal',
        ...PYTHON_ENVS_TO_CLEAR.map(name => `set "${name}="`),
        'set "PYAPPIFY_APP_VERSION="',
        'set "PYAPPIFY_APP_STARTING_VERSION="',
        'set "PYAPPIFY_VERSION="',
        'set "PYAPPIFY_EXECUTABLE="',
        'set "PYAPPIFY_PACKAGE_ROOT=%~dp0"',
        `set "PYAPPIFY_APP_NAME=${appName}"`,
        `set "PYAPPIFY_APP_PROFILE=${profileName}"`,
        `set "PYAPPIFY_RUN_CMD=${runCmdName}"`,
        'set "PYTHONIOENCODING=utf-8"',
        'set "PYTHONNOUSERSITE=1"',
        // Never start inside repo or working: the updater may move or rewrite them.
        `cd /d "${appBase}"`,
        `start "" "${appBase}\\python\\pythonw.exe" -c "${UPDATER_SESSION_SCRIPT}"`,
        'exit /b 0',
    ];
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

// cmdFiles: [{ name, content }] written next to data in the package root.
function createZipPackage(archiver, dataDir, cmdFiles, zipFilePath, appName) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(dataDir, `${appName}/data`);
        for (const { name, content } of cmdFiles) archive.append(content, { name: `${appName}/${name}` });
        archive.finalize();
    });
}

// Packs <parentDir>/<appName>/data and the cmdFiles into a solid LZMA2 7z,
// keeping <appName> as the root folder (7z stores the relative paths as given).
async function create7zPackage(exec, sevenZip, parentDir, appName, cmdFiles, archivePath) {
    const cmdPaths = cmdFiles.map(({ name, content }) => {
        const cmdPath = path.join(parentDir, appName, name);
        fs.writeFileSync(cmdPath, content);
        return cmdPath;
    });
    try {
        await exec(sevenZip, [
            'a', '-t7z', '-mx=7', '-ms=on', '-mmt=on', '-bsp0', '-bso0',
            path.resolve(archivePath),
            path.join(appName, 'data'),
            ...cmdFiles.map(({ name }) => path.join(appName, name)),
        ], { cwd: parentDir });
    } finally {
        for (const cmdPath of cmdPaths) fs.rmSync(cmdPath, { force: true });
    }
}

module.exports = {
    PACKAGE_FORMATS,
    buildRunCmd,
    buildUpdaterCmd,
    checkUpdaterSupport,
    create7zPackage,
    createZipPackage,
    getPackageFormat,
    getProfilePythonPath,
    getProfileValue,
    getUpdaterCmdName,
    getZipPackageFileName,
    removePycache,
    readPreparedAppVersion,
    resolveMainScript,
};
