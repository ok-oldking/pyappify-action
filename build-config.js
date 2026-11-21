function replaceExactStringValues(value, from, to) {
    if (typeof value === 'string') {
        return value === from ? to : value;
    }

    if (Array.isArray(value)) {
        return value.map(item => replaceExactStringValues(item, from, to));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                replaceExactStringValues(item, from, to),
            ]),
        );
    }

    return value;
}

function getMainBinaryName(appName) {
    return appName;
}

function prepareTauriConfig(contents, appName, version) {
    let config = JSON.parse(contents);
    config = replaceExactStringValues(config, 'pyappify', appName);
    config = replaceExactStringValues(config, '0.0.1', version.replace(/^v/, ''));
    config.mainBinaryName = getMainBinaryName(appName);
    // Solid LZMA is Tauri's default; set it so the dictionary size below always applies.
    config.bundle = config.bundle || {};
    config.bundle.windows = config.bundle.windows || {};
    config.bundle.windows.nsis = { ...config.bundle.windows.nsis, compression: 'lzma' };

    return `${JSON.stringify(config, null, 2)}\n`;
}

// NSIS compresses with an 8 MB LZMA dictionary by default, too small to find the
// repeats across a Python install. 64 MB shrinks offline installers for about 700 MB
// of RAM while building and 64 MB while installing.
const NSIS_DICT_SIZE_MB = 64;
const NSIS_SET_COMPRESSOR = /^([ \t]*)SetCompressor \/SOLID "\{\{compression\}\}"[ \t]*$/m;

// Returns the installer template with the dictionary size set, or null when the
// template has no SetCompressor line to add it after.
function prepareNsisTemplate(contents) {
    if (contents.includes('SetCompressorDictSize')) return contents;
    const match = contents.match(NSIS_SET_COMPRESSOR);
    if (!match) return null;
    const eol = contents.includes('\r\n') ? '\r\n' : '\n';
    const indent = match[1];
    const lines = [
        `${indent}!if "{{compression}}" == "lzma"`,
        `${indent}  SetCompressorDictSize ${NSIS_DICT_SIZE_MB}`,
        `${indent}!endif`,
    ];
    const end = match.index + match[0].length;
    return contents.slice(0, end) + eol + lines.join(eol) + contents.slice(end);
}

function getInstallerFileName(baseName, version) {
    if (!version) {
        return `${baseName}.exe`;
    }
    return `${baseName}-${version.replace(/^v/, '')}.exe`;
}

module.exports = {
    getInstallerFileName,
    getMainBinaryName,
    NSIS_DICT_SIZE_MB,
    prepareNsisTemplate,
    prepareTauriConfig,
};
