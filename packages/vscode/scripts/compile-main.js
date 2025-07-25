const { execSync } = require('child_process');
const fs = require('fs');

console.log('Compiling main source files (excluding tests)...');

// Use CI config if in CI environment
const baseConfig = process.env.CI ? "./tsconfig.ci.json" : "./tsconfig.json";

// Create a temporary tsconfig that excludes tests
const tempConfig = {
    extends: baseConfig,
    exclude: [
        "node_modules",
        ".vscode-test",
        "src/test/**/*"
    ]
};

fs.writeFileSync('tsconfig.temp.json', JSON.stringify(tempConfig, null, 2));

try {
    execSync('tsc -p tsconfig.temp.json', { stdio: 'inherit' });
    console.log('✅ Compilation successful!');
} catch (error) {
    console.error('❌ Compilation failed');
    process.exit(1);
} finally {
    // Clean up temp file
    fs.unlinkSync('tsconfig.temp.json');
}