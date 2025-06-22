// index.js
const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const archiver_module = 'archiver';
const crypto_module = 'crypto';

async function setupPnpm() {
    core.startGroup('Setting up pnpm');
    let pnpmPath = await io.which('pnpm');
    if (pnpmPath) {
        core.info(`pnpm is already installed at: ${pnpmPath}. Skipping setup.`);
        core.endGroup();
        return;
    }
    await exec.exec('npm', ['install', '-g', 'pnpm']);
    core.info('pnpm has been installed.');
    core.endGroup();
}

async function setupRust() {
    core.startGroup('Setting up Rust');
    if (await io.which('cargo', true)) {
        core.info('Rust (cargo) is already installed. Skipping setup.');
        core.endGroup();
        return;
    }
    if (process.platform === 'win32') {
        core.info('Downloading rustup-init.exe for Windows');
        const rustupInitPath = await tc.downloadTool('https://win.rustup.rs/x86_64');
        const newPath = path.join(path.dirname(rustupInitPath), 'rustup-init.exe');
        await io.mv(rustupInitPath, newPath);
        await exec.exec(newPath, ['-y', '--no-modify-path', '--default-toolchain', 'stable']);
    } else {
        core.info('Downloading rustup.sh for Linux/macOS');
        const rustupInit = await tc.downloadTool('https://sh.rustup.rs');
        await exec.exec('sh', [rustupInit, '-y', '--no-modify-path', '--default-toolchain', 'stable']);
    }
    core.addPath(path.join(process.env.HOME || process.env.USERPROFILE, '.cargo', 'bin'));
    if (process.platform === 'darwin') {
        core.info('Installing macOS cross-compilation targets');
        await exec.exec('rustup', ['target', 'add', 'aarch64-apple-darwin']);
        await exec.exec('rustup', ['target', 'add', 'x86_64-apple-darwin']);
    }
    if (process.platform === 'linux') {
        core.info('Installing Linux dependencies');
        await exec.exec('sudo', ['apt-get', 'update']);
        await exec.exec('sudo', ['apt-get', 'install', '-y', 'libwebkit2gtk-4.0-dev', 'libwebkit2gtk-4.1-dev', 'libappindicator3-dev', 'librsvg2-dev', 'patchelf']);
    }
    core.info('Rust is set up.');
    core.endGroup();
}

function removeIfExists(directoryPath) {
    core.info(`Removing dir if exists: ${directoryPath}`);
    if (fs.existsSync(directoryPath)) {
        io.rmRF(directoryPath);
    }
}

async function createZipArchive(sourceDir, zipFilePath, rootDirName) {
    const output = fs.createWriteStream(zipFilePath);
    const archive = require(archiver_module)('zip');
    archive.pipe(output);
    archive.directory(sourceDir, rootDirName);
    await archive.finalize();
    core.info(`Created zip archive: ${zipFilePath}`);
}

