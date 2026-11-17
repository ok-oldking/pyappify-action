const fs = require('fs');
const path = require('path');

function getSetupVersion(input, env = process.env) {
    return input || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : '') || '';
}

async function setupProfile(exec, executable, profile, appName, appDistDir, version) {
    const args = ['-c', 'setup', '-p', profile];
    if (version) args.push('--setup-version', version);
    // From appDistDir, so the launcher's logs folder stays out of the app's own folder.
    await exec(path.resolve(executable), args, { cwd: appDistDir });

    if (version) {
        const configPath = path.join(appDistDir, 'data', 'apps', appName, 'app.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!config.installed || config.current_version !== version) {
            throw new Error(
                `Setup for ${profile} requested ${version} but prepared ${config.current_version}. ` +
                'Use PyAppify v1.2.4 or newer, including when reusing a release executable.',
            );
        }
    }
}

// Moves a directory, copying when it crosses drives (rename fails with EXDEV).
function moveDir(from, to) {
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
    }
}

// The launcher keeps pip's download cache in <appDistDir>/cache, which is
// deleted after every profile. Lending it a persistent cache for the setup
// lets later profiles and later local builds reuse the downloads.
async function withPersistentCache(persistentDir, appDistDir, run) {
    const launcherCache = path.join(appDistDir, 'cache');
    if (persistentDir && fs.existsSync(persistentDir)) moveDir(persistentDir, launcherCache);
    try {
        return await run();
    } finally {
        if (persistentDir && fs.existsSync(launcherCache)) moveDir(launcherCache, persistentDir);
    }
}

module.exports = { getSetupVersion, moveDir, setupProfile, withPersistentCache };
