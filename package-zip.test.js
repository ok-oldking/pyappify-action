const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildRunCmd, getProfileValue, getZipPackageFileName, resolveMainScript } = require('./package-zip');

test('zip package name includes profile and optional version', () => {
    assert.strictEqual(getZipPackageFileName('app', 'win32', 'release'), 'app-win32-release.zip');
    assert.strictEqual(getZipPackageFileName('app', 'win32', 'release', 'v1.2.0'), 'app-win32-release-1.2.0.zip');
});

test('profile values fall back to the first profile', () => {
    const profiles = [{ name: 'a', main_script: 'main.py' }, { name: 'b' }];
    assert.strictEqual(getProfileValue(profiles, profiles[1], 'main_script'), 'main.py');
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
