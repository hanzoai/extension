#!/usr/bin/env node

/**
 * Quick benchmark for Hanzo Extension core functionality
 */

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

async function runBenchmark() {
    console.log('🚀 Hanzo Extension Quick Benchmark\n');
    
    // Create mock context
    const context = {
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
        extensionPath: __dirname,
        subscriptions: [],
        asAbsolutePath: (p) => p
    };

    // Initialize tools
    const tools = new MCPTools(context);
    await tools.initialize();
    
    console.log(`✅ Initialized ${tools.getAllTools().length} tools\n`);
    
    // Benchmark tool initialization
    console.log('📊 Tool Performance Metrics:\n');
    
    const metrics = [];
    
    // Test read tool
    const readTool = tools.getTool('read');
    if (readTool) {
        const times = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            try {
                await readTool.handler({ path: 'package.json' });
                times.push(performance.now() - start);
            } catch (e) {
                // Ignore errors in benchmark
            }
        }
        if (times.length > 0) {
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            metrics.push({ tool: 'read', avgTime: avg.toFixed(2), calls: times.length });
        }
    }
    
    // Test search tool  
    const searchTool = tools.getTool('search');
    if (searchTool) {
        const times = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            try {
                await searchTool.handler({ query: 'test', type: 'all' });
                times.push(performance.now() - start);
            } catch (e) {
                // Ignore errors in benchmark
            }
        }
        if (times.length > 0) {
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            metrics.push({ tool: 'search', avgTime: avg.toFixed(2), calls: times.length });
        }
    }
    
    // Test unified search tool
    const unifiedSearchTool = tools.getTool('unified_search');
    if (unifiedSearchTool) {
        const times = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            try {
                await unifiedSearchTool.handler({ query: 'test' });
                times.push(performance.now() - start);
            } catch (e) {
                // Ignore errors in benchmark
            }
        }
        if (times.length > 0) {
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            metrics.push({ tool: 'unified_search', avgTime: avg.toFixed(2), calls: times.length });
        }
    }
    
    // Test think tool
    const thinkTool = tools.getTool('think');
    if (thinkTool) {
        const times = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            try {
                await thinkTool.handler({ 
                    thought: 'Benchmark thought process',
                    category: 'analysis'
                });
                times.push(performance.now() - start);
            } catch (e) {
                // Ignore errors in benchmark
            }
        }
        if (times.length > 0) {
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            metrics.push({ tool: 'think', avgTime: avg.toFixed(2), calls: times.length });
        }
    }
    
    // Display results
    console.log('Tool Performance Summary:');
    console.log('------------------------');
    console.log('Tool           | Avg Time (ms) | Calls');
    console.log('---------------|---------------|-------');
    
    for (const metric of metrics) {
        const tool = metric.tool.padEnd(13);
        const time = metric.avgTime.padStart(13);
        const calls = metric.calls.toString().padStart(6);
        console.log(`${tool} | ${time} | ${calls}`);
    }
    
    // Memory usage
    console.log('\n💾 Memory Usage:');
    const mem = process.memoryUsage();
    console.log(`  RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  External: ${(mem.external / 1024 / 1024).toFixed(2)} MB`);
    
    // Tool categories
    const stats = tools.getToolStats();
    console.log('\n📊 Tool Statistics:');
    console.log(`  Total tools: ${stats.total}`);
    console.log(`  Enabled: ${stats.enabled}`);
    console.log(`  Disabled: ${stats.disabled}`);
    console.log('\nCategories:');
    for (const [category, count] of Object.entries(stats.categories)) {
        console.log(`  ${category}: ${count} tools`);
    }
    
    console.log('\n✨ Benchmark complete!');
}

// Run benchmark
if (require.main === module) {
    runBenchmark().catch(console.error);
}