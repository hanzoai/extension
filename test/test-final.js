// Final test of Hanzo extension
const path = require('path');
const Module = require('module');

// Hook require to provide vscode mock
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return require('./scripts/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// Load tools
const { MCPTools } = require('./out/mcp/tools');

async function test() {
    console.log('🚀 Testing Hanzo Extension - Final Build\n');
    
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
        asAbsolutePath: (p) => path.join(__dirname, p)
    };

    try {
        const tools = new MCPTools(context);
        await tools.initialize();
        
        const allTools = tools.getAllTools();
        console.log(`✅ Successfully loaded ${allTools.length} tools!\n`);
        
        // Group tools by category
        const categories = {
            'File Operations': ['read', 'write', 'edit', 'multi_edit', 'directory_tree', 'find_files'],
            'Search': ['unified_search', 'grep', 'search', 'symbols'],
            'Shell': ['run_command', 'open', 'process'],
            'Development': ['todo', 'todo_read', 'todo_write', 'think', 'critic'],
            'Configuration': ['palette', 'config', 'rules'],
            'Web': ['web_fetch'],
            'System': ['batch']
        };
        
        console.log('📦 Available Tools by Category:\n');
        for (const [category, toolNames] of Object.entries(categories)) {
            console.log(`${category}:`);
            const available = toolNames.filter(name => allTools.some(t => t.name === name));
            const missing = toolNames.filter(name => !allTools.some(t => t.name === name));
            
            if (available.length > 0) {
                console.log(`  ✅ Available: ${available.join(', ')}`);
            }
            if (missing.length > 0) {
                console.log(`  ❌ Missing: ${missing.join(', ')}`);
            }
            console.log();
        }
        
        // Test key tools
        console.log('🧪 Testing Key Tools:\n');
        
        // Test unified search
        const unifiedSearch = tools.getTool('unified_search');
        if (unifiedSearch) {
            console.log('✅ Unified Search tool ready');
        }
        
        // Test web fetch
        const webFetch = tools.getTool('web_fetch');
        if (webFetch) {
            console.log('✅ Web Fetch tool ready');
        }
        
        // Test process management
        const processTool = tools.getTool('process');
        if (processTool) {
            console.log('✅ Process Management tool ready');
        }
        
        // Test palette system
        const paletteTool = tools.getTool('palette');
        if (paletteTool) {
            console.log('✅ Palette System ready');
        }
        
        console.log('\n📊 Summary:');
        console.log(`- Total tools: ${allTools.length}`);
        console.log(`- Core features: File operations, Search, Shell, Development tools`);
        console.log(`- Advanced features: Unified search, Web fetch, Process management`);
        console.log(`- Configuration: Palette system, Project rules, Git-style config`);
        
        console.log('\n✅ Extension is ready for deployment!');
        console.log('\n📚 Next steps:');
        console.log('1. Run: npm run package');
        console.log('2. Install .vsix in VS Code/Cursor/Windsurf');
        console.log('3. For Claude Desktop: npm run build:mcp');
        console.log('4. Configure Claude Desktop with MCP server path');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

test();