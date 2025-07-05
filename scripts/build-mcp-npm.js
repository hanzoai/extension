const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building @hanzo/mcp npm package...\n');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

const npmDir = path.join('dist', 'npm');
if (!fs.existsSync(npmDir)) {
    fs.mkdirSync(npmDir, { recursive: true });
}

// First build the MCP server
console.log('Building MCP server...');
execSync('npm run build:mcp', { stdio: 'inherit' });

// Copy server file
console.log('Copying server files...');
fs.copyFileSync('dist/mcp-server.js', path.join(npmDir, 'server.js'));

// Create package.json for npm
const packageJson = {
    name: '@hanzo/mcp',
    version: require('../package.json').version,
    description: 'Hanzo AI MCP server - powerful development tools for Claude Desktop and Claude Code',
    main: 'server.js',
    bin: {
        'hanzo-mcp': './cli.js'
    },
    scripts: {
        start: 'node server.js'
    },
    keywords: [
        'mcp',
        'model-context-protocol',
        'claude',
        'claude-desktop',
        'claude-code',
        'ai',
        'development-tools',
        'hanzo'
    ],
    author: 'Hanzo Industries Inc',
    license: 'MIT',
    repository: {
        type: 'git',
        url: 'git+https://github.com/hanzoai/extension.git'
    },
    homepage: 'https://github.com/hanzoai/extension#readme',
    bugs: {
        url: 'https://github.com/hanzoai/extension/issues'
    },
    engines: {
        node: '>=16.0.0'
    },
    files: [
        'server.js',
        'cli.js',
        'README.md'
    ],
    publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org/'
    }
};

// Create CLI wrapper
const cliScript = `#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

if (command === 'install' || (!command && !args.includes('--help')) || args.includes('--claude-code')) {
    console.log('\\n📦 Installing Hanzo MCP...\\n');
    
    // Detect Claude Desktop config location
    let configPath;
    if (process.platform === 'darwin') {
        configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else if (process.platform === 'win32') {
        configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
    } else {
        configPath = path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    }
    
    // Check if running in Claude Code (no config needed)
    if (process.env.CLAUDE_CODE || args.includes('--claude-code')) {
        console.log('✅ Hanzo MCP is ready for Claude Code!');
        console.log('\\nTo use in Claude Code:');
        console.log('1. The MCP server is available at:', path.join(__dirname, 'server.js'));
        console.log('2. Tools will be automatically available in your conversations');
        return;
    }
    
    // For Claude Desktop, update config
    console.log('Configuring for Claude Desktop...');
    console.log('Config location:', configPath);
    
    try {
        // Ensure directory exists
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // Read existing config or create new
        let config = {};
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        
        // Ensure mcpServers exists
        if (!config.mcpServers) {
            config.mcpServers = {};
        }
        
        // Add Hanzo MCP
        config.mcpServers['hanzo-mcp'] = {
            command: 'node',
            args: [path.join(__dirname, 'server.js')],
            env: {}
        };
        
        // Write config
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        console.log('\\n✅ Hanzo MCP installed successfully!');
        console.log('\\n🔄 Please restart Claude Desktop to use the new tools.');
        console.log('\\n📚 Available tools:');
        console.log('   - File operations (read, write, edit)');
        console.log('   - Search (grep, git_search, symbols)');
        console.log('   - Shell commands (bash, processes)');
        console.log('   - AI tools (llm, consensus, mode)');
        console.log('   - And many more!');
        
    } catch (error) {
        console.error('\\n❌ Installation failed:', error.message);
        console.error('\\nManual installation:');
        console.error('1. Add to your Claude Desktop config:');
        console.error(JSON.stringify({
            mcpServers: {
                'hanzo-mcp': {
                    command: 'node',
                    args: [path.join(__dirname, 'server.js')]
                }
            }
        }, null, 2));
    }
    
} else if (command === 'start') {
    // Start the MCP server directly
    const server = spawn('node', [path.join(__dirname, 'server.js')], {
        stdio: 'inherit'
    });
    
    server.on('error', (err) => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
    
} else {
    console.log('Hanzo MCP - Model Context Protocol Server');
    console.log('');
    console.log('Usage:');
    console.log('  npx @hanzo/mcp              Install and configure');
    console.log('  npx @hanzo/mcp install      Install and configure');
    console.log('  npx @hanzo/mcp start        Start the MCP server');
    console.log('');
    console.log('Options:');
    console.log('  --claude-code              Configure for Claude Code');
}
`;

// Create README
const readme = `# @hanzo/mcp

Hanzo AI MCP (Model Context Protocol) server - powerful development tools for Claude Desktop and Claude Code.

## Quick Install

\`\`\`bash
npx @hanzo/mcp@latest
\`\`\`

This will automatically configure the MCP server for your environment.

## Manual Installation

### Claude Desktop

Add to your \`claude_desktop_config.json\`:

\`\`\`json
{
  "mcpServers": {
    "hanzo-mcp": {
      "command": "npx",
      "args": ["@hanzo/mcp@latest", "start"]
    }
  }
}
\`\`\`

### Claude Code

For Claude Code, install the DXT extension or run:

\`\`\`bash
npx @hanzo/mcp@latest --claude-code
\`\`\`

## Available Tools

- **File Operations**: read, write, edit, multi_edit, directory_tree
- **Search**: grep, git_search, find_files, symbols
- **Shell**: bash, run_command, processes, open
- **AI Tools**: llm, consensus, agent, mode
- **Development**: todo, critic, think, rules
- **Web**: web_fetch, batch_search
- **And many more!**

## Documentation

See [https://github.com/hanzoai/extension](https://github.com/hanzoai/extension) for full documentation.
`;

// Write files
console.log('Creating npm package files...');
fs.writeFileSync(path.join(npmDir, 'package.json'), JSON.stringify(packageJson, null, 2));
fs.writeFileSync(path.join(npmDir, 'cli.js'), cliScript);
fs.chmodSync(path.join(npmDir, 'cli.js'), '755');
fs.writeFileSync(path.join(npmDir, 'README.md'), readme);

console.log(`\n✅ NPM package created at: ${npmDir}`);
console.log('\nTo publish:');
console.log(`  cd ${npmDir}`);
console.log('  npm publish\n');
console.log('Users can then install with:');
console.log('  npx @hanzo/mcp@latest');