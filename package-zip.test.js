const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    buildRunCmd,
    create7zPackage,
    getPackageFormat,
    getProfilePythonPath,
    getProfileValue,
    getZipPackageFileName,
    removePycache,
    resolveMainScript,
} = require('./package-zip');

test('zip package name includes profile, optional version and format', () => {
    assert.strictEqual(getZipPackageFileName('app', 'win32', 'release'), 'app-win32-release.zip');
    assert.strictEqual(getZipPackageFileName('app', 'win32', 'release', 'v1.2.0'), 'app-win32-release-1.2.0.zip');
    assert.strictEqual(getZipPackageFileName('app', 'win32', 'release', 'v1.2.0', '7z'), 'app-win32-release-1.2.0.7z');
});

test('package format defaults to 7z and rejects unknown values', () => {
    assert.strictEqual(getPackageFormat(''), '7z');
    assert.strictEqual(getPackageFormat(' ZIP '), 'zip');
    assert.throws(() => getPackageFormat('rar'));
});

test('removePycache removes nested __pycache__ only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
    fs.mkdirSync(path.join(root, 'a', '__pycache__'), { recursive: true });
    fs.mkdirSync(path.join(root, 'a', 'b', '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', '__pycache__', 'x.cpython-312.pyc'), '');
    fs.writeFileSync(path.join(root, 'a', 'x.py'), '');
    fs.writeFileSync(path.join(root, 'a', 'sourceless.pyc'), '');
    assert.strictEqual(removePycache(root), 2);
    assert.ok(!fs.existsSync(path.join(root, 'a', '__pycache__')));
    assert.ok(!fs.existsSync(path.join(root, 'a', 'b', '__pycache__')));
    assert.ok(fs.existsSync(path.join(root, 'a', 'x.py')));
    assert.ok(fs.existsSync(path.join(root, 'a', 'sourceless.pyc')));
    fs.rmSync(root, { recursive: true, force: true });
});

const sevenZip = ['C:\\Program Files\\7-Zip\\7z.exe'].find(p => fs.existsSync(p));
test('7z package keeps app name as root and excludes the exe', { skip: !sevenZip && '7-Zip not installed' }, async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-'));
    fs.mkdirSync(path.join(dist, 'app', 'data', 'apps', 'app', 'working'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'app', 'data', 'apps', 'app', 'working', 'main.py'), 'print(1)');
    fs.writeFileSync(path.join(dist, 'app', 'app.exe'), 'exe');
    const out = path.join(dist, 'app-win32-release.7z');
    const exec = async (cmd, args, opts) => execFileSync(cmd, args, { cwd: opts.cwd });
    await create7zPackage(exec, sevenZip, dist, 'app', '@echo off\r\n', out);
    const listing = execFileSync(sevenZip, ['l', '-slt', out]).toString();
    const names = [...listing.matchAll(/^Path = (.+)$/gm)].map(m => m[1].trim()).slice(1).sort();
    assert.deepStrictEqual(names, [
        'app', 'app\\app.cmd', 'app\\data', 'app\\data\\apps', 'app\\data\\apps\\app',
        'app\\data\\apps\\app\\working', 'app\\data\\apps\\app\\working\\main.py',
    ].filter(n => n !== 'app').sort());
    assert.ok(!fs.existsSync(path.join(dist, 'app', 'app.cmd')), 'temporary cmd is removed');
    fs.rmSync(dist, { recursive: true, force: true });
});

test('profile values fall back to the first profile', () => {
    const profiles = [{ name: 'a', main_script: 'main.py' }, { name: 'b' }];
    assert.strictEqual(getProfileValue(profiles, profiles[1], 'main_script'), 'main.py');
});

test('PYTHONPATH is read from the upper-case key and inherited', () => {
    const profiles = [{ name: 'a', PYTHONPATH: 'src' }, { name: 'b' }, { name: 'c', PYTHONPATH: 'lib' }];
    assert.strictEqual(getProfilePythonPath(profiles, profiles[0]), 'src');
    assert.strictEqual(getProfilePythonPath(profiles, profiles[1]), 'src');
    assert.strictEqual(getProfilePythonPath(profiles, profiles[2]), 'lib');
    assert.strictEqual(getProfilePythonPath([{ name: 'a', python_path: 'src' }], { name: 'a', python_path: 'src' }), '');
});

test('resolves scripts in working dir before python Scripts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pz-'));
    const base = path.join(root, 'apps', 'app');
    fs.mkdirSync(path.join(base, 'working'), { recursive: true });
    fs.mkdirSync(path.join(base, 'python', 'Scripts'), { recursive: true });
    fs.writeFileSync(path.join(base, 'working', 'main.py'), '');
    fs.writeFileSync(path.join(base, 'python', 'Scripts', 'tool.exe'), '');
    assert.strictEqual(resolveMainScript(root, 'app', 'main.py'), 'data\\apps\\app\\working\\main.py');
    assert.strictEqual(resolveMainScript(root, 'app', 'tool'), 'data\\apps\\app\\python\\Scripts\\tool.exe');
    assert.throws(() => resolveMainScript(root, 'app', 'missing.py'));
    fs.rmSync(root, { recursive: true, force: true });
});

test('run cmd uses bundled python for .py scripts', () => {
    const cmd = buildRunCmd({
        appName: 'app',
        profileName: 'release',
        scriptRelPath: 'data\\apps\\app\\working\\main.py',
        pythonPath: '',
        appVersion: 'v1.0.0',
    });
    assert.match(cmd, /cd \/d "%~dp0data\\apps\\app\\working"/);
    assert.match(cmd, /"%~dp0data\\apps\\app\\python\\python\.exe" "%~dp0data\\apps\\app\\working\\main\.py" %\*/);
    assert.match(cmd, /set "PYAPPIFY_APP_VERSION=v1\.0\.0"/);
    assert.ok(!cmd.includes('PYTHONPATH=') || cmd.includes('set "PYTHONPATH="'));
    assert.ok(!cmd.includes('fltmc'));
    assert.ok(!cmd.includes('start ""'));
});

test('run cmd self-elevates for admin and detaches with pythonw', () => {
    const cmd = buildRunCmd({
        appName: 'app',
        profileName: 'release',
        scriptRelPath: 'data\\apps\\app\\working\\main.py',
        admin: true,
        usePythonw: true,
    });
    assert.ok(cmd.indexOf('fltmc') < cmd.indexOf('cd /d'));
    assert.match(cmd, /-Verb RunAs -WindowStyle Hidden/);
    assert.match(cmd, /start "" "%~dp0data\\apps\\app\\python\\pythonw\.exe" "%~dp0data\\apps\\app\\working\\main\.py" %\*/);
});
