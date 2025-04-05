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
const path = __importStar(require("path"));
const FileCollectionService_1 = require("../services/FileCollectionService");
suite('FileCollectionService Test Suite', () => {
    let workspaceRoot;
    let fileCollectionService;
    // Helper function to create test files and directories
    async function createTestFiles(files) {
        for (const file of files) {
            const fullPath = path.join(workspaceRoot, file.path);
            const dirPath = path.dirname(fullPath);
            // Create directory if it doesn't exist
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
            // Create file with content if specified
            if (file.content !== undefined) {
                await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), Buffer.from(file.content));
            }
        }
    }
    // Helper function to clean up test files
    async function cleanupTestFiles(files) {
        for (const file of files) {
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(path.join(workspaceRoot, file)), { recursive: true });
            }
            catch (e) {
                // Ignore errors if file doesn't exist
            }
        }
    }
    setup(async () => {
        // Create a temporary workspace for testing
        workspaceRoot = path.join(__dirname, '../../test-workspace');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(workspaceRoot));
        fileCollectionService = new FileCollectionService_1.FileCollectionService(workspaceRoot);
    });
    teardown(async () => {
        // Clean up the test workspace
        await vscode.workspace.fs.delete(vscode.Uri.file(workspaceRoot), { recursive: true });
    });
    test('Should collect all files when no .hanzoinclude exists', async () => {
        // Create test files
        const testFiles = [
            { path: 'src/index.ts', content: 'console.log("test");' },
            { path: 'src/utils/helper.ts', content: 'export const add = (a, b) => a + b;' },
            { path: 'package.json', content: '{ "name": "test" }' }
        ];
        await createTestFiles(testFiles);
        const files = await fileCollectionService.collectFiles();
        // Verify all files are collected
        assert.strictEqual(files.length, 3);
        assert.ok(files.some((f) => f.path === 'src/index.ts'));
        assert.ok(files.some((f) => f.path === 'src/utils/helper.ts'));
        assert.ok(files.some((f) => f.path === 'package.json'));
    });
    test('Should only collect files specified in .hanzoinclude', async () => {
        // Create test files including .hanzoinclude
        const testFiles = [
            { path: '.hanzoinclude', content: 'src/\npackage.json' },
            { path: 'src/index.ts', content: 'console.log("test");' },
            { path: 'src/utils/helper.ts', content: 'export const add = (a, b) => a + b;' },
            { path: 'package.json', content: '{ "name": "test" }' },
            { path: 'README.md', content: '# Test Project' }
        ];
        await createTestFiles(testFiles);
        const files = await fileCollectionService.collectFiles();
        // Verify only included files are collected
        assert.strictEqual(files.length, 3);
        assert.ok(files.some((f) => f.path === 'src/index.ts'));
        assert.ok(files.some((f) => f.path === 'src/utils/helper.ts'));
        assert.ok(files.some((f) => f.path === 'package.json'));
        assert.ok(!files.some((f) => f.path === 'README.md'));
    });
    test('Should support glob patterns in .hanzoinclude', async () => {
        // Create test files including .hanzoinclude with glob patterns
        const testFiles = [
            { path: '.hanzoinclude', content: '**/*.ts\npackage.json' },
            { path: 'src/index.ts', content: 'console.log("test");' },
            { path: 'src/utils/helper.ts', content: 'export const add = (a, b) => a + b;' },
            { path: 'test/test.ts', content: 'describe("test", () => {});' },
            { path: 'package.json', content: '{ "name": "test" }' },
            { path: 'src/styles.css', content: '.test { color: red; }' }
        ];
        await createTestFiles(testFiles);
        const files = await fileCollectionService.collectFiles();
        // Verify only .ts files and package.json are collected
        assert.strictEqual(files.length, 4);
        assert.ok(files.some((f) => f.path === 'src/index.ts'));
        assert.ok(files.some((f) => f.path === 'src/utils/helper.ts'));
        assert.ok(files.some((f) => f.path === 'test/test.ts'));
        assert.ok(files.some((f) => f.path === 'package.json'));
        assert.ok(!files.some((f) => f.path === 'src/styles.css'));
    });
    test('Should still apply ignore patterns when .hanzoinclude exists', async () => {
        // Create test files including both .hanzoinclude and files that should be ignored
        const testFiles = [
            { path: '.hanzoinclude', content: 'src/\nnode_modules/\n**/*.ts' },
            { path: 'src/index.ts', content: 'console.log("test");' },
            { path: 'node_modules/test/index.ts', content: 'module.exports = {};' },
            { path: 'src/large-file.ts', content: 'x'.repeat(1024 * 100) }, // 100KB file
            { path: 'src/image.jpg', content: 'fake-image-data' }
        ];
        await createTestFiles(testFiles);
        const files = await fileCollectionService.collectFiles();
        // Verify ignored patterns are still applied
        assert.ok(files.some((f) => f.path === 'src/index.ts'));
        assert.ok(!files.some((f) => f.path === 'node_modules/test/index.ts'));
        assert.ok(!files.some((f) => f.path === 'src/large-file.ts')); // Too large
        assert.ok(!files.some((f) => f.path === 'src/image.jpg')); // Media file
    });
    test('Should handle directory patterns in .hanzoinclude', async () => {
        // Create test files with directory patterns
        const testFiles = [
            { path: '.hanzoinclude', content: 'features/auth/\nfeatures/api/' },
            { path: 'features/auth/login.ts', content: 'export const login = () => {};' },
            { path: 'features/auth/utils/helper.ts', content: 'export const hash = () => {};' },
            { path: 'features/api/endpoints.ts', content: 'export const api = {};' },
            { path: 'features/other/stuff.ts', content: 'export const other = {};' }
        ];
        await createTestFiles(testFiles);
        const files = await fileCollectionService.collectFiles();
        // Verify only files in specified directories are collected
        assert.ok(files.some((f) => f.path === 'features/auth/login.ts'));
        assert.ok(files.some((f) => f.path === 'features/auth/utils/helper.ts'));
        assert.ok(files.some((f) => f.path === 'features/api/endpoints.ts'));
        assert.ok(!files.some((f) => f.path === 'features/other/stuff.ts'));
    });
    test('Should handle comments in .hanzoinclude', async () => {
        // Create test files with commented patterns
        const testFiles = [
            { path: '.hanzoinclude', content: '# Include source files\nsrc/\n# Include config\npackage.json\n# Excluded by comment\n# README.md' },
            { path: 'src/index.ts', content: 'console.log("test");' },
            { path: 'package.json', content: '{ "name": "test" }' },
            { path: 'README.md', content: '# Test Project' }
        ];
        await createTestFiles(testFiles);
        const files = await fileCollectionService.collectFiles();
        // Verify commented patterns are ignored
        assert.ok(files.some((f) => f.path === 'src/index.ts'));
        assert.ok(files.some((f) => f.path === 'package.json'));
        assert.ok(!files.some((f) => f.path === 'README.md'));
    });
});
//# sourceMappingURL=fileCollection.test.js.map