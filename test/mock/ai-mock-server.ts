import express from 'express';
import bodyParser from 'body-parser';
import chalk from 'chalk';

// Mock responses for different AI tools
const MOCK_RESPONSES = {
    claude: {
        '/v1/messages': {
            content: [
                {
                    type: 'text',
                    text: 'This is a mock Claude response. The code appears to implement a simple calculator with sum and product functions.'
                }
            ],
            model: 'claude-3-opus',
            usage: { input_tokens: 10, output_tokens: 20 }
        }
    },
    openai: {
        '/v1/chat/completions': {
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: 'This is a mock Codex response. The functions are well-structured and follow JavaScript best practices.'
                    }
                }
            ],
            model: 'gpt-4',
            usage: { prompt_tokens: 10, completion_tokens: 20 }
        }
    },
    gemini: {
        '/v1beta/models/gemini-pro:generateContent': {
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                text: 'This is a mock Gemini response. Consider adding input validation and error handling to make the code more robust.'
                            }
                        ]
                    }
                }
            ]
        }
    },
    ollama: {
        '/api/generate': {
            response: 'This is a mock local LLM response from Ollama. The code is efficient and straightforward.'
        },
        '/api/tags': {
            models: [
                { name: 'llama3:latest', size: '4.5GB' },
                { name: 'codellama:latest', size: '3.8GB' },
                { name: 'mistral:latest', size: '4.1GB' }
            ]
        }
    }
};

export class AIMockServer {
    private app: express.Application;
    private server: any;
    private requestLog: any[] = [];
    
    constructor(private port: number = 0) {
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }
    
    private setupMiddleware() {
        this.app.use(bodyParser.json());
        
        // Log all requests
        this.app.use((req, res, next) => {
            const logEntry = {
                timestamp: new Date(),
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: req.body
            };
            
            this.requestLog.push(logEntry);
            console.log(chalk.gray(`[Mock] ${req.method} ${req.url}`));
            
            next();
        });
    }
    
    private setupRoutes() {
        // Claude API
        this.app.post('/v1/messages', (req, res) => {
            res.json(MOCK_RESPONSES.claude['/v1/messages']);
        });
        
        // OpenAI API
        this.app.post('/v1/chat/completions', (req, res) => {
            res.json(MOCK_RESPONSES.openai['/v1/chat/completions']);
        });
        
        // Gemini API
        this.app.post('/v1beta/models/:model/generateContent', (req, res) => {
            res.json(MOCK_RESPONSES.gemini['/v1beta/models/gemini-pro:generateContent']);
        });
        
        // Ollama API
        this.app.post('/api/generate', (req, res) => {
            res.json(MOCK_RESPONSES.ollama['/api/generate']);
        });
        
        this.app.get('/api/tags', (req, res) => {
            res.json(MOCK_RESPONSES.ollama['/api/tags']);
        });
        
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', mock: true });
        });
        
        // OAuth mock for auth testing
        this.app.get('/oauth/authorize', (req, res) => {
            const { redirect_uri, state } = req.query;
            // Simulate immediate redirect with code
            const code = 'mock-auth-code-' + Date.now();
            res.redirect(`${redirect_uri}?code=${code}&state=${state}`);
        });
        
        this.app.post('/oauth/token', (req, res) => {
            res.json({
                access_token: 'mock-access-token-' + Date.now(),
                refresh_token: 'mock-refresh-token-' + Date.now(),
                expires_in: 3600,
                token_type: 'Bearer'
            });
        });
        
        this.app.get('/api/user', (req, res) => {
            res.json({
                id: 'mock-user-123',
                email: 'test@hanzo.ai',
                name: 'Test User'
            });
        });
        
        this.app.get('/v1/api-keys', (req, res) => {
            res.json([
                {
                    name: 'Claude API',
                    provider: 'anthropic',
                    key: 'sk-ant-mock-key',
                    enabled: true
                },
                {
                    name: 'OpenAI API',
                    provider: 'openai',
                    key: 'sk-mock-openai-key',
                    enabled: true
                },
                {
                    name: 'Gemini API',
                    provider: 'google',
                    key: 'mock-gemini-key',
                    enabled: true
                }
            ]);
        });
    }
    
    async start(): Promise<number> {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                const actualPort = this.server.address().port;
                console.log(chalk.green(`🎭 Mock AI Server running on port ${actualPort}`));
                resolve(actualPort);
            });
        });
    }
    
    stop() {
        if (this.server) {
            this.server.close();
        }
    }
    
    getRequestLog() {
        return this.requestLog;
    }
    
    clearRequestLog() {
        this.requestLog = [];
    }
}

// Run standalone if called directly
if (require.main === module) {
    const port = parseInt(process.env.PORT || '8888');
    const server = new AIMockServer(port);
    
    server.start().then((actualPort) => {
        console.log(chalk.cyan('\nMock endpoints available:'));
        console.log(chalk.gray('  POST http://localhost:' + actualPort + '/v1/messages (Claude)'));
        console.log(chalk.gray('  POST http://localhost:' + actualPort + '/v1/chat/completions (OpenAI)'));
        console.log(chalk.gray('  POST http://localhost:' + actualPort + '/v1beta/models/gemini-pro:generateContent (Gemini)'));
        console.log(chalk.gray('  POST http://localhost:' + actualPort + '/api/generate (Ollama)'));
        console.log(chalk.gray('  GET  http://localhost:' + actualPort + '/health'));
        console.log();
        
        process.on('SIGINT', () => {
            console.log(chalk.yellow('\nShutting down mock server...'));
            server.stop();
            process.exit(0);
        });
    });
}