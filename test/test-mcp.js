const { spawn } = require('child_process');

console.log('Testing Hanzo MCP Server...\n');

const server = spawn('node', ['out/mcp-server-standalone.js', '--workspace', '.'], {
    stdio: ['pipe', 'pipe', 'pipe']
});

// Handle stderr (where logs go)
server.stderr.on('data', (data) => {
    console.log('[Server Log]', data.toString().trim());
});

// Send initialize request
const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {
            tools: {}
        },
        clientInfo: {
            name: 'test-client',
            version: '1.0.0'
        }
    }
};

server.stdin.write(JSON.stringify(initRequest) + '\n');

// Send tools/list request after a delay
setTimeout(() => {
    const toolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    };
    
    server.stdin.write(JSON.stringify(toolsRequest) + '\n');
}, 500);

// Handle stdout (responses)
let buffer = '';
server.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
        if (line.trim()) {
            try {
                const response = JSON.parse(line);
                console.log('\nResponse:', JSON.stringify(response, null, 2));
                
                // Exit after getting tools list
                if (response.id === 2) {
                    console.log('\nTest completed successfully!');
                    server.kill();
                    process.exit(0);
                }
            } catch (e) {
                console.error('Failed to parse:', line);
            }
        }
    }
});

// Exit after 5 seconds if nothing happens
setTimeout(() => {
    console.log('\nTest timed out');
    server.kill();
    process.exit(1);
}, 5000);