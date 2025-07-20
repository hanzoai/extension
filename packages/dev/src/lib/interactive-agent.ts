import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ConfigurableAgentLoop, AgentLoopConfig, LLMProvider } from './agent-loop';
import { SwarmTool } from './swarm-tool';
import { v4 as uuidv4 } from 'uuid';
import { TerminalUI } from './terminal-ui';
import { CommandRegistry, CommandContext, CommandCategory } from './command-registry';

export interface Session {
  id: string;
  messages: any[];
  context: any;
  createdAt: Date;
  updatedAt: Date;
}

export class InteractiveAgent {
  private rl: readline.Interface;
  private agent: ConfigurableAgentLoop;
  private sessionId: string;
  private sessionDir: string;
  private swarmTool: SwarmTool;
  private swarmEnabled: boolean = false;
  private swarmCount: number = 5;
  private ui: TerminalUI;
  private commandRegistry: CommandRegistry;
  private currentProvider: LLMProvider;
  private isAuthenticated: boolean = false;

  constructor(provider?: LLMProvider, swarmCount?: number) {
    this.sessionId = uuidv4();
    this.sessionDir = path.join(process.cwd(), '.dev-sessions');
    this.swarmTool = new SwarmTool();
    this.ui = TerminalUI.getInstance();
    this.commandRegistry = new CommandRegistry();
    
    if (swarmCount) {
      this.swarmEnabled = true;
      this.swarmCount = swarmCount;
    }

    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    // Initialize provider
    this.currentProvider = provider || this.getDefaultProvider();
    this.isAuthenticated = !!this.currentProvider.apiKey;

    // Create readline interface with enhanced prompt
    this.rl = this.ui.createPrompt();

    // Initialize agent with config
    const config: AgentLoopConfig = {
      provider: this.currentProvider,
      maxIterations: 10,
      enableMCP: true,
      enableBrowser: false,
      enableSwarm: this.swarmEnabled,
      streamOutput: true,
      confirmActions: false
    };

    this.agent = new ConfigurableAgentLoop(config);
    this.setupAgentTools();
    this.registerCustomCommands();
  }

  private getDefaultProvider(): LLMProvider {
    // Check for available providers
    const providers = ConfigurableAgentLoop.getAvailableProviders();
    return providers[0] || {
      name: 'Local',
      type: 'local',
      model: 'dev-agent',
      supportsTools: true,
      supportsStreaming: false
    };
  }

  private setupAgentTools(): void {
    // Add swarm tool if enabled
    if (this.swarmEnabled) {
      this.agent.addTool({
        name: 'distribute_work',
        description: 'Distribute work across multiple parallel agents',
        parameters: {
          files: { type: 'array', description: 'Files to process' },
          task: { type: 'string', description: 'Task to perform on files' },
          batchSize: { type: 'number', description: 'Files per worker', default: 5 }
        },
        execute: async (params: any) => {
          const tasks = this.swarmTool.createTaskBatches(
            params.files,
            params.batchSize || 5,
            params.task,
            this.agent.config.provider.type
          );
          
          const results = await this.swarmTool.executeParallelTasks(tasks);
          return {
            success: true,
            results: results,
            summary: `Processed ${params.files.length} files across ${tasks.length} workers`
          };
        }
      });
    }

    // Add session management tools
    this.agent.addTool({
      name: 'save_session',
      description: 'Save the current session',
      parameters: {
        name: { type: 'string', description: 'Session name', optional: true }
      },
      execute: async (params: any) => {
        const sessionName = params.name || `session-${Date.now()}`;
        await this.saveSession(sessionName);
        return { success: true, message: `Session saved as: ${sessionName}` };
      }
    });

    this.agent.addTool({
      name: 'load_session',
      description: 'Load a previous session',
      parameters: {
        name: { type: 'string', description: 'Session name or ID' }
      },
      execute: async (params: any) => {
        const loaded = await this.loadSession(params.name);
        return { 
          success: loaded, 
          message: loaded ? `Session loaded: ${params.name}` : 'Session not found' 
        };
      }
    });
  }

