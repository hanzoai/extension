import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as axios from 'axios';
import { AITools } from '../../mcp/tools/ai-tools';

suite('AI Tools Test Suite', () => {
    let context: vscode.ExtensionContext;
    let aiTools: AITools;
    let sandbox: sinon.SinonSandbox;
    let axiosStub: sinon.SinonStub;
    let configStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock VS Code configuration
        configStub = sandbox.stub();
        configStub.withArgs('llm.openai.apiKey').returns('test-openai-key');
        configStub.withArgs('llm.openai.model').returns('gpt-4');
        configStub.withArgs('llm.anthropic.apiKey').returns('test-anthropic-key');
        configStub.withArgs('llm.anthropic.model').returns('claude-3-opus-20240229');
        configStub.withArgs('llm.local.model').returns('llama2');
        configStub.withArgs('llm.local.baseUrl').returns('http://localhost:11434');
        
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: configStub,
            update: sandbox.stub().resolves()
        } as any);
        
        // Mock axios
        axiosStub = sandbox.stub(axios, 'post' as any);
        
        // Mock VS Code context
        context = {
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub().resolves()
            },
            globalState: {
                get: sandbox.stub().returns('pragmatic'),
                update: sandbox.stub().resolves(),
                setKeysForSync: sandbox.stub()
            },
            extensionPath: '/test/extension',
            extensionUri: vscode.Uri.file('/test/extension'),
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            logUri: vscode.Uri.file('/test/logs'),
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (path: string) => `/test/extension/${path}`,
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/logs'
        } as any;
        
        aiTools = new AITools(context);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('LLM tool should call OpenAI API correctly', async () => {
        axiosStub.resolves({
            data: {
                choices: [{
                    message: {
                        content: 'Test response from OpenAI'
                    }
                }]
            }
        });
        
        const llmTool = aiTools.getTools().find(t => t.name === 'llm')!;
        
        const result = await llmTool.handler({
            prompt: 'Test prompt',
            provider: 'openai',
            temperature: 0.7,
            max_tokens: 100
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.response, 'Test response from OpenAI');
        assert.strictEqual(result.provider, 'openai');
        
        // Verify API call
        assert.ok(axiosStub.calledOnce);
        const [url, body, config] = axiosStub.firstCall.args;
        assert.strictEqual(url, 'https://api.openai.com/v1/chat/completions');
        assert.strictEqual(body.model, 'gpt-4');
        assert.strictEqual(body.temperature, 0.7);
        assert.strictEqual(body.max_tokens, 100);
        assert.strictEqual(config.headers.Authorization, 'Bearer test-openai-key');
    });

    test('LLM tool should call Anthropic API correctly', async () => {
        axiosStub.resolves({
            data: {
                content: [{
                    text: 'Test response from Anthropic'
                }]
            }
        });
        
        const llmTool = aiTools.getTools().find(t => t.name === 'llm')!;
        
        const result = await llmTool.handler({
            prompt: 'Test prompt',
            provider: 'anthropic',
            system: 'You are a helpful assistant'
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.response, 'Test response from Anthropic');
        assert.strictEqual(result.provider, 'anthropic');
        
        // Verify API call
        assert.ok(axiosStub.calledOnce);
        const [url, body, config] = axiosStub.firstCall.args;
        assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
        assert.strictEqual(body.system, 'You are a helpful assistant');
        assert.strictEqual(config.headers['x-api-key'], 'test-anthropic-key');
    });

    test('LLM tool should auto-select provider when provider is auto', async () => {
        axiosStub.resolves({
            data: {
                choices: [{
                    message: {
                        content: 'Auto-selected response'
                    }
                }]
            }
        });
        
        const llmTool = aiTools.getTools().find(t => t.name === 'llm')!;
        
        const result = await llmTool.handler({
            prompt: 'Test prompt',
            provider: 'auto'
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.provider, 'openai'); // Should select first available
    });

    test('Consensus tool should query multiple providers', async () => {
        // Mock different responses for different providers
        axiosStub.onFirstCall().resolves({
            data: {
                choices: [{
                    message: {
                        content: 'OpenAI says: Yes'
                    }
                }]
            }
        });
        
        axiosStub.onSecondCall().resolves({
            data: {
                content: [{
                    text: 'Anthropic says: Yes, definitely'
                }]
            }
        });
        
        // Mock consensus analysis
        axiosStub.onThirdCall().resolves({
            data: {
                choices: [{
                    message: {
                        content: 'Both providers agree: Yes'
                    }
                }]
            }
        });
        
        const consensusTool = aiTools.getTools().find(t => t.name === 'consensus')!;
        
        const result = await consensusTool.handler({
            prompt: 'Is TypeScript better than JavaScript?',
            providers: ['openai', 'anthropic']
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.responses.length, 2);
        assert.ok(result.consensus.includes('Both providers agree'));
        assert.strictEqual(result.agreement_score, 85);
    });

    test('LLM manage tool should list providers', async () => {
        const llmManageTool = aiTools.getTools().find(t => t.name === 'llm_manage')!;
        
        const result = await llmManageTool.handler({
            action: 'list'
        });
        
        assert.ok(result.success);
        assert.ok(Array.isArray(result.providers));
        assert.ok(result.providers.length > 0);
        
        // Check provider structure
        const openaiProvider = result.providers.find((p: any) => p.name === 'openai');
        assert.ok(openaiProvider);
        assert.strictEqual(openaiProvider.provider, 'openai');
        assert.strictEqual(openaiProvider.model, 'gpt-4');
        assert.strictEqual(openaiProvider.configured, true);
    });

    test('Agent tool should delegate tasks correctly', async () => {
        axiosStub.resolves({
            data: {
                choices: [{
                    message: {
                        content: 'Task completed: Fixed the bug in authentication flow'
                    }
                }]
            }
        });
        
        const agentTool = aiTools.getTools().find(t => t.name === 'agent')!;
        
        const result = await agentTool.handler({
            task: 'Fix the authentication bug',
            agent_type: 'coder',
            context: { file: 'auth.ts', line: 42 }
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.agent_type, 'coder');
        assert.ok(result.result.includes('Fixed the bug'));
        
        // Verify system prompt for coder agent
        const [, body] = axiosStub.firstCall.args;
        assert.ok(body.messages[0].content.includes('expert programmer'));
    });

    test('Mode tool should switch development modes', async () => {
        const modeTool = aiTools.getTools().find(t => t.name === 'mode')!;
        
        // Test listing modes
        const listResult = await modeTool.handler({
            action: 'list'
        });
        
        assert.ok(listResult.success);
        assert.ok(Array.isArray(listResult.modes));
        assert.ok(listResult.modes.length > 0);
        
        // Test setting mode
        const setResult = await modeTool.handler({
            action: 'set',
            mode: '10x'
        });
        
        assert.ok(setResult.success);
        assert.ok(setResult.message.includes('10x'));
        assert.ok(context.globalState.update.calledWith('development_mode', '10x'));
        
        // Test getting current mode
        const getResult = await modeTool.handler({
            action: 'get'
        });
        
        assert.ok(getResult.success);
        assert.strictEqual(getResult.current_mode, 'pragmatic'); // From mock
    });

    test('Mode tool should handle custom configurations', async () => {
        const modeTool = aiTools.getTools().find(t => t.name === 'mode')!;
        
        const customConfig = {
            speed: 8,
            quality: 9,
            documentation: 7,
            custom_field: 'test'
        };
        
        const result = await modeTool.handler({
            action: 'set',
            mode: 'custom_mode',
            custom_config: customConfig
        });
        
        assert.ok(result.success);
        assert.deepStrictEqual(result.config, customConfig);
        assert.ok(context.globalState.update.calledWith('mode_config_custom_mode', customConfig));
    });

    test('LLM tool should handle errors gracefully', async () => {
        axiosStub.rejects(new Error('API key invalid'));
        
        const llmTool = aiTools.getTools().find(t => t.name === 'llm')!;
        
        const result = await llmTool.handler({
            prompt: 'Test prompt',
            provider: 'openai'
        });
        
        assert.ok(!result.success);
        assert.ok(result.error.includes('API key invalid'));
    });

    test('Consensus tool should handle provider failures', async () => {
        // First provider succeeds
        axiosStub.onFirstCall().resolves({
            data: {
                choices: [{
                    message: {
                        content: 'OpenAI response'
                    }
                }]
            }
        });
        
        // Second provider fails
        axiosStub.onSecondCall().rejects(new Error('Anthropic API error'));
        
        // Consensus analysis on single response
        axiosStub.onThirdCall().resolves({
            data: {
                choices: [{
                    message: {
                        content: 'Only one provider responded'
                    }
                }]
            }
        });
        
        const consensusTool = aiTools.getTools().find(t => t.name === 'consensus')!;
        
        const result = await consensusTool.handler({
            prompt: 'Test prompt',
            providers: ['openai', 'anthropic']
        });
        
        assert.ok(result.success);
        assert.strictEqual(result.responses.filter(r => r.success).length, 1);
        assert.ok(result.consensus.includes('one provider'));
    });
});