async function run() {
    try {
        await setupPnpm();
        await setupRust();

        const pyappifyVersion = core.getInput('version');
        const buildDir = 'pyappify_build';

        removeIfExists(buildDir);

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
            targetPath = path.join(buildDir, 'src-tauri', 'icons')
            core.info(`icons folder exists copy to ${targetPath}`);
            fs.cpSync('icons', targetPath, { recursive: true });
        } else {
            core.info(`icons does not exist.`);
        }

        const tauriConfPath = path.join(buildDir, 'src-tauri', 'tauri.conf.json');
        const tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
        const newTauriConf = tauriConf.replace(/"pyappify"/g, JSON.stringify(appName));
        fs.writeFileSync(tauriConfPath, newTauriConf);

        const cargoTomlPath = path.join(buildDir, 'src-tauri', 'Cargo.toml');
        const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
        const newCargoToml = cargoToml.replace(/name = "pyappify"/g, `name = "${appName}"`);
        fs.writeFileSync(cargoTomlPath, newCargoToml);
        core.endGroup();

        const distDir = 'pyappify_dist';
        removeIfExists(distDir);
        fs.mkdirSync(distDir, { recursive: true });

        const buildRsPath = path.join(buildDir, 'src-tauri', 'build.rs');
        const originalBuildRsContent = fs.readFileSync(buildRsPath, 'utf8');
        const uacRequested = config.uac === true;

        const platform = process.platform;
        const exeSuffix = platform === 'win32' ? '.exe' : '';
        const appBinaryName = `${appName}${exeSuffix}`;
        const builtExePathInTarget = path.join(buildDir, 'src-tauri', 'target', 'release', appBinaryName);

        let exePathForSetupOperations;
        let exePathForPackaging = builtExePathInTarget;

        await exec.exec('pnpm', ['install'], { cwd: buildDir });

        if (uacRequested) {
            core.info('UAC mode: Building non-UAC version for setup, then UAC version for packaging.');

            core.startGroup('Building non-UAC application (for setup)');
            let nonUacBuildRs = originalBuildRsContent.replace('const UAC: bool = true;', 'const UAC: bool = false;');
            if (!nonUacBuildRs.includes('const UAC: bool = false;')) { // If default template doesn't have it or 'true' wasn't there
                // Assuming the template has `const UAC: bool = false;` or it's added/ensured here.
                // For robustness, if the line is missing, this won't add it.
                // The original code implies replacement, so the line should exist.
                // If the line `const UAC: bool = false;` is crucial and might be missing, it needs explicit addition.
                // Given structure, relying on replacement from template's `const UAC: bool = false;`
            }
            fs.writeFileSync(buildRsPath, nonUacBuildRs);
            core.info('Ensured UAC is false in build.rs for non-UAC build.');
            await exec.exec('pnpm', ['run', 'tauri', 'build'], { cwd: buildDir });
            core.endGroup();

            const tempNonUacDir = path.join(buildDir, 'src-tauri', 'target', 'release', 'non_uac_setup_exe');
            removeIfExists(tempNonUacDir);
            fs.mkdirSync(tempNonUacDir, { recursive: true });
            exePathForSetupOperations = path.join(tempNonUacDir, appBinaryName);
            fs.copyFileSync(builtExePathInTarget, exePathForSetupOperations);
            if (platform !== 'win32') fs.chmodSync(exePathForSetupOperations, '755');
            core.info(`Non-UAC executable for setup prepared at: ${exePathForSetupOperations}`);

            core.startGroup('Building UAC-enabled application (for packaging)');
            const uacBuildRs = originalBuildRsContent.replace('const UAC: bool = false;', 'const UAC: bool = true;');
            if (!uacBuildRs.includes('const UAC: bool = true;')) throw new Error("Failed to set build.rs to UAC true. Check build.rs template.");
            fs.writeFileSync(buildRsPath, uacBuildRs);
            core.info('Set UAC to true in build.rs for UAC build.');
            await exec.exec('pnpm', ['run', 'tauri', 'build'], { cwd: buildDir });
            core.endGroup();

            exePathForPackaging = builtExePathInTarget; // Now points to the UAC-enabled exe in target/release
            fs.writeFileSync(buildRsPath, originalBuildRsContent); // Restore build.rs
            core.info('Restored build.rs to original state.');

        } else {
            core.startGroup('Building application with Tauri (non-UAC)');
            let nonUacBuildRs = originalBuildRsContent.replace('const UAC: bool = true;', 'const UAC: bool = false;');
            fs.writeFileSync(buildRsPath, nonUacBuildRs);
            core.info('Ensured UAC is false in build.rs (or default).');
            await exec.exec('pnpm', ['run', 'tauri', 'build'], { cwd: buildDir });
            core.endGroup();
            exePathForPackaging = builtExePathInTarget;
        }

        core.startGroup('Packaging application profiles');
        const appDistDir = path.join(distDir, appName);
        fs.mkdirSync(appDistDir, { recursive: true });

        const exeDestPathInAppDist = path.join(appDistDir, appBinaryName);
        if (!fs.existsSync(exePathForPackaging)) throw new Error(`Binary for packaging not found at ${exePathForPackaging}`);
        fs.copyFileSync(exePathForPackaging, exeDestPathInAppDist);
        if (platform !== 'win32') fs.chmodSync(exeDestPathInAppDist, '755');

        if (!uacRequested) {
            exePathForSetupOperations = exeDestPathInAppDist;
        }
        if (!fs.existsSync(exePathForSetupOperations)) throw new Error(`Executable for setup operations not found at ${exePathForSetupOperations}`);


        const fileBuffer = fs.readFileSync(exeDestPathInAppDist);
        const hashSum = require(crypto_module).createHash('sha256');
        hashSum.update(fileBuffer);
        const hex = hashSum.digest('hex');
        const hashFilePath = path.join(distDir, `${hex}.txt`);
        fs.writeFileSync(hashFilePath, hex);
        core.info(`Created SHA256 hash file: ${hashFilePath}`);

        const baseZipFileName = `${appName}-${platform}.zip`;
        await createZipArchive(appDistDir, path.join(distDir, baseZipFileName), appName);

        for (const profile of config.profiles) {
            core.info(`Processing profile: ${profile.name}`);
            removeIfExists(path.join(appDistDir, 'logs'));
            removeIfExists(path.join(appDistDir, 'data', 'cache'));

            await exec.exec(exePathForSetupOperations, ['-c', 'setup', '-p', profile.name]);

            removeIfExists(path.join(appDistDir, 'logs'));
            removeIfExists(path.join(appDistDir, 'data', 'cache'));

            const zipFileName = `${appName}-${platform}-${profile.name}.zip`;
            await createZipArchive(appDistDir, path.join(distDir, zipFileName), appName);

            for (const file of fs.readdirSync(appDistDir)) {
                if (file !== appBinaryName) {
                    fs.rmSync(path.join(appDistDir, file), { recursive: true, force: true });
                }
            }
        }

        if (uacRequested && exePathForSetupOperations) {
            const tempNonUacDir = path.dirname(exePathForSetupOperations);
            removeIfExists(tempNonUacDir);
            core.info(`Cleaned up temporary non-UAC directory: ${tempNonUacDir}`);
        }
        core.endGroup();

        const releaseFiles = fs.readdirSync(distDir).map(f => path.join(distDir, f));
        const assets = releaseFiles.join('\n')
        core.setOutput('pyappify-assets', releaseFiles.join('\n'));
        core.setOutput('dist-path', distDir);
        core.info(`pyappify-assets ${assets}`);
        core.info(`dist-path ${assets}`);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();