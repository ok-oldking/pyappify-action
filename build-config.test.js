const assert = require('node:assert/strict');
const test = require('node:test');

const { NSIS_DICT_SIZE_MB, getInstallerFileName, getMainBinaryName, prepareNsisTemplate, prepareTauriConfig } = require('./build-config');

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

test('keeps NSIS on solid LZMA in tauri.conf.json', () => {
    const source = JSON.stringify({ bundle: { windows: { nsis: { template: 'nsis/installer.nsi' } } } });
    const result = JSON.parse(prepareTauriConfig(source, 'app', 'v1.0.0'));
    assert.equal(result.bundle.windows.nsis.compression, 'lzma');
    assert.equal(result.bundle.windows.nsis.template, 'nsis/installer.nsi');
    assert.equal(JSON.parse(prepareTauriConfig('{}', 'app', 'v1.0.0')).bundle.windows.nsis.compression, 'lzma');
});

test('adds the LZMA dictionary size after SetCompressor once', () => {
    const template = [
        '!if "{{compression}}" == "none"',
        '  SetCompress off',
        '!else',
        '  SetCompressor /SOLID "{{compression}}"',
        '!endif',
        '',
    ].join('\r\n');
    const result = prepareNsisTemplate(template);
    assert.equal(result, [
        '!if "{{compression}}" == "none"',
        '  SetCompress off',
        '!else',
        '  SetCompressor /SOLID "{{compression}}"',
        '  !if "{{compression}}" == "lzma"',
        `    SetCompressorDictSize ${NSIS_DICT_SIZE_MB}`,
        '  !endif',
        '!endif',
        '',
    ].join('\r\n'));
    assert.equal(prepareNsisTemplate(result), result);
    assert.equal(prepareNsisTemplate('Name "x"\n'), null);
});
