#!/usr/bin/env node

// Direct test of MCP server communication
const { spawn } = require('child_process');

console.log('Testing MCP server directly...\n');

// Start the server
const server = spawn('npx', ['-y', '@hanzo/mcp@latest', '--anon'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    HANZO_WORKSPACE: '/Users/z/work/hanzo',
    MCP_TRANSPORT: 'stdio'
  }
});

let stdout = '';
let stderr = '';

server.stdout.on('data', (data) => {
  stdout += data.toString();
  console.log('STDOUT:', data.toString());
});

server.stderr.on('data', (data) => {
  stderr += data.toString();
  console.log('STDERR:', data.toString());
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Send MCP initialization after a delay
setTimeout(() => {
  console.log('\nSending MCP initialization...');
  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '0.1.0',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  };
  
  server.stdin.write(JSON.stringify(init) + '\n');
}, 1000);

// Check results after 3 seconds
setTimeout(() => {
  console.log('\n=== Results ===');
  console.log('Process still running:', !server.killed);
  console.log('Exit code:', server.exitCode);
  
  if (stdout.includes('"method":"tools/register"')) {
    console.log('✅ Server is registering tools correctly');
  } else {
    console.log('❌ No tool registration detected');
  }
  
  server.kill();
  process.exit(0);
}, 3000);