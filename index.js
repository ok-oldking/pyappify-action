// index.js
const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache'); // Tool-cache for downloading
const io = require('@actions/io');       // IO utilities
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const archiver = 'archiver';
const crypto = require('crypto');

// --- NEW SETUP FUNCTIONS ---

async function setupPnpm() {
    core.startGroup('Setting up pnpm');
    // A simple global install is sufficient since Node.js is already provided.
    await exec.exec('npm', ['install', '-g', 'pnpm']);
    core.info('pnpm has been installed.');
    core.endGroup();
}

async function setupRust() {
    core.startGroup('Setting up Rust');

    if (process.platform === 'win32') {
        // --- THIS IS THE CORRECTED BLOCK FOR WINDOWS ---
        core.info('Downloading rustup-init.exe for Windows');
        let rustupInitPath = await tc.downloadTool('https://win.rustup.rs/x86_64');

        // The downloaded file has no extension, so we need to rename it
        const newPath = rustupInitPath + '.exe';
        await io.mv(rustupInitPath, newPath);

        // Now execute the renamed file
        await exec.exec(newPath, ['-y', '--no-modify-path', '--default-toolchain', 'stable']);
    } else {
        // This block for Linux and macOS is already correct
        core.info('Downloading rustup.sh for Linux/macOS');
        const rustupInit = await tc.downloadTool('https://sh.rustup.rs');
        await exec.exec('sh', [rustupInit, '-y', '--no-modify-path', '--default-toolchain', 'stable']);
    }

    // Add cargo to the current session's PATH
    core.addPath(path.join(process.env.HOME || process.env.USERPROFILE, '.cargo', 'bin'));

    // Install macOS cross-compilation targets if on a mac runner
    if (process.platform === 'darwin') {
        core.info('Installing macOS cross-compilation targets');
        await exec.exec('rustup', ['target', 'add', 'aarch64-apple-darwin']);
        await exec.exec('rustup', ['target', 'add', 'x86_64-apple-darwin']);
    }

    // Install Linux dependencies if on a linux runner
    if (process.platform === 'linux') {
        core.info('Installing Linux dependencies');
        await exec.exec('sudo', ['apt-get', 'update']);
        await exec.exec('sudo', ['apt-get', 'install', '-y', 'libwebkit2gtk-4.0-dev', 'libwebkit2gtk-4.1-dev', 'libappindicator3-dev', 'librsvg2-dev', 'patchelf']);
    }

    core.info('Rust is set up.');
    core.endGroup();
}


// --- YOUR EXISTING HELPER FUNCTIONS ---

function removeIfExists(directoryPath) {
    // Replaced with io.rmRF which is more robust
    io.rmRF(directoryPath);
}

async function createZipArchive(sourceDir, zipFilePath, rootDirName) {
    const output = fs.createWriteStream(zipFilePath);
    const archive = require('archiver')('zip'); // Lazy require
    archive.pipe(output);
    archive.directory(sourceDir, rootDirName);
    await archive.finalize();
    core.info(`Created zip archive: ${zipFilePath}`);
}

async function run() {
    try {
        // --- CALL NEW SETUP FUNCTIONS AT THE START ---
        await setupPnpm();
        await setupRust();

        const pyappifyVersion = core.getInput('version');
        const buildDir = 'pyappify_build';

        removeIfExists(buildDir);

        core.startGroup('Cloning pyappify repository');
        // ... (the rest of your script is identical to what you provided)
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
        removeIfExists(distDir);

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

        const fileBuffer = fs.readFileSync(exeDestPath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hex = hashSum.digest('hex');
        const hashFilePath = path.join(distDir, `${hex}.txt`);
        fs.writeFileSync(hashFilePath, hex);
        core.info(`Created SHA256 hash file: ${hashFilePath}`);

        const baseZipFileName = `${appName}-${platform}.zip`;
        await createZipArchive(appDistDir, path.join(distDir, baseZipFileName), appName);

        for (const profile of config.profiles) {
            core.info(`Processing profile: ${profile.name}`);
            await exec.exec(`"${exeDestPath}"`, ['-c', 'setup', '-p', profile.name]);

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
        removeIfExists(appDistDir);
        core.info(`deleting ${appDistDir}`);
        core.endGroup();

        const releaseFiles = fs.readdirSync(distDir).map(f => path.join(distDir, f));
        core.setOutput('pyappify-assets', releaseFiles.join('\n'));
        core.setOutput('dist-path', distDir);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();