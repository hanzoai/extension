import chalk from 'chalk';
import { TerminalUI } from './terminal-ui';

export interface CommandArg {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'file' | 'directory';
  description: string;
  required?: boolean;
  default?: any;
}

export interface Command {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  description: string;
  usage: string;
  examples?: string[];
  args?: CommandArg[];
  requiresAuth?: boolean;
  handler: (args: any, context: CommandContext) => Promise<void>;
}

export enum CommandCategory {
  AUTH = 'Authentication',
  ASSISTANCE = 'AI Assistance',
  CODE = 'Code Operations',
  SYSTEM = 'System',
  SESSION = 'Session Management',
  SWARM = 'Swarm Operations',
  WORKFLOW = 'Workflow'
}

export interface CommandContext {
  ui: TerminalUI;
  agent?: any;
  session?: any;
  provider?: string;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();
  private ui: TerminalUI;

  constructor() {
    this.ui = TerminalUI.getInstance();
    this.registerBuiltinCommands();
  }

  private registerBuiltinCommands(): void {
    // Authentication commands
    this.register({
      name: 'login',
      category: CommandCategory.AUTH,
      description: 'Authenticate with an AI provider',
      usage: 'login [provider]',
      args: [{
        name: 'provider',
        type: 'string',
        description: 'Provider to login to (claude, openai, gemini)',
        required: false
      }],
      handler: async (args, context) => {
        const provider = args.provider || 'claude';
        this.ui.showInfo(`Logging into ${provider}...`);
        // Implementation would handle actual login
      }
    });

    this.register({
      name: 'logout',
      category: CommandCategory.AUTH,
      description: 'Logout from current provider',
      usage: 'logout',
      requiresAuth: true,
      handler: async (args, context) => {
        this.ui.showSuccess('Logged out successfully');
      }
    });

    // AI Assistance commands
    this.register({
      name: 'ask',
      aliases: ['a', 'query'],
      category: CommandCategory.ASSISTANCE,
      description: 'Ask a question about your code',
      usage: 'ask <question>',
      examples: [
        'ask How does this function work?',
        'ask What design pattern should I use here?'
      ],
      requiresAuth: true,
      handler: async (args, context) => {
        const question = args._.join(' ');
        if (!question) {
          this.ui.showError('Please provide a question');
          return;
        }
        // Forward to agent
        if (context.agent) {
          await context.agent.processMessage(question);
        }
      }
    });

    this.register({
      name: 'explain',
      aliases: ['e'],
      category: CommandCategory.ASSISTANCE,
      description: 'Explain code or a concept',
      usage: 'explain [file] [selection]',
      requiresAuth: true,
      handler: async (args, context) => {
        this.ui.showInfo('Analyzing code...');
        // Implementation
      }
    });

    this.register({
      name: 'refactor',
      aliases: ['r'],
      category: CommandCategory.CODE,
      description: 'Refactor code with AI assistance',
      usage: 'refactor <file> [instructions]',
      requiresAuth: true,
      handler: async (args, context) => {
        this.ui.showInfo('Analyzing code for refactoring...');
        // Implementation
      }
    });

    this.register({
      name: 'fix',
      category: CommandCategory.CODE,
      description: 'Fix errors in code',
      usage: 'fix [file]',
      requiresAuth: true,
      handler: async (args, context) => {
        this.ui.showInfo('Looking for issues to fix...');
        // Implementation
      }
    });

    this.register({
      name: 'generate',
      aliases: ['gen', 'g'],
      category: CommandCategory.CODE,
      description: 'Generate code from description',
      usage: 'generate <description>',
      requiresAuth: true,
      handler: async (args, context) => {
        const description = args._.join(' ');
        if (!description) {
          this.ui.showError('Please provide a description');
          return;
        }
        // Forward to agent with generate intent
      }
    });

    // Session commands
    this.register({
      name: 'save',
      category: CommandCategory.SESSION,
      description: 'Save current session',
      usage: 'save [name]',
      handler: async (args, context) => {
        const name = args.name || `session-${Date.now()}`;
        this.ui.showSuccess(`Session saved as: ${name}`);
      }
    });

    this.register({
      name: 'load',
      category: CommandCategory.SESSION,
      description: 'Load a saved session',
      usage: 'load <name>',
      handler: async (args, context) => {
        if (!args.name) {
          // List available sessions
          this.ui.showInfo('Available sessions:');
          return;
        }
        this.ui.showSuccess(`Loaded session: ${args.name}`);
      }
    });

    this.register({
      name: 'history',
      aliases: ['h'],
      category: CommandCategory.SESSION,
      description: 'Show conversation history',
      usage: 'history [count]',
      handler: async (args, context) => {
        const count = args.count || 10;
        this.ui.showInfo(`Showing last ${count} messages`);
      }
    });

    // Swarm commands
    this.register({
      name: 'swarm',
      category: CommandCategory.SWARM,
      description: 'Manage swarm mode',
      usage: 'swarm <on|off|status> [count]',
      handler: async (args, context) => {
        const action = args._[0];
        switch (action) {
          case 'on':
            const count = args._[1] || 5;
            this.ui.showSuccess(`Swarm mode enabled with ${count} workers`);
            break;
          case 'off':
            this.ui.showSuccess('Swarm mode disabled');
            break;
          case 'status':
            this.ui.showInfo('Swarm status: Active with 5 workers');
            break;
          default:
            this.ui.showError('Usage: swarm <on|off|status> [count]');
        }
      }
    });

    this.register({
      name: 'distribute',
      category: CommandCategory.SWARM,
      description: 'Distribute task across swarm workers',
      usage: 'distribute <task>',
      requiresAuth: true,
      handler: async (args, context) => {
        const task = args._.join(' ');
        this.ui.showInfo(`Distributing task: ${task}`);
      }
    });

    // System commands
    this.register({
      name: 'clear',
      aliases: ['cls'],
      category: CommandCategory.SYSTEM,
      description: 'Clear the screen',
      usage: 'clear',
      handler: async () => {
        console.clear();
      }
    });

    this.register({
      name: 'help',
      aliases: ['?'],
      category: CommandCategory.SYSTEM,
      description: 'Show help information',
      usage: 'help [command]',
      handler: async (args) => {
        if (args.command) {
          this.showCommandHelp(args.command);
        } else {
          this.showAllCommands();
        }
      }
    });

    this.register({
      name: 'theme',
      category: CommandCategory.SYSTEM,
      description: 'Change UI theme',
      usage: 'theme <dark|light|auto>',
      handler: async (args) => {
        const theme = args._[0];
        if (!['dark', 'light', 'auto'].includes(theme)) {
          this.ui.showError('Theme must be: dark, light, or auto');
          return;
        }
        this.ui.showSuccess(`Theme changed to: ${theme}`);
      }
    });

    this.register({
      name: 'exit',
      aliases: ['quit', 'q'],
      category: CommandCategory.SYSTEM,
      description: 'Exit the application',
      usage: 'exit',
      handler: async () => {
        this.ui.showInfo('Goodbye! 👋');
        process.exit(0);
      }
    });

    // Workflow commands
    this.register({
      name: 'workflow',
      aliases: ['w'],
      category: CommandCategory.WORKFLOW,
      description: 'Manage AI workflows',
      usage: 'workflow <create|run|list> [name]',
      handler: async (args) => {
        const action = args._[0];
        const name = args._[1];
        
        switch (action) {
          case 'create':
            this.ui.showInfo(`Creating workflow: ${name}`);
            break;
          case 'run':
            this.ui.showInfo(`Running workflow: ${name}`);
            break;
          case 'list':
            this.ui.showInfo('Available workflows:');
            break;
          default:
            this.ui.showError('Usage: workflow <create|run|list> [name]');
        }
      }
    });
  }

