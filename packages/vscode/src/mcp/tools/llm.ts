import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const CONFIG_PATH = path.join(os.homedir(), '.hanzo', 'llm-config.json');

interface ProviderConfig {
    name: string;
    url: string;
    apiKey?: string;
    models?: string[];
    enabled?: boolean;
}

function loadConfig(): Record<string, ProviderConfig> {
    try {
        if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
    return {};
}

function saveConfig(config: Record<string, ProviderConfig>): void {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function detectProviders(): ProviderConfig[] {
    const found: ProviderConfig[] = [];
    if (process.env.OPENAI_API_KEY) found.push({ name: 'OpenAI', url: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] });
    if (process.env.ANTHROPIC_API_KEY) found.push({ name: 'Anthropic', url: 'https://api.anthropic.com', models: ['claude-opus-4-6', 'claude-sonnet-4-6'] });
    if (process.env.HANZO_API_KEY) found.push({ name: 'Hanzo', url: 'https://llm.hanzo.ai/v1', models: ['zen-400b', 'zen-70b'] });
    try { execSync('curl -sf http://localhost:11434/api/tags', { timeout: 2000, stdio: 'pipe' }); found.push({ name: 'Ollama', url: 'http://localhost:11434' }); } catch {}
    try { execSync('curl -sf http://localhost:1234/v1/models', { timeout: 2000, stdio: 'pipe' }); found.push({ name: 'LM Studio', url: 'http://localhost:1234/v1' }); } catch {}
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
                    model: { type: 'string', description: 'Model to use (e.g., gpt-4o, claude-opus-4-6)' },
                    temperature: { type: 'number', description: 'Temperature for response generation (0-1)' },
                    maxTokens: { type: 'number', description: 'Maximum tokens in response' }
                },
                required: ['prompt']
            },
            handler: async (args: { prompt: string; model?: string; temperature?: number; maxTokens?: number }) => {
                const providers = detectProviders();
                const config = loadConfig();
                const allProviders = [...providers, ...Object.values(config).filter(c => c.enabled !== false)];

                if (allProviders.length === 0) {
                    return 'No LLM providers available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or HANZO_API_KEY, or start Ollama locally.';
                }

                // Find provider for requested model or use first available
                let provider = allProviders[0];
                const model = args.model || 'default';
                for (const p of allProviders) {
                    if (p.models?.some(m => model.includes(m) || m.includes(model))) { provider = p; break; }
                }

                // Route to Hanzo LLM gateway (unified proxy for all providers)
                const apiKey = process.env.HANZO_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
                const baseUrl = process.env.HANZO_LLM_URL || 'https://llm.hanzo.ai/v1';

                try {
                    const body = JSON.stringify({
                        model: args.model || 'zen-70b',
                        messages: [{ role: 'user', content: args.prompt }],
                        temperature: args.temperature ?? 0.7,
                        max_tokens: args.maxTokens ?? 2048
                    });
                    const result = execSync(`curl -sf "${baseUrl}/chat/completions" -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`, {
                        stdio: 'pipe', timeout: 60000
                    }).toString();
                    const data = JSON.parse(result);
                    return data.choices?.[0]?.message?.content || JSON.stringify(data);
                } catch (e: any) {
                    return `Error querying LLM: ${e.message}\n\nAvailable providers: ${allProviders.map(p => p.name).join(', ')}`;
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
                    models: { type: 'array', items: { type: 'string' }, description: 'List of models to query' }
                },
                required: ['prompt']
            },
            handler: async (args: { prompt: string; models?: string[] }) => {
                const providers = detectProviders();
                if (providers.length < 2) {
                    return `Need at least 2 providers for consensus. Found: ${providers.map(p => p.name).join(', ') || 'none'}. Configure API keys for multiple providers.`;
                }
                const models = args.models || providers.slice(0, 3).flatMap(p => p.models?.slice(0, 1) || [p.name]);
                return `Consensus query across ${models.length} models: ${models.join(', ')}\n\nTo use consensus, configure the Hanzo LLM gateway at https://llm.hanzo.ai which supports routing to 100+ providers with built-in consensus and fallback.`;
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
                        if (!args.provider || !args.config?.url) return 'Error: provider name and config.url required';
                        const config = loadConfig();
                        config[args.provider] = { name: args.provider, ...args.config, enabled: true };
                        saveConfig(config);
                        return `Added provider: ${args.provider} (${args.config.url})`;
                    }
                    case 'remove': {
                        if (!args.provider) return 'Error: provider name required';
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
