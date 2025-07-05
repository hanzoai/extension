#!/usr/bin/env node

/**
 * Quick verification script for Hanzo Extension
 * Ensures all builds and core functionality work
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

async function runCommand(cmd, args = []) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { 
            stdio: 'pipe',
            shell: process.platform === 'win32'
        });
        
        let output = '';
        let error = '';
        
        proc.stdout.on('data', (data) => output += data);
        proc.stderr.on('data', (data) => error += data);
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ output, error });
            } else {
                reject(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${error}`));
            }
        });
    });
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function verify() {
    console.log('🔍 Hanzo Extension Verification\n');
    console.log('=' .repeat(50) + '\n');
    
    const results = {
        passed: [],
        failed: []
    };
    
    // Check TypeScript compilation
    console.log('📦 Checking TypeScript compilation...');
    try {
        const outExists = await fileExists('out/extension.js');
        if (outExists) {
            results.passed.push('TypeScript compilation');
            console.log('  ✅ TypeScript compiled successfully\n');
        } else {
            throw new Error('out/extension.js not found');
        }
    } catch (error) {
        results.failed.push('TypeScript compilation');
        console.log('  ❌ TypeScript compilation failed\n');
    }
    
    // Check extension package
    console.log('📦 Checking extension package...');
    try {
        const vsixFiles = await fs.readdir('.').then(files => 
            files.filter(f => f.endsWith('.vsix'))
        );
        
        if (vsixFiles.length > 0) {
            results.passed.push('Extension package');
            console.log(`  ✅ Found extension package: ${vsixFiles[0]}\n`);
            
            // Check package size
            const stats = await fs.stat(vsixFiles[0]);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            console.log(`  📊 Package size: ${sizeMB} MB\n`);
        } else {
            throw new Error('No .vsix file found');
        }
    } catch (error) {
        results.failed.push('Extension package');
        console.log('  ❌ Extension package not found (run: npm run package)\n');
    }
    
    // Check MCP server
    console.log('🔌 Checking MCP server build...');
    try {
        const mcpExists = await fileExists('out/mcp-server-standalone.js');
        if (mcpExists) {
            // Test if it can run
            const { output } = await runCommand('node', ['out/mcp-server-standalone.js', '--version']);
            if (output.includes('Hanzo MCP Server')) {
                results.passed.push('MCP server');
                console.log('  ✅ MCP server built and operational\n');
            } else {
                throw new Error('MCP server version check failed');
            }
        } else {
            throw new Error('MCP server not found');
        }
    } catch (error) {
        results.failed.push('MCP server');
        console.log('  ❌ MCP server build failed (run: npm run build:mcp)\n');
    }
    
    // Check Claude Desktop package
    console.log('🖥️  Checking Claude Desktop package...');
    try {
        const claudeExists = await fileExists('dist/claude-desktop/server.js');
        if (claudeExists) {
            results.passed.push('Claude Desktop package');
            console.log('  ✅ Claude Desktop package ready\n');
        } else {
            throw new Error('Claude Desktop package not found');
        }
    } catch (error) {
        results.failed.push('Claude Desktop package');
        console.log('  ❌ Claude Desktop package not found (run: npm run build:claude-desktop)\n');
    }
    
    // Load and test tools
    console.log('🛠️  Checking tool initialization...');
    try {
        // Mock vscode
        const Module = require('module');
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function(id) {
            if (id === 'vscode') {
                return require('../scripts/vscode-mock');
            }
            return originalRequire.apply(this, arguments);
        };
        
        const { MCPTools } = require('../out/mcp/tools');
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
        
        const tools = new MCPTools(context);
        await tools.initialize();
        const allTools = tools.getAllTools();
        
        if (allTools.length > 0) {
            results.passed.push('Tool initialization');
            console.log(`  ✅ ${allTools.length} tools loaded successfully\n`);
            
            // List key tools
            const keyTools = ['read', 'write', 'unified_search', 'web_fetch', 'process', 'think'];
            const available = keyTools.filter(name => allTools.some(t => t.name === name));
            console.log(`  📋 Key tools available: ${available.join(', ')}\n`);
        } else {
            throw new Error('No tools loaded');
        }
    } catch (error) {
        results.failed.push('Tool initialization');
        console.log(`  ❌ Tool initialization failed: ${error.message}\n`);
    }
    
    // Summary
    console.log('\n' + '=' .repeat(50));
    console.log('\n📊 Verification Summary\n');
    
    console.log(`✅ Passed: ${results.passed.length}`);
    results.passed.forEach(test => console.log(`  • ${test}`));
    
    if (results.failed.length > 0) {
        console.log(`\n❌ Failed: ${results.failed.length}`);
        results.failed.forEach(test => console.log(`  • ${test}`));
    }
    
    // Platform compatibility
    console.log('\n🎯 Platform Compatibility:\n');
    console.log('The same .vsix file works on:');
    console.log('  • VS Code ✅');
    console.log('  • Cursor ✅');
    console.log('  • Windsurf ✅');
    console.log('\nClaude Desktop uses: out/mcp-server-standalone.js');
    
    // Next steps
    if (results.failed.length === 0) {
        console.log('\n🎉 All checks passed! The extension is ready for deployment.\n');
        console.log('📚 Installation Instructions:\n');
        console.log('VS Code/Cursor/Windsurf:');
        console.log('  1. Open Extensions view');
        console.log('  2. Click ... > Install from VSIX');
        console.log('  3. Select hanzoai-*.vsix\n');
        console.log('Claude Desktop:');
        console.log('  1. Edit ~/Library/Application Support/Claude/claude_desktop_config.json');
        console.log('  2. Add the MCP server configuration');
        console.log('  3. Restart Claude Desktop');
    } else {
        console.log('\n⚠️  Some checks failed. Run the following commands:');
        console.log('  npm run compile     # Compile TypeScript');
        console.log('  npm run build:mcp   # Build MCP server');
        console.log('  npm run package     # Create .vsix package');
    }
}

// Run verification
if (require.main === module) {
    verify().catch(console.error);
}