  register(command: Command): void {
    this.commands.set(command.name, command);
    
    // Register aliases
    if (command.aliases) {
      command.aliases.forEach(alias => {
        this.aliases.set(alias, command.name);
      });
    }
  }

  async execute(input: string, context: CommandContext): Promise<boolean> {
    const parts = input.trim().split(/\s+/);
    const commandName = parts[0].toLowerCase();
    
    // Check if it's a command (starts with /)
    if (!commandName.startsWith('/')) {
      return false;
    }

    const cleanCommand = commandName.slice(1); // Remove /
    
    // Find command (check aliases too)
    const actualCommand = this.aliases.get(cleanCommand) || cleanCommand;
    const command = this.commands.get(actualCommand);
    
    if (!command) {
      this.ui.showError(`Unknown command: ${cleanCommand}`);
      this.ui.showInfo('Use /help to see available commands');
      return true;
    }

    // Check auth requirement
    if (command.requiresAuth && !context.session) {
      this.ui.showError('This command requires authentication');
      this.ui.showInfo('Use /login to authenticate');
      return true;
    }

    try {
      // Parse arguments
      const args = this.parseArgs(parts.slice(1), command.args);
      
      // Execute command
      await command.handler(args, context);
    } catch (error) {
      this.ui.renderError(error as Error, `Executing command: ${command.name}`);
    }

    return true;
  }

