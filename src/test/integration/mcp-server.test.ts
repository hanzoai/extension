import * as assert from 'assert';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';

suite('MCP Server Integration Test Suite', () => {
    let serverProcess: ChildProcess;
    const serverPath = path.join(__dirname, '../../../out/mcp-server-standalone.js');

    setup(async function() {
        this.timeout(10000);
        // Start server in TCP mode for testing
        serverProcess = spawn('node', [serverPath], {
            env: {
                ...process.env,
                MCP_TRANSPORT: 'tcp',
                MCP_PORT: '3456',
                HANZO_WORKSPACE: '/tmp/test-workspace'
            }
        });

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    teardown(() => {
        if (serverProcess) {
            serverProcess.kill();
        }
    });

    test('Server should start and listen on TCP port', (done) => {
        const client = net.createConnection({ port: 3456 }, () => {
            assert.ok(true, 'Server is listening on port 3456');
            client.end();
            done();
        });

        client.on('error', (err) => {
            assert.fail(`Failed to connect to server: ${err.message}`);
        });
    });

    test('Server should handle stdio transport', async function() {
        this.timeout(5000);
        
        // Kill TCP server
        serverProcess.kill();
        
        // Start new server with stdio
        const stdioServer = spawn('node', [serverPath], {
            env: {
                ...process.env,
                MCP_TRANSPORT: 'stdio',
                HANZO_WORKSPACE: '/tmp/test-workspace'
            }
        });

        let output = '';
        stdioServer.stderr.on('data', (data) => {
            output += data.toString();
        });

        // Wait for startup message
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        assert.ok(output.includes('[Hanzo MCP]'), 'Server should output startup message');
        
        stdioServer.kill();
    });

    test('Server should load without authentication in anon mode', async function() {
        this.timeout(5000);
        
        // Kill current server
        serverProcess.kill();
        
        // Start server with anonymous flag
        const anonServer = spawn('node', [serverPath, '--anon'], {
            env: {
                ...process.env,
                MCP_TRANSPORT: 'stdio'
            }
        });

        let output = '';
        anonServer.stderr.on('data', (data) => {
            output += data.toString();
        });

        // Wait for startup
        await new Promise((resolve) => setTimeout(resolve, 2000));
        
        assert.ok(output.includes('anonymous mode'), 'Server should indicate anonymous mode');
        assert.ok(!output.includes('Authentication failed'), 'Should not fail authentication');
        
        anonServer.kill();
    });
});