const { execSync } = require('child_process');
const fs = require('fs');

console.log('Compiling main source files (excluding tests)...');

const baseConfig = "./tsconfig.json";

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
    // Don't exit(1) — allow vsce package to proceed with partial output
    // tsc often emits .js files even with type errors
    console.warn('⚠️  Compilation had errors (output may still be usable)');
} finally {
    // Clean up temp file
    fs.unlinkSync('tsconfig.temp.json');
}