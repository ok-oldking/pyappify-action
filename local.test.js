const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { buildInputEnv, inputEnvName, parseArgs, readInputDefaults } = require('./local');

const defaults = readInputDefaults(path.join(__dirname, 'action.yml'));

test('reads every action.yml input with its default', () => {
    assert.equal(defaults.build_setup, 'true');
    assert.equal(defaults.build_exe_only, 'false');
    assert.equal(defaults.package_zip_format, '7z');
    assert.equal(defaults.version, '');
});

test('parses values, bare booleans, = form, dashes and the app dir', () => {
    const args = parseArgs(
        ['--app-dir', '../app', '--package-zip', '--build_setup', 'false', '--version=v1.2.4', '--package_zip_format', 'zip'],
        defaults,
    );
    assert.equal(args.appDir, '../app');
    assert.deepEqual(args.inputs, {
        package_zip: 'true',
        build_setup: 'false',
        version: 'v1.2.4',
        package_zip_format: 'zip',
    });
});

test('rejects unknown inputs and string inputs without a value', () => {
    assert.throws(() => parseArgs(['--who-to-greet', 'x'], defaults), /Unknown input/);
    assert.throws(() => parseArgs(['--version'], defaults), /needs a value/);
    assert.throws(() => parseArgs(['stray'], defaults), /Unexpected argument/);
});

test('command line beats environment, which beats action.yml defaults', () => {
    const env = buildInputEnv(defaults, { package_zip: 'true' }, { INPUT_BUILD_SETUP: 'false', INPUT_PACKAGE_ZIP: 'false' });
    assert.equal(env.INPUT_PACKAGE_ZIP, 'true');
    assert.equal(env.INPUT_BUILD_SETUP, 'false');
    assert.equal(env.INPUT_BUILD_EXE_ONLY, 'false');
    assert.equal(env.INPUT_PACKAGE_ZIP_FORMAT, '7z');
    assert.equal(inputEnvName('app version'), 'INPUT_APP_VERSION');
});
