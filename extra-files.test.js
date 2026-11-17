const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getExtraFiles, placeExtraFiles } = require('./extra-files');

function tempApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxf-'));
    fs.mkdirSync(path.join(dir, 'checkpoints', 'hf_cache'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'checkpoints', 'gpt.pth'), 'weights');
    fs.writeFileSync(path.join(dir, 'checkpoints', 'config.yaml'), 'new');
    fs.writeFileSync(path.join(dir, 'checkpoints', 'hf_cache', 'model.safetensors'), 'aux');
    fs.writeFileSync(path.join(dir, 'voice.wav'), 'wav');
    return dir;
}

test('extra_files is a list or one path, inherited from the first profile', () => {
    const dir = tempApp();
    const profiles = [{ name: 'release', extra_files: ['checkpoints', 'voice.wav'] }, { name: 'debug' }];
    assert.deepStrictEqual(getExtraFiles(profiles, profiles[1], dir), ['checkpoints', 'voice.wav']);
    assert.deepStrictEqual(getExtraFiles([{ name: 'r', extra_files: './checkpoints/' }], { name: 'r', extra_files: './checkpoints/' }, dir), ['checkpoints']);
    assert.deepStrictEqual(getExtraFiles([{ name: 'r' }], { name: 'r' }, dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('extra_files rejects paths outside the app and missing paths', () => {
    const dir = tempApp();
    const check = value => () => getExtraFiles([{ name: 'r', extra_files: value }], { name: 'r', extra_files: value }, dir);
    assert.throws(check(['../x']), /inside the app directory/);
    assert.throws(check(['.']), /inside the app directory/);
    assert.throws(check(['missing']), /does not exist/);
    assert.throws(check([3]), /list of paths/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('extra files are placed into working at the same paths, over checked-out copies', () => {
    const dir = tempApp();
    const working = path.join(dir, 'out', 'working');
    fs.mkdirSync(path.join(working, 'checkpoints'), { recursive: true });
    fs.writeFileSync(path.join(working, 'checkpoints', 'config.yaml'), 'old');
    fs.writeFileSync(path.join(working, 'main.py'), 'app');
    const stats = placeExtraFiles(dir, working, ['checkpoints', 'voice.wav']);
    assert.deepStrictEqual(stats, { files: 4, bytes: 'weights'.length + 'new'.length + 'aux'.length + 'wav'.length });
    assert.strictEqual(fs.readFileSync(path.join(working, 'checkpoints', 'gpt.pth'), 'utf8'), 'weights');
    assert.strictEqual(fs.readFileSync(path.join(working, 'checkpoints', 'config.yaml'), 'utf8'), 'new');
    assert.strictEqual(fs.readFileSync(path.join(working, 'checkpoints', 'hf_cache', 'model.safetensors'), 'utf8'), 'aux');
    assert.strictEqual(fs.readFileSync(path.join(working, 'main.py'), 'utf8'), 'app');
    // Removing the prepared copy leaves the originals alone.
    fs.rmSync(path.join(dir, 'out'), { recursive: true, force: true });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'checkpoints', 'gpt.pth'), 'utf8'), 'weights');
    fs.rmSync(dir, { recursive: true, force: true });
});
