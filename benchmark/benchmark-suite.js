#!/usr/bin/env node

/**
 * Comprehensive benchmark suite for Hanzo Extension
 * Tests performance of all underlying abstractions
 */

const path = require('path');
const fs = require('fs').promises;
const { performance } = require('perf_hooks');
const Module = require('module');

// Hook require for vscode mock
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return require('../scripts/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// Load tools
const { MCPTools } = require('../out/mcp/tools');

class BenchmarkSuite {
    constructor() {
        this.results = {};
        this.context = null;
        this.tools = null;
    }

    async setup() {
        console.log('🚀 Hanzo Extension Benchmark Suite\n');
        console.log('Setting up benchmark environment...\n');
        
        // Create test workspace
        const testDir = path.join(__dirname, 'bench-workspace');
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
        
        // Prepare test data
        await this.prepareTestData();
    }

    async prepareTestData() {
        // Create various file sizes for testing
        const sizes = {
            small: 1024,        // 1KB
            medium: 1024 * 100, // 100KB
            large: 1024 * 1024  // 1MB
        };
        
        for (const [name, size] of Object.entries(sizes)) {
            const content = 'x'.repeat(size);
            await fs.writeFile(`test-${name}.txt`, content);
        }
        
        // Create directory structure
        for (let i = 0; i < 10; i++) {
            await fs.mkdir(`dir-${i}`, { recursive: true });
            for (let j = 0; j < 10; j++) {
                await fs.writeFile(`dir-${i}/file-${j}.txt`, `Content ${i}-${j}`);
            }
        }
        
        // Create code files for search testing
        const codeTemplate = `
function testFunction_INDEX() {
    const value = 'test_INDEX';
    console.log(value);
    return value;
}

class TestClass_INDEX {
    constructor() {
        this.id = 'INDEX';
    }
    
    method_INDEX() {
        return this.id;
    }
}

export { testFunction_INDEX, TestClass_INDEX };
`;
        
        for (let i = 0; i < 50; i++) {
            const code = codeTemplate.replace(/INDEX/g, i.toString());
            await fs.writeFile(`code-${i}.js`, code);
        }
    }

    async benchmark(name, fn, iterations = 100) {
        console.log(`📊 Benchmarking: ${name}`);
        
        const times = [];
        let errors = 0;
        
        // Warm-up
        for (let i = 0; i < 5; i++) {
            try {
                await fn();
            } catch (e) {
                // Ignore warm-up errors
            }
        }
        
        // Actual benchmark
        for (let i = 0; i < iterations; i++) {
            try {
                const start = performance.now();
                await fn();
                const end = performance.now();
                times.push(end - start);
            } catch (e) {
                errors++;
            }
        }
        
        // Calculate statistics
        const validTimes = times.filter(t => t > 0);
        
        if (validTimes.length === 0) {
            console.log(`  ❌ No valid measurements (${errors} errors)\n`);
            this.results[name] = {
                avg: 'N/A',
                median: 'N/A',
                p95: 'N/A',
                p99: 'N/A',
                min: 'N/A',
                max: 'N/A',
                errors,
                iterations: 0
            };
            return;
        }
        
        const avg = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
        const sorted = validTimes.sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
        const p99 = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1];
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        
        this.results[name] = {
            avg: avg.toFixed(2),
            median: median.toFixed(2),
            p95: p95.toFixed(2),
            p99: p99.toFixed(2),
            min: min.toFixed(2),
            max: max.toFixed(2),
            errors,
            iterations: validTimes.length
        };
        
        console.log(`  ✅ Avg: ${avg.toFixed(2)}ms | Median: ${median.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms\n`);
    }

    async benchmarkFileOperations() {
        console.log('\n📁 File Operations Benchmarks\n');
        
        const readTool = this.tools.getTool('read');
        const writeTool = this.tools.getTool('write');
        const editTool = this.tools.getTool('edit');
        const multiEditTool = this.tools.getTool('multi_edit');
        
        // Read benchmarks
        await this.benchmark('Read Small File (1KB)', async () => {
            await readTool.handler({ path: 'test-small.txt' });
        });
        
        await this.benchmark('Read Medium File (100KB)', async () => {
            await readTool.handler({ path: 'test-medium.txt' });
        });
        
        await this.benchmark('Read Large File (1MB)', async () => {
            await readTool.handler({ path: 'test-large.txt' });
        });
        
        // Write benchmarks
        await this.benchmark('Write Small File', async () => {
            await writeTool.handler({ 
                path: `write-test-${Date.now()}.txt`, 
                content: 'x'.repeat(1024) 
            });
        });
        
        // Edit benchmarks
        await this.benchmark('Edit Operation', async () => {
            await editTool.handler({
                path: 'test-small.txt',
                old_text: 'xxxx',
                new_text: 'yyyy'
            });
        });
        
        // Multi-edit benchmarks
        const edits = Array(10).fill(null).map((_, i) => ({
            old_text: 'x'.repeat(10),
            new_text: 'y'.repeat(10)
        }));
        
        await this.benchmark('Multi-Edit (10 edits)', async () => {
            await multiEditTool.handler({
                path: 'test-medium.txt',
                edits
            });
        });
    }

    async benchmarkSearchOperations() {
        console.log('\n🔍 Search Operations Benchmarks\n');
        
        const grepTool = this.tools.getTool('grep');
        const searchTool = this.tools.getTool('search');
        const unifiedSearchTool = this.tools.getTool('unified_search');
        const findFilesTool = this.tools.getTool('find_files');
        
        // Grep benchmarks
        await this.benchmark('Grep Simple Pattern', async () => {
            await grepTool.handler({ pattern: 'test', path: '.' });
        });
        
        await this.benchmark('Grep Complex Pattern', async () => {
            await grepTool.handler({ pattern: 'function.*\\{.*console', path: '.' });
        });
        
        // Search benchmarks
        await this.benchmark('Symbol Search', async () => {
            await searchTool.handler({ query: 'TestClass', type: 'all' });
        });
        
        // Unified search benchmarks
        await this.benchmark('Unified Search (All)', async () => {
            await unifiedSearchTool.handler({ 
                query: 'test',
                include: ['grep', 'symbol', 'filename']
            });
        });
        
        await this.benchmark('Unified Search (Grep Only)', async () => {
            await unifiedSearchTool.handler({ 
                query: 'test',
                include: ['grep']
            });
        });
        
        // Find files benchmarks
        await this.benchmark('Find Files (*.txt)', async () => {
            await findFilesTool.handler({ pattern: '*.txt' });
        });
        
        await this.benchmark('Find Files (**/*.js)', async () => {
            await findFilesTool.handler({ pattern: '**/*.js' });
        });
    }

    async benchmarkShellOperations() {
        console.log('\n🖥️  Shell Operations Benchmarks\n');
        
        const runCommandTool = this.tools.getTool('run_command');
        
        // Simple command benchmarks
        await this.benchmark('Run Simple Command (echo)', async () => {
            await runCommandTool.handler({ command: 'echo "test"' });
        });
        
        await this.benchmark('Run Command with Output', async () => {
            await runCommandTool.handler({ command: 'ls -la' });
        });
        
        // Pipeline benchmarks
        await this.benchmark('Run Pipeline Command', async () => {
            await runCommandTool.handler({ 
                command: 'echo "test" | grep "test" | wc -l' 
            });
        });
    }

    async benchmarkDevelopmentTools() {
        console.log('\n🛠️  Development Tools Benchmarks\n');
        
        const todoReadTool = this.tools.getTool('todo_read');
        const todoWriteTool = this.tools.getTool('todo_write');
        const thinkTool = this.tools.getTool('think');
        
        // Prepare todos
        const todos = Array(100).fill(null).map((_, i) => ({
            id: `todo-${i}`,
            content: `Task number ${i}`,
            status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'in_progress' : 'pending',
            priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low'
        }));
        
        await todoWriteTool.handler({ todos });
        
        // Todo benchmarks
        await this.benchmark('Todo Read (100 items)', async () => {
            await todoReadTool.handler({});
        });
        
        await this.benchmark('Todo Write (10 items)', async () => {
            await todoWriteTool.handler({ 
                todos: todos.slice(0, 10).map(t => ({ ...t, id: `${t.id}-${Date.now()}` }))
            });
        });
        
        // Think tool benchmarks
        await this.benchmark('Think Tool', async () => {
            await thinkTool.handler({
                thought: 'This is a benchmark thought for testing performance',
                category: 'analysis'
            });
        });
    }

    async benchmarkBatchOperations() {
        console.log('\n🔄 Batch Operations Benchmarks\n');
        
        const batchTool = this.tools.getTool('batch');
        
        // Small batch
        await this.benchmark('Batch Operation (5 ops)', async () => {
            await batchTool.handler({
                operations: Array(5).fill(null).map((_, i) => ({
                    tool: 'write',
                    args: {
                        path: `batch-${Date.now()}-${i}.txt`,
                        content: 'Batch content'
                    }
                }))
            });
        });
        
        // Large batch
        await this.benchmark('Batch Operation (20 ops)', async () => {
            await batchTool.handler({
                operations: Array(20).fill(null).map((_, i) => ({
                    tool: 'write',
                    args: {
                        path: `batch-large-${Date.now()}-${i}.txt`,
                        content: 'Batch content'
                    }
                }))
            });
        });
    }

    async benchmarkMemoryUsage() {
        console.log('\n💾 Memory Usage Analysis\n');
        
        const initialMemory = process.memoryUsage();
        
        // Perform memory-intensive operations
        const results = [];
        for (let i = 0; i < 100; i++) {
            const readTool = this.tools.getTool('read');
            const result = await readTool.handler({ path: 'test-large.txt' });
            results.push(result);
        }
        
        const afterMemory = process.memoryUsage();
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        const finalMemory = process.memoryUsage();
        
        console.log('Memory Usage (MB):');
        console.log(`  Initial RSS: ${(initialMemory.rss / 1024 / 1024).toFixed(2)}`);
        console.log(`  After 100 reads: ${(afterMemory.rss / 1024 / 1024).toFixed(2)}`);
        console.log(`  After GC: ${(finalMemory.rss / 1024 / 1024).toFixed(2)}`);
        console.log(`  Heap Used: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}`);
        console.log(`  External: ${(finalMemory.external / 1024 / 1024).toFixed(2)}`);
    }

    async printResults() {
        console.log('\n' + '='.repeat(80));
        console.log('\n📈 Benchmark Results Summary\n');
        console.log('='.repeat(80));
        
        // Group results by category
        const categories = {
            'File Operations': ['Read Small File', 'Read Medium File', 'Read Large File', 'Write Small File', 'Edit Operation', 'Multi-Edit'],
            'Search Operations': ['Grep Simple Pattern', 'Grep Complex Pattern', 'Symbol Search', 'Unified Search', 'Find Files'],
            'Shell Operations': ['Run Simple Command', 'Run Command with Output', 'Run Pipeline Command'],
            'Development Tools': ['Todo Read', 'Todo Write', 'Think Tool'],
            'Batch Operations': ['Batch Operation (5 ops)', 'Batch Operation (20 ops)']
        };
        
        for (const [category, tests] of Object.entries(categories)) {
            console.log(`\n${category}:`);
            console.log('-'.repeat(70));
            console.log('Operation                        | Avg (ms) | Median | P95    | P99    |');
            console.log('-'.repeat(70));
            
            for (const test of tests) {
                const result = Object.entries(this.results).find(([k]) => k.includes(test))?.[1];
                if (result) {
                    const name = test.padEnd(30);
                    console.log(`${name} | ${result.avg.padStart(8)} | ${result.median.padStart(6)} | ${result.p95.padStart(6)} | ${result.p99.padStart(6)} |`);
                }
            }
        }
        
        // Performance insights
        console.log('\n📊 Performance Insights:\n');
        
        const fileReadAvg = parseFloat(this.results['Read Medium File (100KB)']?.avg || 0);
        const searchAvg = parseFloat(this.results['Unified Search (All)']?.avg || 0);
        const batchAvg = parseFloat(this.results['Batch Operation (20 ops)']?.avg || 0);
        
        console.log(`• File read performance: ${fileReadAvg < 10 ? '🟢 Excellent' : fileReadAvg < 50 ? '🟡 Good' : '🔴 Needs optimization'} (${fileReadAvg.toFixed(2)}ms avg)`);
        console.log(`• Search performance: ${searchAvg < 100 ? '🟢 Excellent' : searchAvg < 500 ? '🟡 Good' : '🔴 Needs optimization'} (${searchAvg.toFixed(2)}ms avg)`);
        console.log(`• Batch operation efficiency: ${batchAvg < 200 ? '🟢 Excellent' : batchAvg < 1000 ? '🟡 Good' : '🔴 Needs optimization'} (${batchAvg.toFixed(2)}ms for 20 ops)`);
        
        // Scalability analysis
        const smallRead = parseFloat(this.results['Read Small File (1KB)']?.avg || 0);
        const largeRead = parseFloat(this.results['Read Large File (1MB)']?.avg || 0);
        const scaleFactor = largeRead / smallRead;
        
        console.log(`\n• Read scalability: ${scaleFactor < 100 ? '🟢 Linear' : scaleFactor < 500 ? '🟡 Sub-linear' : '🔴 Poor'} (${scaleFactor.toFixed(1)}x for 1000x size increase)`);
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up benchmark environment...');
        process.chdir(path.dirname(path.join(__dirname, 'bench-workspace')));
        await fs.rm(path.join(__dirname, 'bench-workspace'), { recursive: true, force: true });
    }

    async run() {
        try {
            await this.setup();
            
            // Run all benchmarks
            await this.benchmarkFileOperations();
            await this.benchmarkSearchOperations();
            await this.benchmarkShellOperations();
            await this.benchmarkDevelopmentTools();
            await this.benchmarkBatchOperations();
            await this.benchmarkMemoryUsage();
            
            // Print results
            await this.printResults();
            
        } catch (error) {
            console.error('❌ Benchmark failed:', error);
        } finally {
            await this.cleanup();
        }
    }
}

// Run benchmarks
if (require.main === module) {
    const suite = new BenchmarkSuite();
    suite.run().catch(console.error);
}