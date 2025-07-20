const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🏄 Building Hanzo MCP for Windsurf IDE...\n');

// Windsurf uses the same VSIX format as VS Code
// We'll build a standard VSIX that Windsurf can install

const distDir = path.join(__dirname, '..', 'dist', 'windsurf');

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
    console.log('📦 Packaging Windsurf extension...');
    execSync('vsce package --no-dependencies --out dist/windsurf/', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    
    // Read package.json to get version
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const version = packageJson.version;
    
    // Rename the output file to include windsurf in the name
    const vsixFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.vsix'));
    if (vsixFiles.length > 0) {
        const oldPath = path.join(distDir, vsixFiles[0]);
        const newPath = path.join(distDir, `hanzoai-windsurf-${version}.vsix`);
        fs.renameSync(oldPath, newPath);
        
        console.log(`\n✅ Successfully built Windsurf extension: ${newPath}`);
        console.log(`📦 File size: ${(fs.statSync(newPath).size / 1024 / 1024).toFixed(2)} MB`);
        console.log('\n📥 To install in Windsurf:');
        console.log('   1. Open Windsurf');
        console.log('   2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)');
        console.log('   3. Run "Extensions: Install from VSIX..."');
        console.log(`   4. Select ${newPath}`);
        console.log('\n💡 Windsurf integration includes:');
        console.log('   - Full MCP tools access via @hanzo chat participant');
        console.log('   - Access to 200+ LLMs through Hanzo AI');
        console.log('   - 4000+ MCP servers integration');
    }
    
} catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
}