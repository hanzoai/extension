import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { AuthManager } from '../../auth/manager';
import { complete, MODEL } from '../../api/chat';

const CONFIG_PATH = path.join(os.homedir(), '.hanzo', 'llm-config.json');

// Two Zen 5 tiers, both listed by api.hanzo.ai/v1/models.
const CONSENSUS = [MODEL, 'zen5-pro'];

interface ProviderConfig {
    name: string;
    url: string;
    apiKey?: string;
    models?: string[];
    enabled?: boolean;
}

function loadConfig(): Record<string, ProviderConfig> {
    try {
        if (fs.existsSync(CONFIG_PATH)) {return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));}
    } catch { /* best-effort — deliberately ignored */ }
    return {};
}

function saveConfig(config: Record<string, ProviderConfig>): void {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function detectProviders(): ProviderConfig[] {
    const found: ProviderConfig[] = [];
    found.push({ name: 'Hanzo', url: 'https://api.hanzo.ai/v1', models: [MODEL] });
    try { execSync('curl -sf http://localhost:11434/api/tags', { timeout: 2000, stdio: 'pipe' }); found.push({ name: 'Ollama', url: 'http://localhost:11434' }); } catch { /* best-effort — deliberately ignored */ }
    try { execSync('curl -sf http://localhost:1234/v1/models', { timeout: 2000, stdio: 'pipe' }); found.push({ name: 'LM Studio', url: 'http://localhost:1234/v1' }); } catch { /* best-effort — deliberately ignored */ }
    return found;
}

export function createLLMTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'llm',
            description: 'Query LLM providers with unified interface',
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Prompt to send to the LLM' },
                    model: { type: 'string', description: `Model id from api.hanzo.ai/v1/models (default: ${MODEL})` },
                    temperature: { type: 'number', description: 'Temperature for response generation (0-1)' },
                    maxTokens: { type: 'number', description: 'Maximum tokens in response' }
                },
                required: ['prompt']
            },
            handler: async (args: { prompt: string; model?: string; temperature?: number; maxTokens?: number }) => {
                // Every hosted model is served by the Hanzo gateway, api.hanzo.ai/v1.
                try {
                    return await complete(
                        await AuthManager.getInstance(context).bearer(),
                        [{ role: 'user', content: args.prompt }],
                        { model: args.model, temperature: args.temperature ?? 0.7, maxTokens: args.maxTokens ?? 2048 }
                    );
                } catch (e: any) {
                    return `Error querying LLM: ${e.message}`;
                }
            }
        },

        {
            name: 'consensus',
            description: 'Get consensus from multiple LLMs',
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Prompt to send to multiple LLMs' },
                    models: { type: 'array', items: { type: 'string' }, description: `Model ids from api.hanzo.ai/v1/models (default: ${CONSENSUS.join(', ')})` }
                },
                required: ['prompt']
            },
            handler: async (args: { prompt: string; models?: string[] }) => {
                const models = args.models?.length ? args.models : CONSENSUS;
                const token = await AuthManager.getInstance(context).bearer();
                const answers = await Promise.all(models.map(model =>
                    complete(token, [{ role: 'user', content: args.prompt }], { model })
                        .catch((e: Error) => `Error: ${e.message}`)
                ));
                return models.map((model, i) => `**${model}:**\n${answers[i]}`).join('\n\n');
            }
        },

        {
            name: 'llm_manage',
            description: 'Manage LLM configurations',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['list', 'add', 'remove', 'test'], description: 'Management action' },
                    provider: { type: 'string', description: 'LLM provider name' },
                    config: { type: 'object', description: 'Provider configuration' }
                },
                required: ['action']
            },
            handler: async (args: { action: string; provider?: string; config?: any }) => {
                switch (args.action) {
                    case 'list': {
                        const detected = detectProviders();
                        const saved = loadConfig();
                        const lines = ['Detected providers:'];
                        detected.forEach(p => lines.push(`  ${p.name}: ${p.url} ${p.models ? `(${p.models.join(', ')})` : ''}`));
                        if (Object.keys(saved).length) {
                            lines.push('\nSaved providers:');
                            Object.entries(saved).forEach(([k, v]) => lines.push(`  ${k}: ${v.url} ${v.enabled === false ? '(disabled)' : ''}`));
                        }
                        lines.push(`\nConfig: ${CONFIG_PATH}`);
                        return lines.join('\n');
                    }
                    case 'add': {
                        if (!args.provider || !args.config?.url) {return 'Error: provider name and config.url required';}
                        const config = loadConfig();
                        config[args.provider] = { name: args.provider, ...args.config, enabled: true };
                        saveConfig(config);
                        return `Added provider: ${args.provider} (${args.config.url})`;
                    }
                    case 'remove': {
                        if (!args.provider) {return 'Error: provider name required';}
                        const config = loadConfig();
                        delete config[args.provider];
                        saveConfig(config);
                        return `Removed provider: ${args.provider}`;
                    }
                    case 'test': {
                        const providers = detectProviders();
                        const lines = ['Provider connectivity test:'];
                        for (const p of providers) {
                            try {
                                execSync(`curl -sf --max-time 3 "${p.url}"`, { stdio: 'pipe' });
                                lines.push(`  ${p.name}: OK`);
                            } catch {
                                lines.push(`  ${p.name}: UNREACHABLE`);
                            }
                        }
                        return lines.join('\n');
                    }
                    default:
                        throw new Error(`Unknown action: ${args.action}`);
                }
            }
        }
    ];
}
