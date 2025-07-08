import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface LocalLLMProvider {
    name: string;
    endpoint: string;
    models: string[];
    defaultModel: string;
    apiFormat: 'openai' | 'ollama' | 'custom';
    headers?: Record<string, string>;
    authRequired?: boolean;
}

export interface LocalLLMConfig {
    providers: LocalLLMProvider[];
    defaultProvider: string;
    autoDetect: boolean;
}

export class LocalLLMManager {
    private configPath: string;
    private config: LocalLLMConfig;

    constructor(configPath?: string) {
        this.configPath = configPath || path.join(os.homedir(), '.dev', 'local-llm.json');
        this.config = this.loadConfig();
        
        if (this.config.autoDetect) {
            this.autoDetectProviders();
        }
    }

    private loadConfig(): LocalLLMConfig {
        const defaultConfig: LocalLLMConfig = {
            providers: [
                {
                    name: 'ollama',
                    endpoint: 'http://localhost:11434',
                    models: ['llama2', 'mistral', 'codellama', 'llama3', 'phi3', 'gemma2'],
                    defaultModel: 'llama3',
                    apiFormat: 'ollama'
                },
                {
                    name: 'llm-server',
                    endpoint: 'http://localhost:8080',
                    models: ['gpt-j', 'gpt-neox', 'bloom'],
                    defaultModel: 'gpt-j',
                    apiFormat: 'openai'
                },
                {
                    name: 'text-generation-webui',
                    endpoint: 'http://localhost:5000',
                    models: ['model'],
                    defaultModel: 'model',
                    apiFormat: 'custom'
                },
                {
                    name: 'localai',
                    endpoint: 'http://localhost:8000',
                    models: ['ggml-model'],
                    defaultModel: 'ggml-model',
                    apiFormat: 'openai'
                },
                {
                    name: 'llamacpp',
                    endpoint: 'http://localhost:8081',
                    models: ['model'],
                    defaultModel: 'model',
                    apiFormat: 'custom'
                }
            ],
            defaultProvider: 'ollama',
            autoDetect: true
        };

        try {
            if (fs.existsSync(this.configPath)) {
                const userConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
                return { ...defaultConfig, ...userConfig };
            }
        } catch (error) {
            console.error('Failed to load local LLM config:', error);
        }

        return defaultConfig;
    }

    private async autoDetectProviders(): Promise<void> {
        for (const provider of this.config.providers) {
            try {
                const isAvailable = await this.checkProviderAvailability(provider);
                if (isAvailable) {
                    console.log(`✓ Detected ${provider.name} at ${provider.endpoint}`);
                    
                    // Try to get available models
                    const models = await this.getAvailableModels(provider);
                    if (models.length > 0) {
                        provider.models = models;
                    }
                }
            } catch (error) {
                // Provider not available
            }
        }
    }

    private async checkProviderAvailability(provider: LocalLLMProvider): Promise<boolean> {
        try {
            const healthEndpoint = provider.apiFormat === 'ollama' 
                ? `${provider.endpoint}/api/tags`
                : `${provider.endpoint}/health`;
                
            const response = await fetch(healthEndpoint, {
                method: 'GET',
                signal: AbortSignal.timeout(3000)
            });
            
            return response.ok;
        } catch {
            return false;
        }
    }

    private async getAvailableModels(provider: LocalLLMProvider): Promise<string[]> {
        try {
            if (provider.apiFormat === 'ollama') {
                const response = await fetch(`${provider.endpoint}/api/tags`);
                if (response.ok) {
                    const data = await response.json();
                    return data.models?.map((m: any) => m.name) || [];
                }
            } else if (provider.apiFormat === 'openai') {
                const response = await fetch(`${provider.endpoint}/v1/models`);
                if (response.ok) {
                    const data = await response.json();
                    return data.data?.map((m: any) => m.id) || [];
                }
            }
        } catch (error) {
            console.error(`Failed to get models for ${provider.name}:`, error);
        }
        
        return provider.models;
    }

    async callLocalLLM(
        prompt: string,
        options: {
            provider?: string;
            model?: string;
            temperature?: number;
            maxTokens?: number;
            systemPrompt?: string;
        } = {}
    ): Promise<string> {
        const providerName = options.provider || this.config.defaultProvider;
        const provider = this.config.providers.find(p => p.name === providerName);
        
        if (!provider) {
            throw new Error(`Provider ${providerName} not found`);
        }

        const model = options.model || provider.defaultModel;
        
        switch (provider.apiFormat) {
            case 'ollama':
                return this.callOllama(provider, prompt, model, options);
            case 'openai':
                return this.callOpenAIFormat(provider, prompt, model, options);
            case 'custom':
                return this.callCustomFormat(provider, prompt, model, options);
            default:
                throw new Error(`Unknown API format: ${provider.apiFormat}`);
        }
    }

    private async callOllama(
        provider: LocalLLMProvider,
        prompt: string,
        model: string,
        options: any
    ): Promise<string> {
        const response = await fetch(`${provider.endpoint}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...provider.headers
            },
            body: JSON.stringify({
                model,
                prompt: options.systemPrompt 
                    ? `${options.systemPrompt}\n\n${prompt}`
                    : prompt,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 2048,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.response;
    }

    private async callOpenAIFormat(
        provider: LocalLLMProvider,
        prompt: string,
        model: string,
        options: any
    ): Promise<string> {
        const messages = [];
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const response = await fetch(`${provider.endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...provider.headers
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 2048
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI format error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    private async callCustomFormat(
        provider: LocalLLMProvider,
        prompt: string,
        model: string,
        options: any
    ): Promise<string> {
        // Generic format for custom providers
        const response = await fetch(`${provider.endpoint}/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...provider.headers
            },
            body: JSON.stringify({
                prompt,
                model,
                temperature: options.temperature || 0.7,
                max_length: options.maxTokens || 2048,
                system_prompt: options.systemPrompt
            })
        });

        if (!response.ok) {
            throw new Error(`Custom provider error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.text || data.response || data.generated_text || '';
    }

    getProviders(): LocalLLMProvider[] {
        return this.config.providers;
    }

    getProvider(name: string): LocalLLMProvider | undefined {
        return this.config.providers.find(p => p.name === name);
    }

    addProvider(provider: LocalLLMProvider): void {
        const existing = this.config.providers.findIndex(p => p.name === provider.name);
        if (existing >= 0) {
            this.config.providers[existing] = provider;
        } else {
            this.config.providers.push(provider);
        }
        this.saveConfig();
    }

    private saveConfig(): void {
        try {
            fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('Failed to save local LLM config:', error);
        }
    }
}