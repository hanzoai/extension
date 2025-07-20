const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building Claude Desktop MCP package...');

// Create dist directory if it doesn't exist
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Create Claude Desktop specific files
const claudeDesktopDir = path.join(distDir, 'claude-desktop');
if (!fs.existsSync(claudeDesktopDir)) {
    fs.mkdirSync(claudeDesktopDir, { recursive: true });
}

// Copy MCP server
fs.copyFileSync(
    path.join(distDir, 'mcp-server.js'),
    path.join(claudeDesktopDir, 'server.js')
);

// Create package.json for Claude Desktop
const packageJson = {
    name: '@hanzo/mcp',
    version: require('../package.json').version,
    description: 'Hanzo AI MCP server for Claude Desktop - powerful development tools and AI assistance',
    main: 'server.js',
    bin: {
        'hanzo-mcp': './bin/install.js'
    },
    scripts: {
        start: 'node server.js',
        postinstall: 'node ./bin/install.js --check'
    },
    keywords: [
        'mcp',
        'model-context-protocol',
        'claude',
        'claude-desktop',
        'ai',
        'development-tools',
        'hanzo'
    ],
    author: 'Hanzo Industries Inc',
    license: 'MIT',
    repository: {
        type: 'git',
        url: 'https://github.com/hanzoai/extension.git'
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
        'bin/',
        'README.md'
    ],
    publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org/'
    }
};

fs.writeFileSync(
    path.join(claudeDesktopDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
);

// Create README for Claude Desktop users
const readme = `# Hanzo MCP for Claude Desktop

This is the Model Context Protocol (MCP) server for Hanzo AI, providing powerful development tools to Claude Desktop.

## Installation

1. Copy this folder to a location on your computer
2. Add the following to your Claude Desktop configuration file:

\`\`\`json
{
  "mcpServers": {
    "hanzo": {
      "command": "node",
      "args": ["${claudeDesktopDir}/server.js"],
      "env": {
        "HANZO_WORKSPACE": "/path/to/your/workspace"
      }
    }
  }
}
\`\`\`

3. Restart Claude Desktop

## Available Tools

- **File System**: read, write, edit, multi_edit, directory_tree, find_files
- **Search**: grep, search, symbols, git_search
- **Shell**: run_command, bash, open
- **Development**: todo_read, todo_write, think
- **And many more!**

## Configuration

You can configure the MCP server using environment variables:

- \`HANZO_WORKSPACE\`: Your workspace directory
- \`MCP_TRANSPORT\`: Transport method (stdio or tcp)
- \`HANZO_MCP_DISABLED_TOOLS\`: Comma-separated list of tools to disable
- \`HANZO_MCP_ALLOWED_PATHS\`: Comma-separated list of allowed paths

## Support

For issues and documentation, visit: https://github.com/hanzoai/extension
`;

fs.writeFileSync(
    path.join(claudeDesktopDir, 'README.md'),
    readme
);

// Create installation script
const installScript = `#!/bin/bash

echo "Installing Hanzo MCP for Claude Desktop..."

# Default Claude Desktop config location
CONFIG_DIR="$HOME/Library/Application Support/Claude"
CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo '{"mcpServers": {}}' > "$CONFIG_FILE"
fi

# Add Hanzo MCP server configuration
echo "Adding Hanzo MCP to Claude Desktop configuration..."

# This is a simplified version - in production, you'd use a proper JSON parser
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf-8'));
config.mcpServers = config.mcpServers || {};
config.mcpServers.hanzo = {
    command: 'node',
    args: ['${claudeDesktopDir}/server.js'],
    env: {
        HANZO_WORKSPACE: process.env.HOME
    }
};
fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
console.log('Configuration updated successfully!');
"

echo "Installation complete! Please restart Claude Desktop."
`;

fs.writeFileSync(
    path.join(claudeDesktopDir, 'install.sh'),
    installScript
);
fs.chmodSync(path.join(claudeDesktopDir, 'install.sh'), '755');

// Create Windows installation script
const installScriptWindows = `@echo off
echo Installing Hanzo MCP for Claude Desktop...

set CONFIG_DIR=%APPDATA%\\Claude
set CONFIG_FILE=%CONFIG_DIR%\\claude_desktop_config.json

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

if not exist "%CONFIG_FILE%" (
    echo {"mcpServers": {}} > "%CONFIG_FILE%"
)

echo Adding Hanzo MCP to Claude Desktop configuration...

node -e "const fs = require('fs'); const config = JSON.parse(fs.readFileSync('%CONFIG_FILE%', 'utf-8')); config.mcpServers = config.mcpServers || {}; config.mcpServers.hanzo = { command: 'node', args: ['${claudeDesktopDir.replace(/\\/g, '\\\\')}\\\\server.js'], env: { HANZO_WORKSPACE: process.env.USERPROFILE } }; fs.writeFileSync('%CONFIG_FILE%', JSON.stringify(config, null, 2)); console.log('Configuration updated successfully!');"

echo Installation complete! Please restart Claude Desktop.
pause
`;

fs.writeFileSync(
    path.join(claudeDesktopDir, 'install.bat'),
    installScriptWindows
);

console.log(`Claude Desktop package created at: ${claudeDesktopDir}`);
console.log('Users can run install.sh (Mac/Linux) or install.bat (Windows) to install.');