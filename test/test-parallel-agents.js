#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('Testing @hanzo/mcp parallel agent functionality...\n');

// Test configuration
const testConfig = {
  task: "Analyze the package.json file and create a summary",
  agents: [
    {
      name: "FileAnalyzer",
      role: "Analyze file structure and dependencies",
      tools: ["read", "grep", "search"]
    },
    {
      name: "DocWriter", 
      role: "Create documentation based on analysis",
      tools: ["write", "edit"]
    },
    {
      name: "Reviewer",
      role: "Review the analysis and documentation",
      tools: ["read", "think", "critic"]
    }
  ],
  parallel: true
};

// Spawn the MCP server process
const serverPath = path.join(__dirname, '..', 'dist', 'npm', 'server.js');
const mcpServer = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, HANZO_DEBUG: 'true' }
});

let output = '';
let errorOutput = '';

mcpServer.stdout.on('data', (data) => {
  output += data.toString();
  console.log('Server:', data.toString());
});

mcpServer.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.error('Error:', data.toString());
});

mcpServer.on('close', (code) => {
  console.log(`\nMCP server exited with code ${code}`);
  
  if (code === 0) {
    console.log('✅ Test passed - MCP server started successfully');
  } else {
    console.log('❌ Test failed - MCP server exited with error');
  }
  
  process.exit(code);
});

// Send test request after server starts
setTimeout(() => {
  console.log('\nSending parallel agent test request...');
  
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'agent',
      arguments: testConfig
    }
  };
  
  mcpServer.stdin.write(JSON.stringify(request) + '\n');
  
  // Give it time to process
  setTimeout(() => {
    console.log('\nTest complete. Shutting down server...');
    mcpServer.kill();
  }, 5000);
}, 2000);