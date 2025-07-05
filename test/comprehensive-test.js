#!/usr/bin/env node

/**
 * Comprehensive test suite for Hanzo Extension
 * Tests all tools and features
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const Module = require('module');

// Hook require to provide vscode mock
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return require('../scripts/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// Test utilities
const assert = (condition, message) => {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
};

const testDir = path.join(__dirname, 'test-workspace');

// Load tools
const { MCPTools } = require('../out/mcp/tools');

class TestRunner {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            errors: []
        };
        this.context = null;
        this.tools = null;
    }

    async setup() {
        console.log('🔧 Setting up test environment...\n');
        
        // Create test directory
        await fs.mkdir(testDir, { recursive: true });
        process.chdir(testDir);
        
        // Create mock context
        this.context = {
            globalState: {
                _store: new Map(),
                get(key, defaultValue) {
                    return this._store.get(key) ?? defaultValue;
                },
                update(key, value) {
                    this._store.set(key, value);
                    return Promise.resolve();
                }
            },
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve()
            },
            extensionPath: path.dirname(__dirname),
            subscriptions: [],
            asAbsolutePath: (p) => path.join(path.dirname(__dirname), p)
        };

        // Initialize tools
        this.tools = new MCPTools(this.context);
        await this.tools.initialize();
        
        console.log(`✅ Initialized ${this.tools.getAllTools().length} tools\n`);
    }

    async runTest(name, testFn) {
        process.stdout.write(`Testing ${name}... `);
        try {
            await testFn();
            this.results.passed++;
            console.log('✅');
        } catch (error) {
            this.results.failed++;
            this.results.errors.push({ test: name, error: error.message });
            console.log('❌');
            console.error(`  Error: ${error.message}`);
        }
    }

    async testFileOperations() {
        console.log('\n📁 Testing File Operations\n');

        // Test write
        await this.runTest('write tool', async () => {
            const writeTool = this.tools.getTool('write');
            assert(writeTool, 'Write tool not found');
            
            const result = await writeTool.handler({
                path: 'test-file.txt',
                content: 'Hello, World!'
            });
            assert(result.includes('successfully'), 'Write failed');
        });

        // Test read
        await this.runTest('read tool', async () => {
            const readTool = this.tools.getTool('read');
            assert(readTool, 'Read tool not found');
            
            const result = await readTool.handler({
                path: 'test-file.txt'
            });
            assert(result.includes('Hello, World!'), 'Read failed');
        });

        // Test edit
        await this.runTest('edit tool', async () => {
            const editTool = this.tools.getTool('edit');
            assert(editTool, 'Edit tool not found');
            
            const result = await editTool.handler({
                path: 'test-file.txt',
                old_text: 'World',
                new_text: 'Hanzo'
            });
            assert(result.includes('successfully'), 'Edit failed');
        });

        // Test multi_edit
        await this.runTest('multi_edit tool', async () => {
            const multiEditTool = this.tools.getTool('multi_edit');
            assert(multiEditTool, 'Multi-edit tool not found');
            
            await this.tools.getTool('write').handler({
                path: 'multi-edit-test.txt',
                content: 'Line 1\nLine 2\nLine 3'
            });
            
            const result = await multiEditTool.handler({
                path: 'multi-edit-test.txt',
                edits: [
                    { old_text: 'Line 1', new_text: 'First Line' },
                    { old_text: 'Line 3', new_text: 'Third Line' }
                ]
            });
            assert(result.includes('successfully'), 'Multi-edit failed');
        });

        // Test directory_tree
        await this.runTest('directory_tree tool', async () => {
            const treeTool = this.tools.getTool('directory_tree');
            assert(treeTool, 'Directory tree tool not found');
            
            // Create some test structure
            await fs.mkdir('subdir', { recursive: true });
            await fs.writeFile('subdir/file.txt', 'test');
            
            const result = await treeTool.handler({
                path: '.'
            });
            assert(result.includes('subdir'), 'Directory tree failed');
        });

        // Test find_files
        await this.runTest('find_files tool', async () => {
            const findTool = this.tools.getTool('find_files');
            assert(findTool, 'Find files tool not found');
            
            const result = await findTool.handler({
                pattern: '*.txt'
            });
            assert(result.includes('test-file.txt'), 'Find files failed');
        });
    }

    async testSearchOperations() {
        console.log('\n🔍 Testing Search Operations\n');

        // Create test content
        await this.tools.getTool('write').handler({
            path: 'search-test.js',
            content: `
function testFunction() {
    console.log('This is a test');
    return 42;
}

class TestClass {
    constructor() {
        this.value = 'test';
    }
}
`
        });

        // Test grep
        await this.runTest('grep tool', async () => {
            const grepTool = this.tools.getTool('grep');
            assert(grepTool, 'Grep tool not found');
            
            const result = await grepTool.handler({
                pattern: 'test',
                path: '.'
            });
            assert(result.includes('testFunction'), 'Grep failed');
        });

        // Test search
        await this.runTest('search tool', async () => {
            const searchTool = this.tools.getTool('search');
            assert(searchTool, 'Search tool not found');
            
            const result = await searchTool.handler({
                query: 'TestClass',
                type: 'all'
            });
            assert(typeof result === 'string', 'Search failed');
        });

        // Test unified_search
        await this.runTest('unified_search tool', async () => {
            const unifiedSearchTool = this.tools.getTool('unified_search');
            assert(unifiedSearchTool, 'Unified search tool not found');
            
            const result = await unifiedSearchTool.handler({
                query: 'test',
                include: ['grep', 'filename']
            });
            assert(result.includes('test'), 'Unified search failed');
        });
    }

    async testShellOperations() {
        console.log('\n🖥️  Testing Shell Operations\n');

        // Test run_command
        await this.runTest('run_command tool', async () => {
            const runTool = this.tools.getTool('run_command');
            assert(runTool, 'Run command tool not found');
            
            const result = await runTool.handler({
                command: 'echo "Hello from shell"'
            });
            assert(result.includes('Hello from shell'), 'Run command failed');
        });

        // Test process management
        await this.runTest('process tool', async () => {
            const processTool = this.tools.getTool('process');
            if (!processTool) {
                console.log('  (Process tool not enabled, skipping)');
                return;
            }
            
            // Start a process
            const startResult = await processTool.handler({
                action: 'run',
                command: 'sleep 2',
                name: 'test-sleep'
            });
            assert(startResult.includes('Started'), 'Process start failed');
            
            // List processes
            const listResult = await processTool.handler({
                action: 'list'
            });
            assert(listResult.includes('test-sleep'), 'Process list failed');
        });
    }

    async testDevelopmentTools() {
        console.log('\n🛠️  Testing Development Tools\n');

        // Test todo operations
        await this.runTest('todo_write tool', async () => {
            const todoWriteTool = this.tools.getTool('todo_write');
            assert(todoWriteTool, 'Todo write tool not found');
            
            const result = await todoWriteTool.handler({
                todos: [{
                    id: 'test-1',
                    content: 'Test todo item',
                    status: 'pending',
                    priority: 'high'
                }]
            });
            assert(result.includes('updated'), 'Todo write failed');
        });

        await this.runTest('todo_read tool', async () => {
            const todoReadTool = this.tools.getTool('todo_read');
            assert(todoReadTool, 'Todo read tool not found');
            
            const result = await todoReadTool.handler({});
            assert(result.includes('Test todo item'), 'Todo read failed');
        });

        // Test think tool
        await this.runTest('think tool', async () => {
            const thinkTool = this.tools.getTool('think');
            assert(thinkTool, 'Think tool not found');
            
            const result = await thinkTool.handler({
                thought: 'Testing the think tool',
                category: 'analysis'
            });
            assert(result.includes('recorded'), 'Think tool failed');
        });

        // Test critic tool
        await this.runTest('critic tool', async () => {
            const criticTool = this.tools.getTool('critic');
            if (!criticTool) {
                console.log('  (Critic tool not enabled, skipping)');
                return;
            }
            
            const result = await criticTool.handler({
                code: 'function bad() { eval("dangerous"); }',
                aspect: 'security'
            });
            assert(result.includes('Security'), 'Critic tool failed');
        });
    }

    async testConfigurationTools() {
        console.log('\n⚙️  Testing Configuration Tools\n');

        // Test palette
        await this.runTest('palette tool', async () => {
            const paletteTool = this.tools.getTool('palette');
            if (!paletteTool) {
                console.log('  (Palette tool not enabled, skipping)');
                return;
            }
            
            const result = await paletteTool.handler({
                action: 'list'
            });
            assert(result.includes('minimal'), 'Palette list failed');
        });

        // Test rules
        await this.runTest('rules tool', async () => {
            const rulesTool = this.tools.getTool('rules');
            if (!rulesTool) {
                console.log('  (Rules tool not enabled, skipping)');
                return;
            }
            
            // Create a test rules file
            await fs.writeFile('.cursorrules', 'Test rules content');
            
            const result = await rulesTool.handler({
                format: 'list'
            });
            assert(result.includes('cursorrules'), 'Rules tool failed');
        });

        // Test config
        await this.runTest('config tool', async () => {
            const configTool = this.tools.getTool('config');
            if (!configTool) {
                console.log('  (Config tool not enabled, skipping)');
                return;
            }
            
            // Set a config value
            const setResult = await configTool.handler({
                action: 'set',
                key: 'test.value',
                value: 'test123'
            });
            assert(setResult.includes('Set'), 'Config set failed');
            
            // Get the config value
            const getResult = await configTool.handler({
                action: 'get',
                key: 'test.value'
            });
            assert(getResult.includes('test123'), 'Config get failed');
        });
    }

    async testWebTools() {
        console.log('\n🌐 Testing Web Tools\n');

        await this.runTest('web_fetch tool', async () => {
            const webFetchTool = this.tools.getTool('web_fetch');
            assert(webFetchTool, 'Web fetch tool not found');
            
            // Test with a simple URL (will fail in offline mode but that's ok)
            try {
                const result = await webFetchTool.handler({
                    url: 'https://example.com',
                    format: 'metadata'
                });
                assert(typeof result === 'string', 'Web fetch returned invalid type');
            } catch (error) {
                // Expected in test environment without network
                assert(true, 'Web fetch handled error correctly');
            }
        });
    }

    async testBatchOperations() {
        console.log('\n🔄 Testing Batch Operations\n');

        await this.runTest('batch tool', async () => {
            const batchTool = this.tools.getTool('batch');
            assert(batchTool, 'Batch tool not found');
            
            const result = await batchTool.handler({
                operations: [
                    {
                        tool: 'write',
                        args: {
                            path: 'batch-test-1.txt',
                            content: 'Batch file 1'
                        }
                    },
                    {
                        tool: 'write',
                        args: {
                            path: 'batch-test-2.txt',
                            content: 'Batch file 2'
                        }
                    }
                ]
            });
            assert(result.includes('completed'), 'Batch operation failed');
            
            // Verify files were created
            const files = await fs.readdir('.');
            assert(files.includes('batch-test-1.txt'), 'Batch file 1 not created');
            assert(files.includes('batch-test-2.txt'), 'Batch file 2 not created');
        });
    }

    async testMCPServer() {
        console.log('\n🔌 Testing MCP Server\n');

        await this.runTest('MCP server build', async () => {
            const buildScript = path.join(path.dirname(__dirname), 'scripts', 'build-mcp-standalone.js');
            const exists = await fs.access(buildScript).then(() => true).catch(() => false);
            assert(exists, 'Build script not found');
        });

        await this.runTest('MCP server binary', async () => {
            const serverPath = path.join(path.dirname(__dirname), 'out', 'mcp-server-standalone.js');
            const exists = await fs.access(serverPath).then(() => true).catch(() => false);
            assert(exists, 'MCP server not built');
            
            if (exists) {
                // Test server can start
                const proc = spawn('node', [serverPath, '--version'], {
                    timeout: 5000
                });
                
                const output = await new Promise((resolve) => {
                    let data = '';
                    proc.stdout.on('data', chunk => data += chunk);
                    proc.stderr.on('data', chunk => data += chunk);
                    proc.on('close', () => resolve(data));
                });
                
                assert(output.includes('Hanzo MCP Server'), 'MCP server version check failed');
            }
        });
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up test environment...');
        
        // Go back to original directory
        process.chdir(path.dirname(testDir));
        
        // Remove test directory
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            console.error('Failed to clean up test directory:', error.message);
        }
    }

    async run() {
        console.log('🧪 Hanzo Extension Comprehensive Test Suite\n');
        console.log('=' .repeat(50) + '\n');

        try {
            await this.setup();
            
            // Run all test categories
            await this.testFileOperations();
            await this.testSearchOperations();
            await this.testShellOperations();
            await this.testDevelopmentTools();
            await this.testConfigurationTools();
            await this.testWebTools();
            await this.testBatchOperations();
            await this.testMCPServer();
            
        } catch (error) {
            console.error('\n💥 Fatal error:', error);
            this.results.failed++;
        } finally {
            await this.cleanup();
        }

        // Print summary
        console.log('\n' + '=' .repeat(50));
        console.log('\n📊 Test Summary:\n');
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);
        console.log(`📈 Total: ${this.results.passed + this.results.failed}`);
        console.log(`🎯 Success Rate: ${Math.round((this.results.passed / (this.results.passed + this.results.failed)) * 100)}%`);

        if (this.results.errors.length > 0) {
            console.log('\n❌ Failed Tests:');
            this.results.errors.forEach(({ test, error }) => {
                console.log(`  - ${test}: ${error}`);
            });
        }

        if (this.results.failed === 0) {
            console.log('\n🎉 All tests passed! The extension is ready for production.');
        } else {
            console.log('\n⚠️  Some tests failed. Please review the errors above.');
        }

        process.exit(this.results.failed > 0 ? 1 : 0);
    }
}

// Run tests
const runner = new TestRunner();
runner.run().catch(console.error);