  private registerCustomCommands(): void {
    // Override built-in command handlers with custom logic
    const commandContext: CommandContext = {
      ui: this.ui,
      agent: this,
      session: this.sessionId,
      provider: this.currentProvider.name
    };

    // Update the ask command to work with our agent
    this.commandRegistry.register({
      name: 'ask',
      aliases: ['a', 'query'],
      category: CommandCategory.ASSISTANCE,
      description: 'Ask a question about your code',
      usage: 'ask <question>',
      requiresAuth: true,
      handler: async (args, context) => {
        const question = args._.join(' ');
        if (!question) {
          this.ui.showError('Please provide a question');
          return;
        }
        await this.handleInput(question);
      }
    });
  }

  async start(initialPrompt?: string): Promise<void> {
    // Show welcome screen with version
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
    this.ui.showWelcome(packageJson.version || '2.2.0');

    if (this.swarmEnabled) {
      this.ui.showWarning(`Swarm mode enabled with ${this.swarmCount} workers`);
    }

    if (!this.isAuthenticated) {
      this.ui.showInfo('No API key detected. Use /login to authenticate with a provider.');
    }

    // Initialize agent
    await this.agent.initialize();

    // Handle initial prompt if provided
    if (initialPrompt) {
      this.ui.startSpinner('Processing your request...');
      await this.handleInput(initialPrompt);
      this.ui.stopSpinner();
    }

    // Show prompt
    this.rl.prompt();

    // Handle line input
    this.rl.on('line', async (line) => {
      const input = line.trim();
      
      if (!input) {
        this.rl.prompt();
        return;
      }

      // Check if it's a command
      const commandContext: CommandContext = {
        ui: this.ui,
        agent: this,
        session: this.isAuthenticated ? this.sessionId : undefined,
        provider: this.currentProvider.name
      };

      const isCommand = await this.commandRegistry.execute(input, commandContext);
      
      if (!isCommand) {
        // Not a command, send to agent
        if (!this.isAuthenticated) {
          this.ui.showError('Please login first using /login');
        } else {
          await this.handleInput(input);
        }
      }

      this.rl.prompt();
    });

    // Handle close
    this.rl.on('close', () => {
      this.ui.showInfo('Goodbye! 👋');
      this.cleanup();
      process.exit(0);
    });
  }

  private async handleInput(input: string): Promise<void> {
    try {
      const spinner = this.ui.startSpinner('Thinking...');
      
      // Send to agent
      const response = await this.agent.processMessage(input);
      
      spinner.stop();
      
      // Response is streamed by the agent if streaming is enabled
      if (!this.agent.config.streamOutput) {
        console.log(response);
      }
    } catch (error) {
      this.ui.renderError(error as Error, 'Processing message');
    }
  }

  // Public method for command registry to access
  async processMessage(message: string): Promise<void> {
    await this.handleInput(message);
  }

  private async saveSession(name: string): Promise<void> {
    const session: Session = {
      id: this.sessionId,
      messages: this.agent.getMessages(),
      context: this.agent.getContext(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const sessionPath = path.join(this.sessionDir, `${name}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }

  private async loadSession(name: string): Promise<boolean> {
    const sessionPath = path.join(this.sessionDir, `${name}.json`);
    
    if (!fs.existsSync(sessionPath)) {
      // Try with .json extension if not provided
      const altPath = path.join(this.sessionDir, `${name}.json`);
      if (!fs.existsSync(altPath)) {
        return false;
      }
    }

    try {
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      this.sessionId = sessionData.id;
      this.agent.loadSession(sessionData.messages, sessionData.context);
      return true;
    } catch (error) {
      console.error(chalk.red(`Error loading session: ${error}`));
      return false;
    }
  }

  private async listSessions(): Promise<void> {
    const files = fs.readdirSync(this.sessionDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));

    if (files.length === 0) {
      this.ui.showInfo('No saved sessions found.');
    } else {
      this.ui.drawBox(files, 'Saved Sessions');
      this.ui.showInfo('Use /load <name> to load a session');
    }
  }

  private cleanup(): void {
    this.swarmTool.cleanup();
  }
}