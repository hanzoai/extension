const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Build configurations for different platforms
const PLATFORMS = {
  'vscode': {
    name: 'VS Code Extension',
    buildCmd: 'node scripts/compile-main.js',
    outputDir: 'out',
    package: false
  },
  'dxt': {
    name: 'Claude Code DXT',
    buildCmd: 'npm run build:dxt',
    outputDir: 'dist/dxt',
    package: false // Already packaged by build script
  },
  'mcp-npm': {
    name: 'MCP NPM Package',
    buildCmd: 'node scripts/build-mcp-npm.js',
    outputDir: 'dist/npm',
    package: false
  },
  'cursor': {
    name: 'Cursor IDE Extension',
    buildCmd: 'npm run build:cursor',
    outputDir: 'dist/cursor',
    package: true
  },
  'windsurf': {
    name: 'Windsurf Extension',
    buildCmd: 'npm run build:windsurf',
    outputDir: 'dist/windsurf',
    package: true
  }
};

async function buildAllPlatforms() {
  console.log('🏗️  Building Hanzo MCP for all platforms...\n');
  
  // Ensure dist directory exists
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
  }
  
  const results = [];
  
  for (const [platform, config] of Object.entries(PLATFORMS)) {
    console.log(`\n📦 Building ${config.name}...`);
    console.log(`   Platform: ${platform}`);
    console.log(`   Output: ${config.outputDir}`);
    
    try {
      // Skip if build command doesn't exist yet
      if (platform === 'cursor' || platform === 'windsurf') {
        if (!fs.existsSync(`scripts/build-${platform}.js`)) {
          console.log(`   ⏭️  Skipped (build script not implemented yet)`);
          continue;
        }
      }
      
      // Run build command
      console.log(`   Running: ${config.buildCmd}`);
      execSync(config.buildCmd, { stdio: 'inherit' });
      
      // Check if output exists
      if (fs.existsSync(config.outputDir)) {
        const stats = fs.statSync(config.outputDir);
        
        if (stats.isDirectory()) {
          // Count files in directory
          const files = fs.readdirSync(config.outputDir);
          console.log(`   ✅ Success! Created ${files.length} files`);
          
          // Create zip archive if needed
          if (config.package) {
            const zipPath = `${config.outputDir}.zip`;
            await createZipArchive(config.outputDir, zipPath);
            console.log(`   📦 Packaged: ${zipPath}`);
          }
        } else {
          console.log(`   ✅ Success! File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        }
        
        results.push({
          platform,
          success: true,
          path: config.outputDir
        });
      } else if (platform === 'dxt') {
        // DXT outputs to dist/ directly
        const dxtFile = 'dist/hanzo-ai.dxt';
        if (fs.existsSync(dxtFile)) {
          const stats = fs.statSync(dxtFile);
          console.log(`   ✅ Success! Created ${dxtFile} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          results.push({
            platform,
            success: true,
            path: dxtFile
          });
        }
      } else {
        throw new Error('Output directory not created');
      }
      
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      results.push({
        platform,
        success: false,
        error: error.message
      });
    }
  }
  
  // Build VS Code extension package (.vsix)
  console.log('\n📦 Building VS Code extension package (.vsix)...');
  try {
    execSync('vsce package --no-dependencies', { stdio: 'inherit' });
    
    // Move .vsix file to dist directory
    const vsixFiles = fs.readdirSync('.').filter(f => f.endsWith('.vsix'));
    if (vsixFiles.length > 0) {
      const vsixFile = vsixFiles[0];
      const targetPath = path.join('dist', vsixFile);
      if (fs.existsSync(vsixFile)) {
        fs.renameSync(vsixFile, targetPath);
      }
      console.log(`   ✅ Created: ${targetPath}`);
    }
  } catch (error) {
    console.error(`   ❌ Failed to create .vsix: ${error.message}`);
  }
  
  // Summary
  console.log('\n\n📊 Build Summary:');
  console.log('================');
  
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const message = result.success ? result.path : result.error;
    console.log(`${status} ${result.platform}: ${message}`);
  }
  
  // List all files in dist directory
  console.log('\n📁 Distribution files:');
  listDistFiles('dist', '   ');
  
  console.log('\n✨ Build complete!');
  console.log('\n📦 Installation methods:');
  console.log('   Claude Code: Drag dist/hanzoai-*.dxt into Claude Code');
  console.log('   Claude Desktop/Code: npx @hanzo/mcp@latest');
  console.log('   VS Code: Install dist/hanzoai-*.vsix');
}

function createZipArchive(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => resolve());
    archive.on('error', reject);
    
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function listDistFiles(dir, prefix = '') {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      console.log(`${prefix}📁 ${item}/`);
      if (item !== 'node_modules' && items.length < 20) {
        listDistFiles(fullPath, prefix + '   ');
      }
    } else {
      const size = (stats.size / 1024).toFixed(1);
      console.log(`${prefix}📄 ${item} (${size} KB)`);
    }
  }
}

// Run the build
buildAllPlatforms().catch(console.error);