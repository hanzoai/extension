#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

console.log('Building Hanzo MCP Desktop Extension (.dxt)...\n');

const rootDir = path.join(__dirname, '..');
const dxtDir = path.join(rootDir, 'dxt');
const distDir = path.join(rootDir, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const outputFile = path.join(distDir, `hanzoai-${version}.dxt`);

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Build the MCP server first
console.log('Building MCP server...');
try {
    execSync('npm run build:mcp', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
    console.error('Failed to build MCP server:', error);
    process.exit(1);
}

// Create ZIP archive
const output = fs.createWriteStream(outputFile);
const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
});

output.on('close', () => {
    const size = (archive.pointer() / 1024).toFixed(2);
    console.log(`\n✅ Desktop extension created: ${outputFile}`);
    console.log(`📦 Size: ${size} KB`);
    console.log('\n📋 Installation:');
    console.log('1. Open Claude Code');
    console.log('2. Drag and drop the .dxt file into Claude Code');
    console.log('3. Follow the installation prompts');
    console.log('4. Restart Claude Code\n');
});

archive.on('error', (err) => {
    throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Add manifest
console.log('Adding manifest.json...');
archive.file(path.join(dxtDir, 'manifest.json'), { name: 'manifest.json' });

// Add the authenticated MCP server
console.log('Adding server files...');
archive.file(path.join(distDir, 'mcp-server.js'), { name: 'server.js' });

// Create a launcher script for the server
const launcherScript = `#!/usr/bin/env node

// Hanzo MCP Server Launcher for Claude Code Desktop Extension
const path = require('path');
const { spawn } = require('child_process');

// Get configuration from environment
const args = ['server.js'];

// Add authentication flag if needed
if (process.env.HANZO_ANONYMOUS === 'true') {
    args.push('--anon');
}

// Launch the server
const serverPath = path.join(__dirname, 'server.js');
const server = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
        ...process.env,
        // Ensure stdio transport for Claude Code
        MCP_TRANSPORT: 'stdio'
    }
});

server.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

server.on('exit', (code) => {
    process.exit(code || 0);
});
`;

// Add launcher script
console.log('Adding launcher script...');
archive.append(launcherScript, { name: 'launcher.js', mode: 0o755 });

// Create installation helper script
const installScript = `#!/usr/bin/env node

const os = require('os');
const path = require('path');

console.log('\\n🚀 Hanzo MCP Desktop Extension Installer\\n');
console.log('This extension has been installed to Claude Code.');
console.log('\\nConfiguration options:');
console.log('- HANZO_WORKSPACE: Set your default workspace directory');
console.log('- HANZO_ANONYMOUS: Set to "true" for anonymous mode');
console.log('\\nAuthentication:');
console.log('- On first run, you will be prompted to authenticate');
console.log('- Use anonymous mode to skip authentication');
console.log('\\nNext steps:');
console.log('1. Restart Claude Code');
console.log('2. The Hanzo tools will be available');
console.log('\\nFor more information: https://github.com/hanzoai/extension');
`;

archive.append(installScript, { name: 'install.js', mode: 0o755 });

// Add icon
console.log('Adding icon...');
const iconPath = path.join(__dirname, '..', 'images', 'icon.png');
if (fs.existsSync(iconPath)) {
    archive.file(iconPath, { name: 'icon.png' });
} else {
    console.error('Warning: icon.png not found at', iconPath);
    // Fallback to DXT directory icon if available
    const dxtIconPath = path.join(dxtDir, 'icon.png');
    if (fs.existsSync(dxtIconPath)) {
        archive.file(dxtIconPath, { name: 'icon.png' });
    }
}

// Add README
const readme = `# Hanzo MCP for Claude Code

This desktop extension provides the Hanzo Model Context Protocol (MCP) server for Claude Code.

## Features

- 53+ development tools
- File operations (read, write, edit)
- Search and code analysis
- Shell command execution
- Git integration
- Todo management
- Database operations
- And much more!

## Configuration

You can configure the extension through Claude Code settings or environment variables:

- HANZO_WORKSPACE: Default workspace directory
- HANZO_ANONYMOUS: Run without authentication
- HANZO_MCP_DISABLED_TOOLS: Disable specific tools
- HANZO_MCP_ALLOWED_PATHS: Restrict file access

## Authentication

By default, the extension requires authentication with your Hanzo account.
Set HANZO_ANONYMOUS=true to run without authentication (limited features).

## Support

- GitHub: https://github.com/hanzoai/extension
- Issues: https://github.com/hanzoai/extension/issues
`;

archive.append(readme, { name: 'README.md' });

// Finalize the archive
console.log('Creating desktop extension package...');
archive.finalize();