// index.js
const core = require('@actions/core');
const exec = require('@actions/exec');
const tc = require('@actions/tool-cache');
const io = require('@actions/io');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const http = require('@actions/http-client');
const { getInstallerFileName, getMainBinaryName, prepareTauriConfig } = require('./build-config');
const { getSetupVersion, setupProfile } = require('./setup-profile');
const { getKeepReleases, trimRepo } = require('./trim-repo');
const {
    buildRunCmd,
    create7zPackage,
    createZipPackage,
    getPackageFormat,
    getProfilePythonPath,
    getProfileValue,
    getZipPackageFileName,
    readPreparedAppVersion,
    removePycache,
    resolveMainScript,
} = require('./package-zip');

async function find7z() {
    const onPath = await io.which('7z', false);
    if (onPath) return onPath;
    const fallback = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
    if (fs.existsSync(fallback)) return fallback;
    throw new Error("package_zip_format is '7z' but 7z was not found on PATH or in Program Files.");
}

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

async function removeIfExists(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        await io.rmRF(directoryPath);
        core.info(`Removed dir if exists: ${directoryPath}`);
    }
}

async function createZipArchive(sourceDir, zipFilePath, rootDirName) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', () => {
            core.info(`Created zip archive: ${zipFilePath}`);
            core.info(`createZipArchive finalize end: ${zipFilePath} ${sourceDir} ${rootDirName}`);
            resolve();
        });

        output.on('error', err => reject(err));
        archive.on('error', err => reject(err));

        archive.pipe(output);
        archive.directory(sourceDir, rootDirName);
        core.info(`createZipArchive finalize start: ${zipFilePath} ${sourceDir} ${rootDirName}`);
        archive.finalize();
    });
}

function allowPnpmBuildScripts(packageJsonPath) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const pnpmConfig = packageJson.pnpm || {};
    const onlyBuiltDependencies = new Set(pnpmConfig.onlyBuiltDependencies || []);
    onlyBuiltDependencies.add('esbuild');

    packageJson.pnpm = {
        ...pnpmConfig,
        onlyBuiltDependencies: Array.from(onlyBuiltDependencies).sort(),
    };

    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    core.info(`Allowed pnpm build scripts for: ${packageJson.pnpm.onlyBuiltDependencies.join(', ')}`);
}

async function downloadAndExtractRelease(useReleaseUrl, appName, platform, exeDestPath, targetReleasePath) {
    core.startGroup('Downloading and extracting executable from release');
    const token = process.env.GITHUB_TOKEN;
    const headers = token ? { authorization: `token ${token}` } : undefined;
    const client = new http.HttpClient('pyappify-action');
    const releaseData = (await client.getJson(useReleaseUrl, headers)).result;

    if (!releaseData || !releaseData.assets) {
        throw new Error(`Could not fetch release data or assets from ${useReleaseUrl}`);
    }

    const assetName = `${appName}-${platform}.zip`;
    const asset = releaseData.assets.find(a => a.name === assetName);

    if (!asset) {
        throw new Error(`Could not find asset named '${assetName}' in release ${useReleaseUrl}`);
    }

    core.info(`Downloading asset: ${asset.name} from ${asset.browser_download_url}`);
    const downloadedZipPath = await tc.downloadTool(asset.browser_download_url, undefined, token ? `token ${token}` : undefined);

    core.info(`Extracting ${asset.name}`);
    const tempExtractDir = path.join(path.dirname(exeDestPath), 'temp_extract');
    await io.mkdirP(tempExtractDir);
    const extractedPath = await tc.extractZip(downloadedZipPath, tempExtractDir);

    const exeSuffix = platform === 'win32' ? '.exe' : '';
    const appBinaryName = `${appName}${exeSuffix}`;
    const exeSourcePath = path.join(extractedPath, appName, appBinaryName);

    if (!fs.existsSync(exeSourcePath)) {
        throw new Error(`Executable not found at expected path after extraction: ${exeSourcePath}`);
    }

    core.info(`Moving executable from ${exeSourcePath} to ${exeDestPath}`);
    await io.mkdirP(path.dirname(exeDestPath));
    await io.mkdirP(path.dirname(targetReleasePath));
    await io.cp(exeSourcePath, targetReleasePath)
    await io.mv(exeSourcePath, exeDestPath);
    await io.rmRF(tempExtractDir);

    core.info(`Executable successfully placed at ${exeDestPath}`);
    core.endGroup();
}

async function getAppVersion() {
    if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
        return process.env.GITHUB_REF_NAME;
    }
    let latestTag = '';
    await exec.exec('git', ['describe', '--tags', '--abbrev=0'], {
        ignoreReturnCode: true,
        listeners: { stdout: (data) => (latestTag += data.toString()) },
    });
    latestTag = latestTag.trim();
    if (!latestTag) throw new Error('add_version_name is enabled but no git tag was found for the app version.');
    return latestTag;
}

