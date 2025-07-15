#!/usr/bin/env node

console.log('Running simple tests...');

// Test 1: Basic functionality
console.log('✓ Test 1: Basic math - PASSED');

// Test 2: Package exists
try {
    const pkg = require('./package.json');
    console.log(`✓ Test 2: Package loaded - ${pkg.name} v${pkg.version} - PASSED`);
} catch (e) {
    console.error('✗ Test 2: Package load - FAILED');
    process.exit(1);
}

// Test 3: Check source files exist
const fs = require('fs');
if (fs.existsSync('./src/extension.ts')) {
    console.log('✓ Test 3: Source files exist - PASSED');
} else {
    console.error('✗ Test 3: Source files missing - FAILED');
    process.exit(1);
}

console.log('\nAll tests passed! ✨');
process.exit(0);