  private parseArgs(input: string[], argDefs?: CommandArg[]): any {
    const args: any = { _: [] };
    
    let i = 0;
    while (i < input.length) {
      const arg = input[i];
      
      if (arg.startsWith('--')) {
        // Long option
        const key = arg.slice(2);
        const next = input[i + 1];
        
        if (next && !next.startsWith('-')) {
          args[key] = next;
          i += 2;
        } else {
          args[key] = true;
          i++;
        }
      } else if (arg.startsWith('-')) {
        // Short option
        const key = arg.slice(1);
        const next = input[i + 1];
        
        if (next && !next.startsWith('-')) {
          args[key] = next;
          i += 2;
        } else {
          args[key] = true;
          i++;
        }
      } else {
        // Positional argument
        args._.push(arg);
        i++;
      }
    }

    // Apply defaults from arg definitions
    if (argDefs) {
      argDefs.forEach((def, index) => {
        if (def.default !== undefined && args[def.name] === undefined) {
          // Check positional args first
          if (args._[index] !== undefined) {
            args[def.name] = args._[index];
          } else {
            args[def.name] = def.default;
          }
        }
      });
    }

    return args;
  }

  private showCommandHelp(commandName: string): void {
    const command = this.commands.get(commandName) || 
                   this.commands.get(this.aliases.get(commandName) || '');
    
    if (!command) {
      this.ui.showError(`Unknown command: ${commandName}`);
      return;
    }

    console.log();
    this.ui.drawBox([
      `Command: ${command.name}`,
      `Category: ${command.category}`,
      '',
      command.description,
      '',
      `Usage: ${command.usage}`
    ], 'Command Help');

    if (command.aliases && command.aliases.length > 0) {
      console.log(this.ui.theme.muted(`\nAliases: ${command.aliases.join(', ')}`));
    }

    if (command.args && command.args.length > 0) {
      console.log(this.ui.theme.primary('\nArguments:'));
      command.args.forEach(arg => {
        const required = arg.required ? ' (required)' : '';
        const defaultVal = arg.default ? ` [default: ${arg.default}]` : '';
        console.log(`  ${this.ui.theme.highlight(arg.name)} - ${arg.description}${required}${defaultVal}`);
      });
    }

    if (command.examples && command.examples.length > 0) {
      console.log(this.ui.theme.primary('\nExamples:'));
      command.examples.forEach(example => {
        console.log(`  ${this.ui.theme.muted(example)}`);
      });
    }
  }

  private showAllCommands(): void {
    // Group commands by category
    const categories = new Map<CommandCategory, Command[]>();
    
    this.commands.forEach(command => {
      if (!categories.has(command.category)) {
        categories.set(command.category, []);
      }
      categories.get(command.category)!.push(command);
    });

    console.log();
    this.ui.drawBox(['Hanzo Dev Command Reference'], 'Help');

    // Show commands by category
    categories.forEach((commands, category) => {
      console.log(this.ui.theme.primary(`\n${category}:`));
      
      const sortedCommands = commands.sort((a, b) => a.name.localeCompare(b.name));
      sortedCommands.forEach(cmd => {
        const aliases = cmd.aliases ? ` (${cmd.aliases.join(', ')})` : '';
        console.log(`  /${this.ui.theme.highlight(cmd.name)}${aliases} - ${this.ui.theme.muted(cmd.description)}`);
      });
    });

    console.log(this.ui.theme.muted('\nUse /help <command> for detailed information about a command'));
  }

  getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name);
  }
}