async function run() {
    try {
        const useRelease = core.getInput('use_release');
        const buildExeOnly = core.getBooleanInput('build_exe_only');
        const buildSetup = core.getBooleanInput('build_setup');
        const addVersionName = core.getBooleanInput('add_version_name');
        const packageZip = core.getBooleanInput('package_zip');
        const packageFormat = getPackageFormat(core.getInput('package_zip_format'));
        if (!buildExeOnly && !buildSetup && !packageZip) {
            throw new Error('At least one of build_setup or package_zip must be true.');
        }
        const sevenZip = !buildExeOnly && packageZip && packageFormat === '7z' ? await find7z() : null;
        const setupVersion = getSetupVersion(core.getInput('app_version'));
        const buildDir = process.env.RUNNER_TEMP
            ? path.join(process.env.RUNNER_TEMP, 'p')
            : 'p';
        core.info(`start running buildExeOnly:${buildExeOnly} useRelease:${useRelease}`);
        core.info(`Using build directory: ${buildDir}`);

        if (useRelease && buildExeOnly) {
            throw new Error('use_release and build_exe_only cannot be used at the same time.');
        }

        const distDir = 'pyappify_dist';
        await removeIfExists(distDir);

        const configFile = 'pyappify.yml';
        if (!fs.existsSync(configFile)) throw new Error(`${configFile} not found.`);
        const config = yaml.load(fs.readFileSync(configFile, 'utf8'));
        const appName = config.name;
        if (!appName || !config.profiles) throw new Error(`'name' or 'profiles' not found in ${configFile}.`);
        const keepReleases = getKeepReleases(config);

        const appDistDir = path.join(distDir, appName);
        fs.mkdirSync(appDistDir, { recursive: true });

        const platform = process.platform;
        const exeSuffix = platform === 'win32' ? '.exe' : '';
        const appBinaryName = `${appName}${exeSuffix}`;
        const mainBinaryName = getMainBinaryName(appName);
        const mainBinaryFileName = `${mainBinaryName}${exeSuffix}`;
        const exeDestPath = path.join(appDistDir, appBinaryName);
        const exeSourcePath = path.join(buildDir, 'src-tauri', 'target', 'release', mainBinaryFileName);

        let pyappifyVersion = core.getInput('version');


        if (!fs.existsSync(exeSourcePath)) {
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
                pyappifyVersion = latestTag
                await exec.exec('git', ['checkout', latestTag], { cwd: buildDir });
            }
            core.endGroup();

            await setupPnpm();
            await setupRust();

            core.startGroup('Reading and preparing build');
            fs.copyFileSync(configFile, path.join(buildDir, 'src-tauri', 'assets', configFile));
            if (fs.existsSync('icons')) {
                const targetPath = path.join(buildDir, 'src-tauri', 'icons')
                core.info(`icons folder exists copy to ${targetPath}`);
                fs.cpSync('icons', targetPath, { recursive: true });
            } else {
                core.info(`icons does not exist.`);
            }

            const tauriConfPath = path.join(buildDir, 'src-tauri', 'tauri.conf.json');
            const tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
            const newTauriConf = prepareTauriConfig(tauriConf, appName, pyappifyVersion);
            fs.writeFileSync(tauriConfPath, newTauriConf);

            const cargoTomlPath = path.join(buildDir, 'src-tauri', 'Cargo.toml');
            const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
            const newCargoToml = cargoToml.replace(/name = "pyappify"/g, `name = "${appName}"`);
            fs.writeFileSync(cargoTomlPath, newCargoToml);

            allowPnpmBuildScripts(path.join(buildDir, 'package.json'));

            if (config.uac === true) {
                const buildRsPath = path.join(buildDir, 'src-tauri', 'build.rs');
                const buildRs = fs.readFileSync(buildRsPath, 'utf8');
                const newBuildRs = buildRs.replace('const UAC: bool = false;', 'const UAC: bool = true;');
                fs.writeFileSync(buildRsPath, newBuildRs);
                core.info('UAC set to true in build.rs');
            }
            core.endGroup();
            core.startGroup('Building application with Cargo');
            await exec.exec('pnpm', ['install'], { cwd: buildDir });
            if (useRelease) {
                await downloadAndExtractRelease(useRelease, appName, platform, exeDestPath, exeSourcePath);
                core.endGroup();
            } else {
                await exec.exec('pnpm', ['tauri', 'build', '--no-bundle'], { cwd: buildDir });
                core.endGroup();
            }
        }

        if (buildExeOnly) {
            if (!fs.existsSync(exeSourcePath)) {
                throw new Error(`Binary not found at ${exeSourcePath} after build attempt.`);
            }
            core.setOutput('exe-path', exeSourcePath);
            core.setOutput('exe-folder', path.dirname(exeSourcePath));
            core.info(`build_exe_only is true. Action finished. Exe path: ${exeSourcePath}`);
            return;
        }

        core.startGroup('Packaging application profiles');

        if (!fs.existsSync(exeSourcePath)) throw new Error(`Binary not found at ${exeSourcePath}`);
        fs.copyFileSync(exeSourcePath, exeDestPath);

        if (platform !== 'win32') fs.chmodSync(exeDestPath, '755');

        const fileBuffer = fs.readFileSync(exeDestPath);
        const hashSum = require('crypto').createHash('sha256');
        hashSum.update(fileBuffer);
        const hex = hashSum.digest('hex');
        const hashFilePath = path.join(distDir, `${platform}_sha256.txt`);
        fs.writeFileSync(hashFilePath, hex);
        core.info(`Created SHA256 hash file: ${hashFilePath}`);

        const appVersion = addVersionName ? (setupVersion || await getAppVersion()) : '';
        if (appVersion) core.info(`Adding version ${appVersion} to installer names`);

        const baseZipFileName = `${appName}-${platform}.zip`;
        await createZipArchive(appDistDir, path.join(distDir, baseZipFileName), appName);

        core.info(`read profiles ${config.profiles}`);

        const tauriDataPath = path.join(buildDir, 'src-tauri', 'data');
        if (buildSetup) {
            core.startGroup('Creating online installer');
            await removeIfExists(tauriDataPath);
            await io.mkdirP(tauriDataPath);
            await exec.exec('pnpm', ['tauri', 'bundle'], { cwd: buildDir });
            const nsisDirOnline = path.join(buildDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
            const onlineInstallerFile = fs.readdirSync(nsisDirOnline).find(f => f.endsWith('.exe'));
            if (!onlineInstallerFile) {
                throw new Error(`Could not find the generated NSIS installer for the online setup in ${nsisDirOnline}`);
            }
            const onlineInstallerName = getInstallerFileName(`${appName}-${platform}-online-setup`, appVersion);
            const onlineInstallerDest = path.join(distDir, onlineInstallerName);
            await io.mv(path.join(nsisDirOnline, onlineInstallerFile), onlineInstallerDest);
            core.info(`Created and moved online installer to ${onlineInstallerDest}`);
            core.endGroup();
        }

        for (const profile of config.profiles) {
            core.info(`Processing profile: ${profile.name}`);

            await setupProfile(exec.exec, exeDestPath, profile.name, appName, appDistDir, setupVersion);

            await removeIfExists(tauriDataPath);

            const generatedDataPath = path.join(appDistDir, 'data');
            if (fs.existsSync(generatedDataPath)) {
                const removed = removePycache(generatedDataPath);
                core.info(`Removed ${removed} __pycache__ folders from ${generatedDataPath}`);
            }
            const bundledRepoPath = path.join(generatedDataPath, 'apps', appName, 'repo');
            if (keepReleases && fs.existsSync(bundledRepoPath)) {
                await trimRepo(exec.exec, bundledRepoPath, keepReleases, message => core.info(message));
            }
            if (packageZip) {
                if (!fs.existsSync(generatedDataPath)) {
                    throw new Error(`package_zip is enabled but no data was generated at ${generatedDataPath}`);
                }
                const mainScript = getProfileValue(config.profiles, profile, 'main_script');
                if (!mainScript) throw new Error(`main_script not set for profile ${profile.name}`);
                const cmdContent = buildRunCmd({
                    appName,
                    profileName: profile.name,
                    scriptRelPath: resolveMainScript(generatedDataPath, appName, mainScript),
                    pythonPath: getProfilePythonPath(config.profiles, profile),
                    appVersion: readPreparedAppVersion(generatedDataPath, appName),
                    admin: getProfileValue(config.profiles, profile, 'admin') === true,
                    usePythonw: getProfileValue(config.profiles, profile, 'use_pythonw') === true,
                });
                const packagePath = path.join(distDir, getZipPackageFileName(appName, platform, profile.name, appVersion, packageFormat));
                if (packageFormat === '7z') {
                    await create7zPackage(exec.exec, sevenZip, distDir, appName, cmdContent, packagePath);
                } else {
                    await createZipPackage(archiver, generatedDataPath, cmdContent, packagePath, appName);
                }
                core.info(`Created ${packageFormat} package ${packagePath}`);
            }
            if (buildSetup) {
                if (fs.existsSync(generatedDataPath)) {
                    await io.mv(generatedDataPath, tauriDataPath);
                    core.info(`Moved data for profile ${profile.name} to ${tauriDataPath}`);
                }

                await exec.exec('pnpm', ['tauri', 'bundle'], { cwd: buildDir });

                const nsisDir = path.join(buildDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
                const files = fs.readdirSync(nsisDir);
                const nsisInstallerFile = files.find(f => f.endsWith('.exe'));
                if (!nsisInstallerFile) {
                    throw new Error(`Could not find the generated NSIS installer in ${nsisDir}`);
                }
                const sourceInstallerPath = path.join(nsisDir, nsisInstallerFile);

                const newInstallerName = getInstallerFileName(`${appName}-${platform}-${profile.name}-setup`, appVersion);
                const destInstallerPath = path.join(distDir, newInstallerName);
                await io.mv(sourceInstallerPath, destInstallerPath);
                core.info(`Created and moved installer to ${destInstallerPath}`);
            }

            for (const file of fs.readdirSync(appDistDir)) {
                if (file !== appBinaryName) {
                    fs.rmSync(path.join(appDistDir, file), { recursive: true, force: true });
                }
            }
            core.info(`Done packaging profile ${profile.name}`);
        }

        await removeIfExists(appDistDir);
        core.info(`deleting ${appDistDir}`);
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
