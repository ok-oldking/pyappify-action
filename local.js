#!/usr/bin/env node
// Runs the bundled action (dist/index.js) on this machine instead of on a GitHub runner.
// Fills each input from action.yml's defaults, like the runner does, so missing
// boolean inputs do not fail. Usage:
//   node local.js [--app-dir <dir>] [--<input> <value>] [--<boolean input>]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const usage = `Usage: node local.js [--app-dir <dir>] [--<input> <value> ...]

Runs PyAppify on this machine for the app in --app-dir (default: current directory),
which must contain pyappify.yml. Inputs are the ones in action.yml, for example:
  node local.js --app-dir ../my-app --package_zip true --build_setup false
A boolean input given without a value means true. Dashes and underscores are interchangeable.`;

function readInputDefaults(actionYmlPath) {
    const action = yaml.load(fs.readFileSync(actionYmlPath, 'utf8'));
    const defaults = {};
    for (const [name, input] of Object.entries(action.inputs || {})) {
        defaults[name] = input.default === undefined ? '' : String(input.default);
    }
    return defaults;
}

function parseArgs(argv, defaults) {
    const known = new Map(Object.keys(defaults).map(name => [name.replace(/-/g, '_'), name]));
    const result = { appDir: null, inputs: {}, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-h' || arg === '--help') {
            result.help = true;
            continue;
        }
        if (!arg.startsWith('--')) throw new Error(`Unexpected argument '${arg}'.`);
        let key = arg.slice(2);
        let value;
        const eq = key.indexOf('=');
        if (eq !== -1) {
            value = key.slice(eq + 1);
            key = key.slice(0, eq);
        }
        const normalized = key.replace(/-/g, '_');
        const next = argv[i + 1];
        const hasNext = next !== undefined && !next.startsWith('--');
        if (normalized === 'app_dir') {
            if (value === undefined) {
                if (!hasNext) throw new Error('--app-dir needs a directory.');
                value = argv[++i];
            }
            result.appDir = value;
            continue;
        }
        const name = known.get(normalized);
        if (!name) throw new Error(`Unknown input '${key}'. Known inputs: ${Object.keys(defaults).join(', ')}.`);
        if (value === undefined) {
            const isBoolean = ['true', 'false'].includes(defaults[name]);
            if (hasNext) value = argv[++i];
            else if (isBoolean) value = 'true';
            else throw new Error(`--${key} needs a value.`);
        }
        result.inputs[name] = value;
    }
    return result;
}

// Same variable names @actions/core reads: INPUT_ + name upper-cased, spaces as underscores.
function inputEnvName(name) {
    return `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
}

// Precedence: command line, then INPUT_* already in the environment, then action.yml defaults.
function buildInputEnv(defaults, overrides, env) {
    const result = {};
    for (const [name, value] of Object.entries(defaults)) {
        const envName = inputEnvName(name);
        if (name in overrides) result[envName] = overrides[name];
        else if (env[envName] !== undefined) result[envName] = env[envName];
        else result[envName] = value;
    }
    return result;
}

function main() {
    const actionDir = __dirname;
    const defaults = readInputDefaults(path.join(actionDir, 'action.yml'));
    const args = parseArgs(process.argv.slice(2), defaults);
    if (args.help) {
        console.log(usage);
        return 0;
    }
    const appDir = path.resolve(args.appDir || process.env.INIT_CWD || process.cwd());
    if (!fs.existsSync(path.join(appDir, 'pyappify.yml'))) {
        throw new Error(`pyappify.yml not found in ${appDir}. Pass --app-dir <your app folder>.`);
    }
    const bundle = path.join(actionDir, 'dist', 'index.js');
    if (!fs.existsSync(bundle)) throw new Error(`${bundle} not found. Run npm run build first.`);

    const inputEnv = buildInputEnv(defaults, args.inputs, process.env);
    console.log(`Running PyAppify locally in ${appDir}`);
    for (const [name, value] of Object.entries(inputEnv)) console.log(`  ${name}=${value}`);

    const child = spawnSync(process.execPath, [bundle], {
        cwd: appDir,
        env: { ...process.env, ...inputEnv },
        stdio: 'inherit',
    });
    if (child.error) throw child.error;
    // core.setFailed sets process.exitCode, so a failed run exits non-zero.
    return child.status === null ? 1 : child.status;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { buildInputEnv, inputEnvName, parseArgs, readInputDefaults };
