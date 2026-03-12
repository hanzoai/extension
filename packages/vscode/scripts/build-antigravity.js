const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Building Hanzo MCP for Google Antigravity IDE...\n');

// Antigravity is a VS Code fork — uses standard VSIX format
// Install via: antigravity --install-extension <file>.vsix

const distDir = path.join(__dirname, '..', 'dist', 'antigravity');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

try {
    // First compile the TypeScript
    console.log('📦 Compiling TypeScript...');
    execSync('node scripts/compile-main.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

    // Build MCP components
    console.log('🔧 Building MCP components...');
    execSync('npm run build:mcp', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

    // Package the extension
    console.log('📦 Packaging Antigravity extension...');
    execSync('vsce package --no-dependencies --out dist/antigravity/', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

    // Read package.json to get version
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const version = packageJson.version;

    // Rename the output file to include antigravity in the name
    const vsixFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.vsix'));
    if (vsixFiles.length > 0) {
        const oldPath = path.join(distDir, vsixFiles[0]);
        const newPath = path.join(distDir, `hanzoai-antigravity-${version}.vsix`);
        fs.renameSync(oldPath, newPath);

        console.log(`\n✅ Successfully built Antigravity extension: ${newPath}`);
        console.log(`📦 File size: ${(fs.statSync(newPath).size / 1024 / 1024).toFixed(2)} MB`);
        console.log('\n📥 To install in Google Antigravity:');
        console.log('   1. Open Antigravity');
        console.log('   2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)');
        console.log('   3. Run "Extensions: Install from VSIX..."');
        console.log(`   4. Select ${newPath}`);
        console.log('\n💡 Or install via CLI:');
        console.log(`   antigravity --install-extension ${newPath}`);
    }

} catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
}
