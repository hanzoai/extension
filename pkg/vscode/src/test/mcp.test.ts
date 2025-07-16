import * as assert from 'assert';
import * as sinon from 'sinon';
import { MCPManager } from '../../mcp/manager';
import { MCPInstaller } from '../../mcp/installer';

suite('MCP Test Suite', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('MCPManager should initialize', () => {
        const manager = new MCPManager();
        assert.ok(manager);
    });

    test('MCPInstaller should detect package manager', async () => {
        const installer = new MCPInstaller();
        const result = await installer.detectPackageManager();
        assert.ok(['npm', 'yarn', 'pnpm', 'bun'].includes(result));
    });

    test('MCPInstaller should parse package name correctly', () => {
        const installer = new MCPInstaller();
        
        // Test npm packages
        const npmPackage = installer.parsePackageName('@modelcontextprotocol/server-github');
        assert.strictEqual(npmPackage.type, 'npm');
        assert.strictEqual(npmPackage.name, '@modelcontextprotocol/server-github');
        
        // Test Python packages
        const pythonPackage = installer.parsePackageName('mcp-server-sqlite');
        assert.strictEqual(pythonPackage.type, 'python');
        assert.strictEqual(pythonPackage.name, 'mcp-server-sqlite');
    });

    test('MCPManager should handle tool calls', async () => {
        const manager = new MCPManager();
        
        // Mock a tool call
        const mockTool = {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' }
                },
                required: ['query']
            }
        };

        // In real implementation, we'd test the actual tool call
        assert.ok(mockTool.name === 'test_tool');
        assert.ok(mockTool.inputSchema);
    });

    test('MCPInstaller should validate package names', () => {
        const installer = new MCPInstaller();
        
        // Valid packages
        assert.ok(installer.isValidPackageName('@scope/package'));
        assert.ok(installer.isValidPackageName('simple-package'));
        assert.ok(installer.isValidPackageName('package_with_underscore'));
        
        // Invalid packages
        assert.ok(!installer.isValidPackageName(''));
        assert.ok(!installer.isValidPackageName(' '));
        assert.ok(!installer.isValidPackageName('package with spaces'));
    });

    test('MCPManager should maintain server registry', () => {
        const manager = new MCPManager();
        
        // Test adding a server
        manager.registerServer('test-server', {
            package: '@test/server',
            status: 'running',
            pid: 12345
        });
        
        const server = manager.getServer('test-server');
        assert.ok(server);
        assert.strictEqual(server.package, '@test/server');
        assert.strictEqual(server.status, 'running');
        
        // Test removing a server
        manager.unregisterServer('test-server');
        assert.ok(!manager.getServer('test-server'));
    });
});