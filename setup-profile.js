const fs = require('fs');
const path = require('path');

function getSetupVersion(input, env = process.env) {
    return input || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : '') || '';
}

async function setupProfile(exec, executable, profile, appName, appDistDir, version) {
    const args = ['-c', 'setup', '-p', profile];
    if (version) args.push('--setup-version', version);
    await exec(executable, args);

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

module.exports = { getSetupVersion, setupProfile };
