const assert = require('node:assert/strict');
const test = require('node:test');

const { getInstallerFileName, getMainBinaryName, prepareTauriConfig } = require('./build-config');

test('adds the version to the installer name only when given', () => {
    assert.equal(getInstallerFileName('app-win32-release-setup'), 'app-win32-release-setup.exe');
    assert.equal(getInstallerFileName('app-win32-release-setup', 'v1.1.0'), 'app-win32-release-setup-1.1.0.exe');
    assert.equal(getInstallerFileName('app-win32-release-setup', 'v1.1.0-beta.1'), 'app-win32-release-setup-1.1.0-beta.1.exe');
});

test('uses the app name as the Tauri main binary', () => {
    assert.equal(getMainBinaryName('ok-script-app'), 'ok-script-app');
});

test('prepares tauri.conf.json without relying on exact serialized strings', () => {
    const source = JSON.stringify({
        productName: 'pyappify',
        mainBinaryName: 'pyappify Launcher',
        version: '0.0.1',
        identifier: 'pyappify',
        app: { windows: [{ title: 'pyappify' }] },
    });

    const result = JSON.parse(prepareTauriConfig(source, 'ok-script-app', 'v1.1.15'));

    assert.equal(result.productName, 'ok-script-app');
    assert.equal(result.mainBinaryName, 'ok-script-app');
    assert.equal(result.version, '1.1.15');
    assert.equal(result.identifier, 'ok-script-app');
    assert.equal(result.app.windows[0].title, 'ok-script-app');
});
