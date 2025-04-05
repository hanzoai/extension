"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const sinon = __importStar(require("sinon"));
const ReminderService_1 = require("../../services/ReminderService");
suite('ReminderService Test Suite', () => {
    let service;
    let mockContext;
    let mockGitAPI;
    let clock;
    let showInfoMessageStub;
    let onReanalyzeRequestedStub;
    const createMockContext = () => ({
        globalState: {
            get: sinon.stub(),
            update: sinon.stub().resolves(),
            keys: () => [],
            setKeysForSync: () => { }
        },
        subscriptions: [],
        workspaceState: {
            get: sinon.stub(),
            update: sinon.stub(),
            keys: () => []
        },
        secrets: {
            get: sinon.stub(),
            store: sinon.stub(),
            delete: sinon.stub(),
            onDidChange: new vscode.EventEmitter().event
        },
        extensionPath: '',
        extensionUri: vscode.Uri.file(''),
        environmentVariableCollection: {},
        extensionMode: vscode.ExtensionMode.Test,
        storageUri: vscode.Uri.file(''),
        globalStorageUri: vscode.Uri.file(''),
        logUri: vscode.Uri.file(''),
        storagePath: '',
        globalStoragePath: '',
        logPath: '',
        extension: {},
        asAbsolutePath: (path) => path
    });
    const createMockGitAPI = () => ({
        repositories: [{
                state: {
                    onDidChange: sinon.stub().callsFake((callback) => callback()),
                    HEAD: { commit: 'test-commit' }
                },
                diffWithHEAD: sinon.stub().resolves([
                    { additions: 5, deletions: 3, uri: vscode.Uri.file('/test/file1.ts') },
                    { additions: 2, deletions: 1, uri: vscode.Uri.file('/test/ignored/file2.ts') }
                ])
            }]
    });
    setup(() => {
        // Setup fake timer
        clock = sinon.useFakeTimers();
        // Mock VSCode APIs
        mockContext = createMockContext();
        mockGitAPI = createMockGitAPI();
        // Stub vscode.window.showInformationMessage
        showInfoMessageStub = sinon.stub(vscode.window, 'showInformationMessage').resolves('Reanalyze Now');
        // Stub workspace folders
        sinon.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/test'), name: 'test', index: 0 }
        ]);
        // Stub workspace.asRelativePath
        sinon.stub(vscode.workspace, 'asRelativePath').callsFake((path) => path.replace('/test/', ''));
        // Stub vscode.extensions.getExtension
        sinon.stub(vscode.extensions, 'getExtension').returns({
            exports: { getAPI: () => mockGitAPI }
        });
        // Create onReanalyzeRequested stub
        onReanalyzeRequestedStub = sinon.stub().resolves();
        // Initialize service
        service = new ReminderService_1.ReminderService(mockContext, onReanalyzeRequestedStub);
    });
    teardown(() => {
        clock.restore();
        sinon.restore();
    });
    test('Git tracking - should count changes in non-ignored files', async () => {
        // Wait for debounced operations
        await clock.tickAsync(1100);
        // Verify changes were counted correctly (only non-ignored files)
        const expectedMessage = '8 changes detected since last analysis. Would you like to reanalyze?';
        assert.strictEqual(showInfoMessageStub.firstCall?.args[0], expectedMessage);
    });
    test('File tracking - should ignore files matching patterns', async () => {
        // Mock file system watcher
        const mockWatcher = {
            onDidChange: sinon.stub(),
            onDidCreate: sinon.stub(),
            onDidDelete: sinon.stub(),
            dispose: sinon.stub()
        };
        sinon.stub(vscode.workspace, 'createFileSystemWatcher').returns(mockWatcher);
        // Simulate file changes
        const changes = [
            vscode.Uri.file('/test/src/file1.ts'),
            vscode.Uri.file('/test/node_modules/file2.ts'),
            vscode.Uri.file('/test/src/file3.test.ts')
        ];
        // Get the change handler
        const changeHandler = mockWatcher.onDidChange.firstCall?.args[0];
        assert.ok(changeHandler, 'Change handler not registered');
        // Trigger changes
        changes.forEach(uri => changeHandler(uri));
        // Wait for debounced operations
        await clock.tickAsync(1100);
        // Only one change should be counted (non-ignored files)
        const expectedMessage = '1 changes detected since last analysis. Would you like to reanalyze?';
        assert.strictEqual(showInfoMessageStub.firstCall?.args[0], expectedMessage);
    });
    test('Notification cooldown - should respect time threshold', async () => {
        // Initial change
        await clock.tickAsync(1100);
        assert.ok(showInfoMessageStub.calledOnce);
        // Reset stub
        showInfoMessageStub.reset();
        // Try to notify again immediately
        await service['handleChanges'](150);
        assert.ok(!showInfoMessageStub.called, 'Should not notify during cooldown');
        // Advance time past cooldown
        await clock.tickAsync(31 * 60 * 1000);
        await service['handleChanges'](150);
        assert.ok(showInfoMessageStub.calledOnce, 'Should notify after cooldown');
    });
    test('Reanalysis - should update state and reset counter', async () => {
        // Trigger reanalysis
        await service['reanalyze']();
        // Verify state updates
        const globalState = mockContext.globalState;
        assert.ok(globalState.update.calledWith('lastAnalyzedCommit', 'test-commit'));
        assert.ok(globalState.update.calledWith('changeCount', 0));
        assert.ok(onReanalyzeRequestedStub.calledOnce);
    });
});
//# sourceMappingURL=ReminderService.test.js.map