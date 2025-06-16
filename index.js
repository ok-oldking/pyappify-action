// index.js
const core = require('@actions/core');
const exec = require('@actions/exec');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

async function run() {
    try {
        const pyappifyVersion = core.getInput('version');
        const buildDir = 'build_pyappify';

        if (fs.existsSync(buildDir)) {
            fs.rmSync(buildDir, { recursive: true, force: true });
        }

        core.startGroup('Cloning pyappify repository');
        await exec.exec('git', ['clone', 'https://github.com/ok-oldking/pyappify.git', buildDir]);
        if (pyappifyVersion) {
            core.info(`Checking out specified version: ${pyappifyVersion}`);
            await exec.exec('git', ['checkout', `tags/${pyappifyVersion}`], { cwd: buildDir });
        } else {
            core.info('Checking out the latest tag.');
            let latestTag = '';
            await exec.exec('git', ['describe', '--tags', '--abbrev=0'], {
                cwd: buildDir,
                listeners: { stdout: (data) => (latestTag += data.toString()) },
            });
            latestTag = latestTag.trim();
            if (!latestTag) throw new Error('Could not determine the latest tag.');
            core.info(`Latest tag found: ${latestTag}`);
            await exec.exec('git', ['checkout', latestTag], { cwd: buildDir });
        }
        core.endGroup();

        core.startGroup('Reading and preparing build');
        const configFile = 'pyappify.yml';
        if (!fs.existsSync(configFile)) throw new Error(`${configFile} not found.`);
        const config = yaml.load(fs.readFileSync(configFile, 'utf8'));
        const appName = config.name;
        if (!appName || !config.profiles) throw new Error(`'name' or 'profiles' not found in ${configFile}.`);

        fs.copyFileSync(configFile, path.join(buildDir, 'src-tauri', 'assets', configFile));
        if (fs.existsSync('icons')) {
            fs.cpSync('icons', path.join(buildDir, 'src-tauri', 'icons'), { recursive: true });
        }

        const tauriConfPath = path.join(buildDir, 'src-tauri', 'tauri.conf.json');
        const tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
        const newTauriConf = tauriConf.replace(/"pyappify"/g, JSON.stringify(appName));
        fs.writeFileSync(tauriConfPath, newTauriConf);

        const cargoTomlPath = path.join(buildDir, 'src-tauri', 'Cargo.toml');
        const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
        const newCargoToml = cargoToml.replace(/name = "pyappify"/g, `name = "${appName}"`);
        fs.writeFileSync(cargoTomlPath, newCargoToml);

        if (config.uac === true) {
            const buildRsPath = path.join(buildDir, 'src-tauri', 'build.rs');
            const buildRs = fs.readFileSync(buildRsPath, 'utf8');
            const newBuildRs = buildRs.replace('const UAC: bool = false;', 'const UAC: bool = true;');
            fs.writeFileSync(buildRsPath, newBuildRs);
            core.info('UAC set to true in build.rs');
        }
        core.endGroup();

        core.startGroup('Building application with Tauri');
        await exec.exec('pnpm', ['install'], { cwd: buildDir });
        await exec.exec('pnpm', ['run', 'tauri', 'build'], { cwd: buildDir });
        core.endGroup();

        core.startGroup('Packaging application profiles');
        const distDir = 'pyappify_dist';
        const appDistDir = path.join(distDir, appName);
        fs.mkdirSync(appDistDir, { recursive: true });

        const platform = process.platform;
        const exeSuffix = platform === 'win32' ? '.exe' : '';
        const appBinaryName = `${appName}${exeSuffix}`;
        const exeSourcePath = path.join(buildDir, 'src-tauri', 'target', 'release', appBinaryName);
        const exeDestPath = path.join(appDistDir, appBinaryName);
        if (!fs.existsSync(exeSourcePath)) throw new Error(`Binary not found at ${exeSourcePath}`);
        fs.copyFileSync(exeSourcePath, exeDestPath);
        if (platform !== 'win32') fs.chmodSync(exeDestPath, '755');

        for (const profile of config.profiles) {
            core.info(`Processing profile: ${profile.name}`);
            await exec.exec(`"${exeDestPath}"`, ['-c', 'setup', '-p', profile.name]);

            const zipFileName = `${appName}-${platform}-${profile.name}.zip`;
            const zipFilePath = path.join(distDir, zipFileName);
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip');
            archive.pipe(output);
            archive.directory(appDistDir, false);
            await archive.finalize();
            core.info(`Created zip archive: ${zipFilePath}`);

            for (const file of fs.readdirSync(appDistDir)) {
                if (file !== appBinaryName) {
                    fs.rmSync(path.join(appDistDir, file), { recursive: true, force: true });
                }
            }
        }
        core.endGroup();

        core.setOutput('dist-path', distDir);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();