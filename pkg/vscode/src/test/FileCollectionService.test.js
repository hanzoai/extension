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
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const extension_1 = require("../extension");
const chai_1 = require("chai");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
// Create a mock VS Code workspace filesystem
const mockVsCodeFs = {
    stat: async (uri) => {
        const filePath = uri.fsPath;
        const stats = fs.statSync(filePath);
        return {
            type: stats.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: stats.ctimeMs,
            mtime: stats.mtimeMs,
            size: stats.size
        };
    },
    readFile: async (uri) => {
        return Buffer.from(fs.readFileSync(uri.fsPath));
    },
    readDirectory: async (uri) => {
        const entries = fs.readdirSync(uri.fsPath, { withFileTypes: true });
        return entries.map(entry => [
            entry.name,
            entry.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
        ]);
    }
};
// Mock the VS Code workspace
const mockWorkspace = {
    workspaceFolders: undefined,
    fs: mockVsCodeFs
};
// Replace vscode.workspace with our mock
vscode.workspace = mockWorkspace;
suite('FileCollectionService Test Suite', () => {
    let workspaceRoot;
    let service;
    setup(async () => {
        // Create a temporary workspace
        workspaceRoot = path.join(os.tmpdir(), 'test-workspace-' + Math.random().toString(36).substring(7));
        fs.mkdirSync(workspaceRoot);
        service = new extension_1.FileCollectionService(workspaceRoot);
    });
    teardown(() => {
        // Clean up temporary workspace
        if (fs.existsSync(workspaceRoot)) {
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });
    test('should never ignore src directory', async () => {
        // Create src directory with a file
        const srcDir = path.join(workspaceRoot, 'src');
        fs.mkdirSync(srcDir);
        fs.writeFileSync(path.join(srcDir, 'test.ts'), 'console.log("test");');
        const files = await service.collectFiles();
        const srcNode = files.find((node) => node.path === 'src');
        (0, chai_1.expect)(srcNode).to.exist;
        (0, chai_1.expect)(srcNode?.type).to.equal('directory');
        (0, chai_1.expect)(srcNode?.children).to.have.lengthOf(1);
        (0, chai_1.expect)(srcNode?.children?.[0].path).to.equal('src/test.ts');
    });
    test('should respect file size limits', async () => {
        // Create a file larger than 50KB
        const largeContent = Buffer.alloc(60 * 1024).fill('a').toString();
        fs.writeFileSync(path.join(workspaceRoot, 'large.txt'), largeContent);
        const files = await service.collectFiles();
        const largeFile = files.find((node) => node.path === 'large.txt');
        (0, chai_1.expect)(largeFile?.content).to.equal('[File too large to process]');
    });
    test('should handle .gitignore patterns', async () => {
        // Create .gitignore
        fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), 'ignored.txt\n/direct-ignore.txt\nignored-dir/');
        // Create files that should be ignored
        fs.writeFileSync(path.join(workspaceRoot, 'ignored.txt'), 'should be ignored');
        fs.writeFileSync(path.join(workspaceRoot, 'direct-ignore.txt'), 'should be ignored');
        fs.mkdirSync(path.join(workspaceRoot, 'ignored-dir'));
        fs.writeFileSync(path.join(workspaceRoot, 'ignored-dir', 'file.txt'), 'should be ignored');
        // Create a file that shouldn't be ignored
        fs.writeFileSync(path.join(workspaceRoot, 'not-ignored.txt'), 'should not be ignored');
        const files = await service.collectFiles();
        const paths = files.map((f) => f.path);
        (0, chai_1.expect)(paths).to.not.include('ignored.txt');
        (0, chai_1.expect)(paths).to.not.include('direct-ignore.txt');
        (0, chai_1.expect)(paths).to.not.include('ignored-dir');
        (0, chai_1.expect)(paths).to.include('not-ignored.txt');
    });
    test('should calculate directory sizes correctly', async () => {
        // Create a directory with some files
        const testDir = path.join(workspaceRoot, 'test-dir');
        fs.mkdirSync(testDir);
        fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content1');
        fs.writeFileSync(path.join(testDir, 'file2.txt'), 'content2');
        await service.collectFiles();
        const report = service.getDirectorySizeReport();
        (0, chai_1.expect)(report).to.include('test-dir');
        (0, chai_1.expect)(report).to.include('2 files');
        (0, chai_1.expect)(report).to.include('KB');
    });
    test('should always process TypeScript files', async () => {
        // Create a .gitignore that would normally ignore .ts files
        fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '*.ts');
        // Create a TypeScript file
        fs.writeFileSync(path.join(workspaceRoot, 'test.ts'), 'const x: number = 42;');
        const files = await service.collectFiles();
        const tsFile = files.find((f) => f.path === 'test.ts');
        (0, chai_1.expect)(tsFile).to.exist;
        (0, chai_1.expect)(tsFile?.content).to.include('const x: number = 42;');
    });
});
//# sourceMappingURL=FileCollectionService.test.js.map