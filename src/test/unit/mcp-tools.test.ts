import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { MCPTools } from '../../mcp/tools';

suite('MCP Tools Test Suite', () => {
    let tools: MCPTools;
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code context
        context = {
            globalState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves()
            },
            workspaceState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves()
            },
            extensionPath: '/mock/extension/path',
            subscriptions: []
        } as any;
        
        // Mock workspace
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{
            uri: vscode.Uri.file('/mock/workspace'),
            name: 'MockWorkspace',
            index: 0
        }]);
        
        tools = new MCPTools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('Should initialize tools', async () => {
        await tools.initialize();
        const allTools = tools.getAllTools();
        
        assert.ok(allTools.length > 0);
        assert.ok(allTools.some(t => t.name === 'read'));
        assert.ok(allTools.some(t => t.name === 'write'));
        assert.ok(allTools.some(t => t.name === 'search'));
    });

    test('Should get all tools', () => {
        const allTools = tools.getAllTools();
        
        // Check required tools exist
        const requiredTools = [
            'read', 'write', 'edit', 'multi_edit',
            'directory_tree', 'find_files', 'grep', 'search',
            'run_command', 'bash', 'open'
        ];
        
        requiredTools.forEach(toolName => {
            assert.ok(
                allTools.some(t => t.name === toolName),
                `Tool ${toolName} should exist`
            );
        });
    });

    test('Should respect disabled tools configuration', () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'mcp.disabledTools') {
                    return ['write', 'edit'];
                }
                return undefined;
            }
        } as any);
        
        const filteredTools = tools['filterTools'](tools.getAllTools());
        
        assert.ok(!filteredTools.some(t => t.name === 'write'));
        assert.ok(!filteredTools.some(t => t.name === 'edit'));
        assert.ok(filteredTools.some(t => t.name === 'read'));
    });

    test('Should disable write tools when configured', () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'mcp.disableWriteTools') {
                    return true;
                }
                return undefined;
            }
        } as any);
        
        const filteredTools = tools['filterTools'](tools.getAllTools());
        
        const writeTools = ['write', 'edit', 'multi_edit', 'update_rules'];
        writeTools.forEach(toolName => {
            assert.ok(
                !filteredTools.some(t => t.name === toolName),
                `Write tool ${toolName} should be disabled`
            );
        });
    });

    test('Should disable search tools when configured', () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'mcp.disableSearchTools') {
                    return true;
                }
                return undefined;
            }
        } as any);
        
        const filteredTools = tools['filterTools'](tools.getAllTools());
        
        const searchTools = ['search', 'grep', 'unified_search', 'git_search'];
        searchTools.forEach(toolName => {
            assert.ok(
                !filteredTools.some(t => t.name === toolName),
                `Search tool ${toolName} should be disabled`
            );
        });
    });

    test('Should only enable specified tools', () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'mcp.enabledTools') {
                    return ['read', 'write'];
                }
                return undefined;
            }
        } as any);
        
        const filteredTools = tools['filterTools'](tools.getAllTools());
        
        assert.strictEqual(filteredTools.length, 2);
        assert.ok(filteredTools.some(t => t.name === 'read'));
        assert.ok(filteredTools.some(t => t.name === 'write'));
    });

    test('Tool should have required properties', () => {
        const allTools = tools.getAllTools();
        const readTool = allTools.find(t => t.name === 'read');
        
        assert.ok(readTool);
        assert.strictEqual(readTool.name, 'read');
        assert.ok(readTool.description);
        assert.ok(readTool.inputSchema);
        assert.ok(readTool.handler);
        assert.strictEqual(typeof readTool.handler, 'function');
    });

    test('Should validate tool input schema', () => {
        const allTools = tools.getAllTools();
        const readTool = allTools.find(t => t.name === 'read');
        
        assert.ok(readTool);
        assert.ok(readTool.inputSchema);
        assert.strictEqual(readTool.inputSchema.type, 'object');
        assert.ok(readTool.inputSchema.properties);
        assert.ok(readTool.inputSchema.required);
    });
});