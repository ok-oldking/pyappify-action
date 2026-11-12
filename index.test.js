const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const yaml = require('js-yaml');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const defaults = Object.fromEntries(Object.entries(
    yaml.load(fs.readFileSync(path.join(__dirname, 'action.yml'), 'utf8')).inputs,
).map(([name, input]) => [name, String(input.default ?? '')]));

async function runAction(inputs = {}, cached = true, { updaterReady = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyappify-action-'));
    const previousDirectory = process.cwd();
    const buildDir = path.join(root, 'runner', 'p');
    const executable = path.join(buildDir, 'src-tauri', 'target', 'release', 'demo.exe');
    const commands = [];
    const failures = [];
    const warnings = [];
    const outputs = {};
    const write = (file, text = 'fixture') => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };
    const exec = async (command, args) => {
        commands.push([command, ...args]);
        if (command === 'git' && args[0] === 'clone') {
            fs.mkdirSync(path.join(buildDir, 'src-tauri', 'assets'), { recursive: true });
            write(path.join(buildDir, 'src-tauri', 'tauri.conf.json'), '{}');
            write(path.join(buildDir, 'src-tauri', 'Cargo.toml'), 'name = "pyappify"');
            write(path.join(buildDir, 'package.json'), '{}');
        } else if (args[0] === 'tauri' && args[1] === 'build') {
            write(executable);
        } else if (args[0] === 'tauri' && args[1] === 'bundle') {
            write(path.join(buildDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis', 'setup.exe'));
        } else if (command.endsWith('demo.exe')) {
            const app = path.join('pyappify_dist', 'demo', 'data', 'apps', 'demo');
            write(path.join(app, 'working', 'main.py'));
            write(path.join(app, 'app.json'), JSON.stringify({
                installed: true, current_version: 'v2.0.0-beta.1',
            }));
            if (updaterReady) {
                const site = path.join(app, 'python', 'Lib', 'site-packages');
                write(path.join(site, 'pyappify', 'updater_ui.py'));
                write(path.join(site, 'dulwich', '__init__.py'));
                write(path.join(app, 'repo', 'HEAD'));
            }
        }
        return 0;
    };
    const values = { ...defaults, version: 'v1.2.6', package_zip_format: 'zip', ...inputs };
    const mocks = {
        '@actions/core': {
            getInput: name => values[name] || '',
            getBooleanInput: name => String(values[name]) === 'true',
            info() {}, startGroup() {}, endGroup() {},
            warning: message => warnings.push(message),
            setFailed: message => failures.push(message),
            setOutput: (name, value) => { outputs[name] = value; },
        },
        '@actions/exec': { exec },
        '@actions/io': {
            which: async () => 'available',
            rmRF: async target => {
                assert.ok(path.resolve(target).startsWith(root + path.sep));
                fs.rmSync(target, { recursive: true, force: true });
            },
            mkdirP: async target => fs.mkdirSync(target, { recursive: true }),
            mv: async (from, to) => {
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.renameSync(from, to);
            },
        },
    };
    try {
        process.chdir(root);
        write('pyappify.yml', yaml.dump({
            name: 'demo', profiles: [{ name: 'China', main_script: 'main.py' }, { name: 'Global' }],
        }));
        if (cached) write(executable, 'signed binary');
        await vm.runInNewContext(source, {
            require: name => mocks[name] || require(name),
            process: { platform: 'win32', env: {
                RUNNER_TEMP: path.join(root, 'runner'),
                GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v2.0.0-beta.1',
            } },
        });
        const files = fs.existsSync('pyappify_dist') ? fs.readdirSync('pyappify_dist') : [];
        // Zip entry names are stored uncompressed, so a byte search finds them.
        const archives = Object.fromEntries(files.filter(file => file.endsWith('.zip'))
            .map(file => [file, fs.readFileSync(path.join('pyappify_dist', file)).toString('latin1')]));
        return { commands, failures, warnings, outputs, files, archives };
    } finally {
        process.chdir(previousDirectory);
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'pyappify-action-')));
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('setup defaults to true and creates online and both profile installers', async () => {
    const result = await runAction();
    assert.deepEqual(result.failures, []);
    assert.equal(result.commands.filter(command => command[2] === 'bundle').length, 3);
    assert.ok(result.files.includes('demo-win32-online-setup.exe'));
    assert.ok(result.files.includes('demo-win32-China-setup.exe'));
    assert.ok(result.files.includes('demo-win32-Global-setup.exe'));
});

test('archive-only builds prepare every profile without bundling installers', async () => {
    const result = await runAction({ build_setup: false, package_zip: true }, false);
    assert.deepEqual(result.failures, []);
    assert.ok(result.commands.some(command => command.join(' ') === 'pnpm tauri build --no-bundle'));
    assert.equal(result.commands.filter(command => command[2] === 'bundle').length, 0);
    assert.ok(result.files.includes('demo-win32-China.zip'));
    assert.ok(result.files.includes('demo-win32-Global.zip'));
    assert.ok(!result.files.some(file => file.endsWith('.exe')));
});

test('setup and archives can both be enabled', async () => {
    const result = await runAction({ package_zip: true });
    assert.deepEqual(result.failures, []);
    assert.ok(result.files.includes('demo-win32-China.zip'));
    assert.ok(result.files.includes('demo-win32-China-setup.exe'));
});

test('rejects disabling both outputs before running any build commands', async () => {
    const result = await runAction({ build_setup: false, package_zip: false });
    assert.deepEqual(result.failures, ['At least one of build_setup or package_zip must be true.']);
    assert.equal(result.commands.length, 0);
});

test('binary-only signing mode allows both outputs disabled, including a cached binary', async () => {
    for (const cached of [true, false]) {
        const result = await runAction({ build_exe_only: true, build_setup: false }, cached);
        assert.deepEqual(result.failures, []);
        assert.ok(result.outputs['exe-path'].endsWith('demo.exe'));
        assert.equal(result.commands.filter(command => command[2] === 'bundle').length, 0);
        assert.ok(result.files.every(file => file === 'demo'));
    }
});

test('archives get an updater cmd when the bundled python can run the update window', async () => {
    const result = await runAction({ build_setup: false, package_zip: true }, true, { updaterReady: true });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.warnings, []);
    const archive = result.archives['demo-win32-Global.zip'];
    assert.ok(archive.includes('demo/demo.cmd'));
    assert.ok(archive.includes('demo/demo-updater.cmd'));
});

test('archives skip the updater cmd with a warning when pyappify is missing or it is disabled', async () => {
    const missing = await runAction({ build_setup: false, package_zip: true });
    assert.deepEqual(missing.failures, []);
    assert.equal(missing.warnings.length, 2);
    assert.match(missing.warnings[0], /demo-updater\.cmd.*pyappify/);
    assert.ok(!missing.archives['demo-win32-China.zip'].includes('demo-updater.cmd'));

    const disabled = await runAction({ build_setup: false, package_zip: true, package_zip_updater: false });
    assert.deepEqual(disabled.warnings, []);
    assert.ok(disabled.archives['demo-win32-China.zip'].includes('demo/demo.cmd'));
    assert.ok(!disabled.archives['demo-win32-China.zip'].includes('demo-updater.cmd'));
});
