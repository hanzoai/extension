import * as assert from 'assert';
import * as sinon from 'sinon';
import { StandaloneAuthManager } from '../../auth/standalone-auth';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

suite('StandaloneAuthManager Test Suite', () => {
    let authManager: StandaloneAuthManager;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // Mock home directory
        sandbox.stub(os, 'homedir').returns('/mock/home');
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Should create auth manager in anonymous mode', () => {
        authManager = new StandaloneAuthManager(true);
        assert.strictEqual(authManager['isAnonymous'], true);
    });

    test('Should create auth manager in authenticated mode', () => {
        authManager = new StandaloneAuthManager(false);
        assert.strictEqual(authManager['isAnonymous'], false);
    });

    test('Should always return authenticated in anonymous mode', async () => {
        authManager = new StandaloneAuthManager(true);
        const isAuth = await authManager.isAuthenticated();
        assert.strictEqual(isAuth, true);
    });

    test('Should return null token in anonymous mode', async () => {
        authManager = new StandaloneAuthManager(true);
        const token = await authManager.getAuthToken();
        assert.strictEqual(token, null);
    });

    test('Should generate device ID', () => {
        const fsExistsStub = sandbox.stub(fs, 'existsSync').returns(false);
        const fsWriteStub = sandbox.stub(fs, 'writeFileSync');
        
        authManager = new StandaloneAuthManager(false);
        const deviceId = authManager['getDeviceId']();
        
        assert.ok(deviceId);
        assert.strictEqual(deviceId.length, 32); // 16 bytes hex = 32 chars
        assert.ok(fsWriteStub.called);
    });

    test('Should read existing device ID', () => {
        const mockDeviceId = 'mock-device-id-12345';
        sandbox.stub(fs, 'existsSync').returns(true);
        sandbox.stub(fs, 'readFileSync').returns(JSON.stringify({ deviceId: mockDeviceId }));
        
        authManager = new StandaloneAuthManager(false);
        const deviceId = authManager['getDeviceId']();
        
        assert.strictEqual(deviceId, mockDeviceId);
    });

    test('Should return anonymous headers in anonymous mode', () => {
        authManager = new StandaloneAuthManager(true);
        sandbox.stub(authManager as any, 'getDeviceId').returns('test-device-id');
        
        const headers = authManager.getHeaders();
        
        assert.strictEqual(headers['X-Hanzo-Mode'], 'anonymous');
        assert.strictEqual(headers['X-Hanzo-Device-Id'], 'test-device-id');
        assert.strictEqual(headers['Authorization'], undefined);
    });

    test('Should return auth headers when authenticated', () => {
        const mockToken = 'mock-auth-token';
        sandbox.stub(fs, 'existsSync').returns(true);
        sandbox.stub(fs, 'readFileSync').returns(JSON.stringify({ token: mockToken }));
        
        authManager = new StandaloneAuthManager(false);
        sandbox.stub(authManager as any, 'getDeviceId').returns('test-device-id');
        
        const headers = authManager.getHeaders();
        
        assert.strictEqual(headers['Authorization'], `Bearer ${mockToken}`);
        assert.strictEqual(headers['X-Hanzo-Device-Id'], 'test-device-id');
    });

    test('Should handle logout', async () => {
        const unlinkStub = sandbox.stub(fs, 'unlinkSync');
        sandbox.stub(fs, 'existsSync').returns(true);
        
        authManager = new StandaloneAuthManager(false);
        await authManager.logout();
        
        assert.ok(unlinkStub.called);
    });

    test('Should not logout in anonymous mode', async () => {
        const unlinkStub = sandbox.stub(fs, 'unlinkSync');
        
        authManager = new StandaloneAuthManager(true);
        await authManager.logout();
        
        assert.ok(unlinkStub.notCalled);
    });
});