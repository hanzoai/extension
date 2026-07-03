import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StandaloneAuthManager } from '../../auth/standalone-auth';

// os.homedir() is non-configurable in the electron test host, so instead of
// stubbing it we redirect $HOME to a throwaway directory (os.homedir honors
// $HOME on POSIX). Every test then exercises the real filesystem-backed
// behavior: config dir ~/.hanzo-mcp with auth.json + device.json.
suite('StandaloneAuthManager Test Suite', () => {
    let origHome: string | undefined;
    let tmpHome: string;
    let configDir: string;

    setup(() => {
        origHome = process.env.HOME;
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hanzo-auth-'));
        process.env.HOME = tmpHome;
        configDir = path.join(tmpHome, '.hanzo-mcp');
    });

    teardown(() => {
        if (origHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = origHome; }
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    test('constructor creates the config directory', () => {
        // eslint-disable-next-line no-new
        new StandaloneAuthManager(true);
        assert.ok(fs.existsSync(configDir));
    });

    test('anonymous flag is recorded', () => {
        assert.strictEqual(new StandaloneAuthManager(true)['isAnonymous'], true);
        assert.strictEqual(new StandaloneAuthManager(false)['isAnonymous'], false);
    });

    test('anonymous mode is always authenticated with a null token', async () => {
        const mgr = new StandaloneAuthManager(true);
        assert.strictEqual(await mgr.isAuthenticated(), true);
        assert.strictEqual(await mgr.getAuthToken(), null);
    });

    test('getDeviceId generates and persists a 32-char hex id', () => {
        const mgr = new StandaloneAuthManager(false);
        const deviceId = mgr['getDeviceId']();
        assert.strictEqual(deviceId.length, 32);
        assert.match(deviceId, /^[0-9a-f]{32}$/);
        assert.ok(fs.existsSync(path.join(configDir, 'device.json')));
        // Stable across calls once persisted.
        assert.strictEqual(mgr['getDeviceId'](), deviceId);
    });

    test('getDeviceId reads a pre-existing device id', () => {
        const mgr = new StandaloneAuthManager(false);
        fs.writeFileSync(path.join(configDir, 'device.json'), JSON.stringify({ deviceId: 'preexisting-id' }));
        assert.strictEqual(mgr['getDeviceId'](), 'preexisting-id');
    });

    test('anonymous headers carry the mode and device id but no Authorization', () => {
        const headers = new StandaloneAuthManager(true).getHeaders();
        assert.strictEqual(headers['X-Mode'], 'anonymous');
        assert.match(headers['X-Device-Id'], /^[0-9a-f]{32}$/);
        assert.strictEqual(headers['Authorization'], undefined);
    });

    test('authenticated headers carry a Bearer token when one is stored', () => {
        const mgr = new StandaloneAuthManager(false);
        fs.writeFileSync(path.join(configDir, 'auth.json'), JSON.stringify({ token: 'stored-token' }));
        const headers = mgr.getHeaders();
        assert.strictEqual(headers['Authorization'], 'Bearer stored-token');
        assert.match(headers['X-Device-Id'], /^[0-9a-f]{32}$/);
    });

    test('logout removes the stored token file', async () => {
        const mgr = new StandaloneAuthManager(false);
        const tokenFile = path.join(configDir, 'auth.json');
        fs.writeFileSync(tokenFile, JSON.stringify({ token: 'x' }));
        await mgr.logout();
        assert.ok(!fs.existsSync(tokenFile));
    });

    test('logout is a no-op in anonymous mode', async () => {
        const mgr = new StandaloneAuthManager(true);
        const tokenFile = path.join(configDir, 'auth.json');
        fs.writeFileSync(tokenFile, JSON.stringify({ token: 'x' }));
        await mgr.logout();
        assert.ok(fs.existsSync(tokenFile));
    });
});
