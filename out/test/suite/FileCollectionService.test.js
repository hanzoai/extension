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
const FileCollectionService_1 = require("../../services/FileCollectionService");
console.log('Setting up mock file system...');
// Mock workspace structure
const mockFiles = new Map([
    ['src/index.ts', 'console.log("Hello");'],
    ['src/utils/helper.ts', 'export const add = (a: number, b: number) => a + b;'],
    ['README.md', '# Test Project'],
    ['node_modules/package/index.js', 'module.exports = {};'],
    ['.gitignore', 'node_modules/\n*.log\ndist/'],
    ['large_file.txt', 'x'.repeat(1024 * 100)], // 100KB file
    ['dist/bundle.js', 'console.log("bundle");'],
    ['src/test.log', 'test log file'],
    ['test.log', 'another log file'], // Should be ignored due to .gitignore
]);
console.log(`Initialized mock files: ${mockFiles.size} files in total`);
// Mock workspace root
const mockWorkspaceRoot = '/mock/workspace';
console.log(`Mock workspace root: ${mockWorkspaceRoot}`);
// Mock VSCode workspace API
const mockWorkspace = {
    fs: {
        readFile: async (uri) => {
            const relativePath = path.relative(mockWorkspaceRoot, uri.fsPath).replace(/\\/g, '/');
            console.log(`[Mock readFile] Reading file: ${relativePath}`);
            const content = mockFiles.get(relativePath);
            if (content === undefined) {
                console.log(`[Mock readFile] File not found: ${relativePath}`);
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            console.log(`[Mock readFile] Successfully read file: ${relativePath}, size: ${content.length} bytes`);
            return Buffer.from(content);
        },
        stat: async (uri) => {
            const relativePath = path.relative(mockWorkspaceRoot, uri.fsPath).replace(/\\/g, '/');
            console.log(`[Mock stat] Getting stats for: ${relativePath}`);
            const content = mockFiles.get(relativePath);
            if (content === undefined) {
                console.log(`[Mock stat] File not found: ${relativePath}`);
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            console.log(`[Mock stat] File stats - size: ${content.length} bytes`);
            return {
                type: vscode.FileType.File,
                size: content.length,
                ctime: Date.now(),
                mtime: Date.now()
            };
        },
        readDirectory: async (uri) => {
            const basePath = path.relative(mockWorkspaceRoot, uri.fsPath).replace(/\\/g, '/');
            console.log(`[Mock readDirectory] Reading directory: ${basePath || 'root'}`);
            const entries = new Map();
            for (const [filePath] of mockFiles.entries()) {
                if (filePath.startsWith(basePath ? `${basePath}/` : '')) {
                    const relativePath = filePath.slice(basePath ? basePath.length + 1 : 0);
                    const firstSegment = relativePath.split('/')[0];
                    if (!firstSegment) {
                        console.log(`[Mock readDirectory] Skipping empty segment for path: ${filePath}`);
                        continue;
                    }
                    const isDirectory = relativePath.includes('/');
                    console.log(`[Mock readDirectory] Found entry: ${firstSegment} (${isDirectory ? 'Directory' : 'File'})`);
                    entries.set(firstSegment, isDirectory ? vscode.FileType.Directory : vscode.FileType.File);
                }
            }
            const result = Array.from(entries.entries());
            console.log(`[Mock readDirectory] Directory ${basePath || 'root'} contains ${result.length} entries`);
            return result;
        }
    }
};
// Replace vscode.workspace.fs with our mock
Object.defineProperty(vscode.workspace, 'fs', {
    value: mockWorkspace.fs,
    configurable: true,
    writable: true
});
console.log('Mock workspace API initialized');
suite('FileCollectionService Test Suite', () => {
    let service;
    let originalMockFiles;
    setup(() => {
        console.log('\n=== Test Setup ===');
        originalMockFiles = new Map(mockFiles); // Preserve original state
        service = new FileCollectionService_1.FileCollectionService(mockWorkspaceRoot);
        console.log('FileCollectionService initialized with mock workspace root');
    });
    teardown(() => {
        mockFiles.clear();
        originalMockFiles.forEach((v, k) => mockFiles.set(k, v));
    });
    test('should collect root level files and directories', async () => {
        console.log('\n=== Test: Root Level Collection ===');
        console.log('Starting file collection...');
        const files = await service.collectFiles();
        console.log(`Total files collected: ${files.length}`);
        const rootEntries = files.filter(f => !f.path.includes('/') || f.path.split('/').length === 1);
        console.log(`Root level entries found: ${rootEntries.length}`);
        console.log('Root entries:', rootEntries.map(e => ({ path: e.path, type: e.type })));
        // Logging ignored files check
        const ignoredFiles = ['test.log', 'node_modules', 'large_file.txt'];
        ignoredFiles.forEach(file => {
            const found = rootEntries.some(f => f.path === file);
            console.log(`Checking ignored file "${file}": ${found ? 'INCORRECTLY INCLUDED' : 'correctly excluded'}`);
        });
        assert.ok(rootEntries.length > 0, 'Should have root level entries');
        assert.ok(!rootEntries.some(f => f.path === 'test.log'), 'Should not include ignored .log files');
        assert.ok(!rootEntries.some(f => f.path === 'node_modules'), 'Should not include node_modules');
        assert.ok(!rootEntries.some(f => f.path === 'large_file.txt'), 'Should not include large files');
    });
    test('should collect nested files based on ignore patterns', async () => {
        console.log('\n=== Test: Nested Files Collection ===');
        console.log('Starting nested file collection...');
        const files = await service.collectFiles();
        console.log(`Total files and directories collected: ${files.length}`);
        const allPaths = files.reduce((acc, file) => {
            if (file.type === 'directory' && file.children) {
                console.log(`Processing directory: ${file.path} with ${file.children.length} children`);
                return [...acc, file.path, ...file.children.map(c => c.path)];
            }
            return [...acc, file.path];
        }, []);
        console.log('All collected paths:', allPaths);
        // Detailed ignore pattern checking
        const ignoredPatterns = ['node_modules/', 'test.log', 'dist/bundle.js', 'src/test.log'];
        ignoredPatterns.forEach(pattern => {
            const matchingPaths = allPaths.filter(p => p.includes(pattern));
            console.log(`Checking ignored pattern "${pattern}":`, matchingPaths.length ? `FOUND MATCHES: ${matchingPaths.join(', ')}` : 'correctly excluded');
        });
        assert.ok(!allPaths.some(p => p.startsWith('node_modules/')), 'Should not include node_modules');
        assert.ok(!allPaths.includes('test.log'), 'Should not include .log files');
        assert.ok(!allPaths.includes('dist/bundle.js'), 'Should not include dist directory');
        assert.ok(!allPaths.includes('src/test.log'), 'Should not include .log files in any directory');
    });
    test('should collect nested src files', async () => {
        const files = await service.collectFiles();
        const srcDir = files.find(f => f.path === 'src');
        assert.ok(srcDir, 'Should have src directory');
        assert.strictEqual(srcDir.type, 'directory', 'src should be a directory');
        assert.ok(srcDir.children, 'src should have children');
        // Find utils directory in src
        const utilsDir = srcDir.children.find(f => f.path === 'src/utils');
        assert.ok(utilsDir, 'Should have utils directory');
        assert.strictEqual(utilsDir.type, 'directory', 'utils should be a directory');
        // Check utils/helper.ts
        assert.ok(utilsDir.children, 'utils should have children');
        const helperFile = utilsDir.children[0];
        assert.strictEqual(helperFile.path, 'src/utils/helper.ts', 'Should have helper.ts');
        assert.strictEqual(helperFile.content, 'export const add = (a: number, b: number) => a + b;', 'Content should match');
    });
    test('should maintain correct file types', async () => {
        const files = await service.collectFiles();
        // Check each file's type
        const allFiles = files.reduce((acc, file) => {
            if (file.type === 'directory' && file.children) {
                return [...acc, file, ...file.children];
            }
            return [...acc, file];
        }, []);
        // All .ts files should be files, not directories
        const tsFiles = allFiles.filter(f => f.path.endsWith('.ts'));
        assert.ok(tsFiles.every(f => f.type === 'file'), 'All .ts files should be of type file');
        // src and utils should be directories
        const dirs = allFiles.filter(f => f.type === 'directory');
        assert.ok(dirs.some(d => d.path === 'src'), 'src should be a directory');
        assert.ok(dirs.some(d => d.path === 'src/utils'), 'utils should be a directory');
    });
    test('should respect file size limits', async () => {
        const files = await service.collectFiles();
        const allFiles = files.reduce((acc, file) => {
            if (file.type === 'directory' && file.children) {
                return [...acc, file, ...file.children];
            }
            return [...acc, file];
        }, []);
        // Large files should be completely ignored
        const largeFile = allFiles.find(f => f.path === 'large_file.txt');
        assert.ok(!largeFile, 'Large file should be ignored');
    });
    test('should generate correct directory size report', async () => {
        console.log('\n=== Test: Directory Size Report ===');
        console.log('Collecting files for size report...');
        await service.collectFiles();
        console.log('Generating directory size report...');
        const report = service.getDirectorySizeReport();
        console.log('Directory size report:', report);
        // Parse and log individual directory sizes
        const lines = report.split('\n');
        lines.forEach(line => {
            if (line.includes(':')) {
                const [dir, stats] = line.split(':');
                console.log(`Directory "${dir}" stats: ${stats.trim()}`);
            }
        });
        assert.ok(report.includes('Directory sizes'), 'Report should have header');
        assert.ok(report.includes('src:'), 'Report should include src directory');
        assert.ok(report.includes('KB'), 'Report should include size units');
        assert.ok(report.includes('files)'), 'Report should include file count');
    });
    test('should calculate total size correctly', async () => {
        await service.collectFiles();
        const totalSize = service.getTotalSize();
        assert.ok(totalSize > 0, 'Total size should be greater than 0');
        assert.ok(typeof totalSize === 'number', 'Total size should be a number');
    });
    test('should handle errors gracefully', async () => {
        console.log('\n=== Test: Error Handling ===');
        console.log('Adding invalid file to mock system...');
        mockFiles.set('error.txt', undefined);
        console.log('Starting file collection with invalid file...');
        const files = await service.collectFiles();
        const allFiles = files.reduce((acc, file) => {
            if (file.type === 'directory' && file.children) {
                console.log(`Processing directory: ${file.path} with ${file.children.length} children`);
                return [...acc, file, ...file.children];
            }
            return [...acc, file];
        }, []);
        console.log(`Total files collected despite error: ${allFiles.length}`);
        console.log('Valid files found:', allFiles.map(f => f.path));
        assert.ok(allFiles.length > 0, 'Should still collect valid files');
        assert.ok(allFiles.some(f => f.path === 'src/index.ts'), 'Should include valid files');
    });
    test('should respect .hanzoignore patterns when present', async () => {
        console.log('\n=== Test: .hanzoignore Handling ===');
        // Add temporary .hanzoignore
        mockFiles.set('.hanzoignore', 'src/services/**\nsrc/test/**');
        const files = await service.collectFiles();
        const allPaths = flattenFiles(files);
        // Verify that files in src/services and src/test are ignored
        assert.strictEqual(allPaths.some(p => p.startsWith('src/services/')), false, 'src/services should be ignored');
        assert.strictEqual(allPaths.some(p => p.startsWith('src/test/')), false, 'src/test should be ignored');
        assert.strictEqual(allPaths.includes('src/index.ts'), true, 'src/index.ts should be included');
        // But other src files should still be included
        assert.strictEqual(allPaths.some(p => p.startsWith('src/') && !p.startsWith('src/services/') && !p.startsWith('src/test/')), true, 'other src files should be included');
        // Clean up
        mockFiles.delete('.hanzoignore');
    });
    test('should show detailed file inclusion/exclusion information', async () => {
        console.log('\n=== Test: Detailed File Processing ===');
        // Add some test files with different patterns
        mockFiles.set('src/index.ts', 'console.log("Hello");');
        mockFiles.set('src/utils/helper.ts', 'export const add = (a: number, b: number) => a + b;');
        mockFiles.set('src/test/test.spec.ts', 'describe("test", () => {});');
        mockFiles.set('node_modules/package/index.js', 'module.exports = {};');
        mockFiles.set('.env', 'SECRET=123');
        mockFiles.set('build/output.js', 'console.log("built");');
        mockFiles.set('images/logo.png', 'binary-data');
        mockFiles.set('.gitignore', 'node_modules/\n*.log\ndist/\nbuild/');
        mockFiles.set('.hanzoignore', 'src/test/**\nimages/**');
        const service = new FileCollectionService_1.FileCollectionService(mockWorkspaceRoot);
        console.log('\nCollecting files with detailed logging:');
        const files = await service.collectFiles();
        // The detailed logging will be shown in the console output
    });
    test('should respect nested .gitignore files', async () => {
        console.log('\n=== Test: Nested .gitignore Handling ===');
        // Clear and set up a new mock file system with nested .gitignore files
        mockFiles.clear();
        // Root level files and .gitignore
        mockFiles.set('README.md', '# Project');
        mockFiles.set('.gitignore', 'node_modules/\n*.log\ndist/');
        mockFiles.set('root.log', 'root log file'); // Should be ignored by root .gitignore
        // src directory with its own .gitignore
        mockFiles.set('src/index.ts', 'console.log("Hello");');
        mockFiles.set('src/.gitignore', '*.json\n/temp/'); // Ignores JSON files in src and the temp directory
        mockFiles.set('src/config.json', '{"key": "value"}'); // Should be ignored by src/.gitignore
        mockFiles.set('src/utils/helper.ts', 'export const add = (a, b) => a + b;');
        mockFiles.set('src/utils/config.json', '{"util": true}'); // Should be ignored by src/.gitignore
        mockFiles.set('src/temp/temp.ts', 'console.log("temp");'); // Should be ignored by src/.gitignore
        // components directory with its own .gitignore
        mockFiles.set('components/Button.tsx', 'export const Button = () => <button>Click</button>;');
        mockFiles.set('components/.gitignore', '*.css\n*.scss'); // Ignores CSS and SCSS files
        mockFiles.set('components/Button.css', '.button { color: blue; }'); // Should be ignored by components/.gitignore
        mockFiles.set('components/nested/Icon.tsx', 'export const Icon = () => <svg></svg>;');
        mockFiles.set('components/nested/Icon.scss', '.icon { size: 24px; }'); // Should be ignored by components/.gitignore
        console.log('Mock file system set up with nested .gitignore files');
        console.log('Files in mock system:', Array.from(mockFiles.keys()));
        const service = new FileCollectionService_1.FileCollectionService(mockWorkspaceRoot);
        console.log('\nCollecting files with nested .gitignore handling:');
        const files = await service.collectFiles();
        const allPaths = flattenFiles(files);
        console.log('All collected paths:', allPaths);
        // Test root level .gitignore
        assert.ok(!allPaths.includes('root.log'), 'root.log should be ignored by root .gitignore');
        assert.ok(allPaths.includes('README.md'), 'README.md should be included');
        // Test src/.gitignore
        assert.ok(allPaths.includes('src/index.ts'), 'src/index.ts should be included');
        assert.ok(!allPaths.includes('src/config.json'), 'src/config.json should be ignored by src/.gitignore');
        assert.ok(!allPaths.includes('src/utils/config.json'), 'src/utils/config.json should be ignored by src/.gitignore');
        assert.ok(!allPaths.includes('src/temp/temp.ts'), 'src/temp/temp.ts should be ignored by src/.gitignore');
        assert.ok(allPaths.includes('src/utils/helper.ts'), 'src/utils/helper.ts should be included');
        // Test components/.gitignore
        assert.ok(allPaths.includes('components/Button.tsx'), 'components/Button.tsx should be included');
        assert.ok(!allPaths.includes('components/Button.css'), 'components/Button.css should be ignored by components/.gitignore');
        assert.ok(allPaths.includes('components/nested/Icon.tsx'), 'components/nested/Icon.tsx should be included');
        assert.ok(!allPaths.includes('components/nested/Icon.scss'), 'components/nested/Icon.scss should be ignored by components/.gitignore');
    });
    test('should handle complex nested .gitignore scenarios', async () => {
        console.log('\n=== Test: Complex Nested .gitignore Scenarios ===');
        // Clear and set up a new mock file system with complex nested .gitignore scenarios
        mockFiles.clear();
        // Root level files and .gitignore
        mockFiles.set('README.md', '# Project');
        mockFiles.set('.gitignore', '*.log\n!important.log\ndist/');
        mockFiles.set('regular.log', 'regular log file'); // Should be ignored by root .gitignore
        mockFiles.set('important.log', 'important log file'); // Should be included despite *.log pattern due to negation
        // Deeply nested directories with .gitignore at multiple levels
        mockFiles.set('src/index.ts', 'console.log("Hello");');
        mockFiles.set('src/.gitignore', 'build/\n*.min.js');
        mockFiles.set('src/app.min.js', 'minified code'); // Should be ignored by src/.gitignore
        // Level 1 nested directory
        mockFiles.set('src/components/Button.tsx', 'export const Button = () => <button>Click</button>;');
        mockFiles.set('src/components/.gitignore', '*.test.*\n*.spec.*');
        mockFiles.set('src/components/Button.test.tsx', 'test("button", () => {});'); // Should be ignored by src/components/.gitignore
        mockFiles.set('src/components/Button.css', '.button { color: blue; }'); // Should be included
        // Directory with a .gitignore that uses complex patterns
        mockFiles.set('lib/index.js', 'module.exports = {};');
        mockFiles.set('lib/.gitignore', '**/node_modules/\n**/dist/\n**/*.min.*\n!**/vendor/**/*.min.js');
        mockFiles.set('lib/utils/helper.js', 'function helper() {}');
        mockFiles.set('lib/utils/helper.min.js', 'function helper(){}'); // Should be ignored by lib/.gitignore
        mockFiles.set('lib/vendor/jquery.min.js', 'jQuery library'); // Should be included despite *.min.* pattern due to negation
        mockFiles.set('lib/node_modules/package/index.js', 'module.exports = {};'); // Should be ignored by lib/.gitignore
        console.log('Mock file system set up with complex nested .gitignore scenarios');
        console.log('Files in mock system:', Array.from(mockFiles.keys()));
        const service = new FileCollectionService_1.FileCollectionService(mockWorkspaceRoot);
        console.log('\nCollecting files with complex nested .gitignore handling:');
        const files = await service.collectFiles();
        const allPaths = flattenFiles(files);
        console.log('All collected paths:', allPaths);
        // Test root level .gitignore with negation
        assert.ok(!allPaths.includes('regular.log'), 'regular.log should be ignored by root .gitignore');
        assert.ok(allPaths.includes('important.log'), 'important.log should be included despite *.log pattern due to negation');
        // Test src/.gitignore
        assert.ok(allPaths.includes('src/index.ts'), 'src/index.ts should be included');
        assert.ok(!allPaths.includes('src/app.min.js'), 'src/app.min.js should be ignored by src/.gitignore');
        // Test level 1 nested .gitignore
        assert.ok(allPaths.includes('src/components/Button.tsx'), 'src/components/Button.tsx should be included');
        assert.ok(!allPaths.includes('src/components/Button.test.tsx'), 'src/components/Button.test.tsx should be ignored by src/components/.gitignore');
        assert.ok(allPaths.includes('src/components/Button.css'), 'src/components/Button.css should be included');
        // Test complex patterns in lib/.gitignore
        assert.ok(allPaths.includes('lib/index.js'), 'lib/index.js should be included');
        assert.ok(allPaths.includes('lib/utils/helper.js'), 'lib/utils/helper.js should be included');
        assert.ok(!allPaths.includes('lib/utils/helper.min.js'), 'lib/utils/helper.min.js should be ignored by lib/.gitignore');
        assert.ok(allPaths.includes('lib/vendor/jquery.min.js'), 'lib/vendor/jquery.min.js should be included despite *.min.* pattern due to negation');
        assert.ok(!allPaths.includes('lib/node_modules/package/index.js'), 'lib/node_modules/package/index.js should be ignored by lib/.gitignore');
    });
    test('should handle many nested .gitignore files efficiently', async () => {
        console.log('\n=== Test: Many Nested .gitignore Files ===');
        // Clear and set up a new mock file system with many nested .gitignore files
        mockFiles.clear();
        // Root level files and .gitignore
        mockFiles.set('README.md', '# Project');
        mockFiles.set('.gitignore', '*.log\nnode_modules/');
        // Create a deep directory structure with .gitignore files at each level
        const createNestedStructure = (basePath, depth) => {
            if (depth <= 0) {
                return;
            }
            // Add a .gitignore file at this level
            mockFiles.set(`${basePath}/.gitignore`, `*.level${depth}\n`);
            // Add some files that should be included
            mockFiles.set(`${basePath}/index.js`, `console.log("Level ${depth}");`);
            // Add a file that should be ignored by this level's .gitignore
            mockFiles.set(`${basePath}/ignored.level${depth}`, `This should be ignored at level ${depth}`);
            // Add a file that should be ignored by a parent .gitignore
            if (depth % 2 === 0) {
                mockFiles.set(`${basePath}/test.log`, `Log at level ${depth}`);
            }
            // Create subdirectories
            createNestedStructure(`${basePath}/subdir-a`, depth - 1);
            createNestedStructure(`${basePath}/subdir-b`, depth - 1);
        };
        // Create a structure with 5 levels of nesting
        createNestedStructure('project', 5);
        console.log('Mock file system set up with many nested .gitignore files');
        console.log(`Total files in mock system: ${mockFiles.size}`);
        const service = new FileCollectionService_1.FileCollectionService(mockWorkspaceRoot);
        console.log('\nCollecting files with many nested .gitignore files:');
        const startTime = Date.now();
        const files = await service.collectFiles();
        const endTime = Date.now();
        console.log(`File collection completed in ${endTime - startTime}ms`);
        const allPaths = flattenFiles(files);
        console.log(`Total paths collected: ${allPaths.length}`);
        // Verify that files are correctly included/excluded
        // All index.js files should be included
        const indexFiles = allPaths.filter(p => p.endsWith('index.js'));
        console.log(`Found ${indexFiles.length} index.js files`);
        assert.ok(indexFiles.length > 0, 'Should include index.js files');
        // No *.levelX files should be included
        const levelFiles = allPaths.filter(p => /\.level\d$/.test(p));
        console.log(`Found ${levelFiles.length} level files (should be 0)`);
        assert.strictEqual(levelFiles.length, 0, 'Should not include any *.levelX files');
        // No *.log files should be included (from root .gitignore)
        const logFiles = allPaths.filter(p => p.endsWith('.log'));
        console.log(`Found ${logFiles.length} log files (should be 0)`);
        assert.strictEqual(logFiles.length, 0, 'Should not include any *.log files');
        // Verify that the collection was efficient
        assert.ok(endTime - startTime < 5000, 'File collection should complete in a reasonable time');
    });
});
// Helper function to flatten file structure
function flattenFiles(nodes) {
    return nodes.reduce((acc, node) => {
        acc.push(node.path);
        if (node.type === 'directory' && node.children) {
            acc.push(...flattenFiles(node.children));
        }
        return acc;
    }, []);
}
//# sourceMappingURL=FileCollectionService.test.js.map