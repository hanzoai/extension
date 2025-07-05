#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { DevLauncher } from '../cli-tools/platform/dev-launcher';
import { CLIToolManager } from '../cli-tools/cli-tool-manager';
import { AsyncToolWrapper } from '../cli-tools/platform/async-tool-wrapper';
import { HanzoAuth } from '../cli-tools/auth/hanzo-auth';

const program = new Command();
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));

program
    .name('dev')
    .description('Dev - Meta AI development tool that manages and runs all LLMs and CLI tools')
    .version(packageJson.version);

// Global auth instance
const auth = new HanzoAuth();

// Login command
program
    .command('login')
    .description('Login to Hanzo AI platform')
    .action(async () => {
        const spinner = ora('Logging in to Hanzo AI...').start();
        
        try {
            const success = await auth.login();
            
            if (success) {
                spinner.succeed('Successfully logged in to Hanzo AI!');
                
                const creds = auth.getCredentials();
                if (creds?.email) {
                    console.log(chalk.gray(`Logged in as: ${creds.email}`));
                }
                
                // Sync API keys
                console.log(chalk.gray('Syncing API keys...'));
                const apiKeys = await auth.syncAPIKeys();
                console.log(chalk.green(`✓ Synced ${apiKeys.length} API keys`));
            } else {
                spinner.fail('Login failed');
            }
        } catch (error) {
            spinner.fail(`Login failed: ${error.message}`);
            process.exit(1);
        }
    });

// Logout command
program
    .command('logout')
    .description('Logout from Hanzo AI platform')
    .action(async () => {
        await auth.logout();
        console.log(chalk.green('Successfully logged out'));
    });

// Status command
program
    .command('auth-status')
    .description('Check authentication status')
    .action(async () => {
        if (auth.isAuthenticated()) {
            const creds = auth.getCredentials();
            console.log(chalk.green('✓ Authenticated'));
            if (creds?.email) {
                console.log(`Email: ${creds.email}`);
            }
            if (creds?.userId) {
                console.log(`User ID: ${creds.userId}`);
            }
        } else {
            console.log(chalk.red('✗ Not authenticated'));
            console.log(chalk.gray('Run "dev login" to authenticate'));
        }
    });

// Initialize command
program
    .command('init')
    .description('Initialize Hanzo Dev in the current directory')
    .option('-f, --force', 'Force initialization even if already initialized')
    .action(async (options) => {
        const spinner = ora('Initializing Hanzo Dev...').start();
        
        try {
            const configPath = path.join(process.cwd(), '.hanzo-dev');
            
            if (fs.existsSync(configPath) && !options.force) {
                spinner.fail('Hanzo Dev already initialized. Use --force to reinitialize.');
                return;
            }
            
            // Create directory structure
            fs.mkdirSync(path.join(configPath, 'logs'), { recursive: true });
            fs.mkdirSync(path.join(configPath, 'async-results'), { recursive: true });
            fs.mkdirSync(path.join(configPath, 'worktrees'), { recursive: true });
            
            // Create default config
            const defaultConfig = {
                version: packageJson.version,
                tools: {
                    claude: { enabled: true },
                    codex: { enabled: true },
                    gemini: { enabled: true },
                    openhands: { enabled: true },
                    aider: { enabled: true }
                },
                sync: {
                    enabled: false,
                    platformUrl: 'https://platform.hanzo.ai',
                    projectId: ''
                },
                defaults: {
                    idleTimeout: 300000, // 5 minutes
                    maxRuntime: 1800000, // 30 minutes
                    autoCommit: true
                }
            };
            
            fs.writeFileSync(
                path.join(configPath, 'config.json'),
                JSON.stringify(defaultConfig, null, 2)
            );
            
            spinner.succeed('Hanzo Dev initialized successfully!');
            console.log(chalk.gray(`Configuration saved to ${path.join(configPath, 'config.json')}}`));
        } catch (error) {
            spinner.fail(`Failed to initialize: ${error.message}`);
            process.exit(1);
        }
    });

// Run command - launch a tool
program
    .command('run <tool> [task...]')
    .description('Run a specific AI tool (claude, codex, gemini, openhands, aider)')
    .option('-a, --async', 'Run in async mode (long-running background process)')
    .option('-w, --worktree', 'Create a git worktree for this session')
    .option('-m, --model <model>', 'Specify the model to use')
    .option('-f, --files <files...>', 'Files to include in the context')
    .option('-d, --directory <dir>', 'Working directory for the tool')
    .option('--no-sync', 'Disable platform sync for this session')
    .action(async (tool, taskParts, options) => {
        const task = taskParts.join(' ');
        const spinner = ora(`Starting ${tool}...`).start();
        
        try {
            const config = loadConfig();
            
            if (!config.tools[tool]?.enabled) {
                spinner.fail(`Tool '${tool}' is not enabled or not recognized.`);
                console.log(chalk.gray('Available tools: claude, codex, gemini, openhands, aider'));
                return;
            }
            
            if (options.async) {
                // Use async wrapper for long-running processes
                const asyncWrapper = new AsyncToolWrapper({
                    idleTimeout: config.defaults.idleTimeout,
                    maxRuntime: config.defaults.maxRuntime,
                    persistResults: true,
                    resultPath: path.join(process.cwd(), '.hanzo-dev', 'async-results')
                });
                
                const jobId = await asyncWrapper.createAsyncTool(
                    tool,
                    getToolCommand(tool),
                    getToolArgs(tool, task, options),
                    { tool, task, options }
                );
                
                spinner.succeed(`Started ${tool} in async mode`);
                console.log(chalk.green(`Job ID: ${jobId}`));
                console.log(chalk.gray(`Query status with: dev status ${jobId}`));
                console.log(chalk.gray(`Send input with: dev input ${jobId} "your input"`));
            } else {
                // Use regular launcher for interactive sessions
                const launcher = new DevLauncher({
                    maxInstances: 10,
                    defaultTimeout: config.defaults.maxRuntime,
                    gitRoot: findGitRoot() || process.cwd(),
                    workspacePath: options.directory || process.cwd(),
                    enableSync: config.sync.enabled && options.sync !== false,
                    syncConfig: config.sync
                });
                
                await launcher.initialize();
                
                const instanceId = await launcher.launchTool(
                    tool,
                    task,
                    {
                        workingDirectory: options.directory,
                        useWorktree: options.worktree,
                        model: options.model,
                        files: options.files
                    }
                );
                
                spinner.succeed(`Launched ${tool}`);
                console.log(chalk.green(`Instance ID: ${instanceId}`));
                
                // Keep process alive for interactive session
                process.on('SIGINT', async () => {
                    console.log(chalk.yellow('\nShutting down...'));
                    await launcher.stopTool(instanceId);
                    process.exit(0);
                });
                
                // Wait for tool to complete
                await new Promise(() => {}); // Keep alive
            }
        } catch (error) {
            spinner.fail(`Failed to run ${tool}: ${error.message}`);
            process.exit(1);
        }
    });

// Compare command - run multiple tools and compare results
program
    .command('compare <task>')
    .description('Run the same task on multiple AI tools and compare results')
    .option('-t, --tools <tools...>', 'Tools to compare (default: all)')
    .option('-d, --directory <dir>', 'Working directory')
    .action(async (task, options) => {
        const spinner = ora('Setting up comparison...').start();
        
        try {
            const tools = options.tools || ['claude', 'codex', 'gemini', 'openhands', 'aider'];
            const manager = new CLIToolManager();
            await manager.initialize();
            
            spinner.text = 'Running tools in parallel...';
            
            const results = await manager.compareResults(task, tools);
            
            spinner.succeed('Comparison complete!');
            
            // Display results
            console.log(chalk.bold('\nComparison Results:'));
            console.log(chalk.gray('='.repeat(80)));
            
            for (const [tool, result of results) {
                console.log(chalk.bold.blue(`\n${tool.toUpperCase()}:`));
                if (result.error) {
                    console.log(chalk.red(`Error: ${result.error}`));
                } else {
                    console.log(result.output || 'No output');
                }
                console.log(chalk.gray('-'.repeat(80)));
            }
        } catch (error) {
            spinner.fail(`Comparison failed: ${error.message}`);
            process.exit(1);
        }
    });

// Status command - check async job status
program
    .command('status [jobId]')
    .description('Check status of async jobs')
    .action(async (jobId) => {
        try {
            const asyncWrapper = new AsyncToolWrapper({
                resultPath: path.join(process.cwd(), '.hanzo-dev', 'async-results')
            });
            
            if (jobId) {
                // Query specific job
                const result = await asyncWrapper.queryJob(jobId);
                
                if (!result) {
                    console.log(chalk.red(`Job ${jobId} not found`));
                    return;
                }
                
                console.log(chalk.bold(`Job ${jobId}:`));
                console.log(`Status: ${getStatusColor(result.status)(result.status)}`);
                if (result.duration) {
                    console.log(`Duration: ${formatDuration(result.duration)}`);
                }
                console.log(`\nOutput:\n${result.output || 'No output yet'}`);
                if (result.error) {
                    console.log(chalk.red(`\nErrors:\n${result.error}`));
                }
            } else {
                // Show all active jobs
                const activeJobs = asyncWrapper.getActiveJobs();
                
                if (activeJobs.length === 0) {
                    console.log(chalk.gray('No active jobs'));
                    return;
                }
                
                console.log(chalk.bold('Active Jobs:'));
                for (const job of activeJobs) {
                    console.log(`${chalk.cyan(job.id)} - ${job.toolName} (${getStatusColor(job.status)(job.status)})`);
                }
            }
        } catch (error) {
            console.error(chalk.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

// Input command - send input to async job
program
    .command('input <jobId> <input>')
    .description('Send input to a running async job')
    .action(async (jobId, input) => {
        try {
            const asyncWrapper = new AsyncToolWrapper({
                resultPath: path.join(process.cwd(), '.hanzo-dev', 'async-results')
            });
            
            const success = asyncWrapper.sendInput(jobId, input);
            
            if (success) {
                console.log(chalk.green('Input sent successfully'));
            } else {
                console.log(chalk.red('Failed to send input. Job may not be running.'));
            }
        } catch (error) {
            console.error(chalk.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });

// Install command - install CLI tools
program
    .command('install [tools...]')
    .description('Install AI CLI tools')
    .option('-a, --all', 'Install all supported tools')
    .action(async (tools, options) => {
        const allTools = ['claude', 'codex', 'gemini', 'openhands', 'aider'];
        const toolsToInstall = options.all ? allTools : (tools.length > 0 ? tools : allTools);
        
        console.log(chalk.bold('Installing Hanzo Dev tools...\n'));
        
        for (const tool of toolsToInstall) {
            const spinner = ora(`Installing ${tool}...`).start();
            
            try {
                const manager = new CLIToolManager();
                await manager.initialize();
                
                spinner.succeed(`${tool} installed successfully`);
            } catch (error) {
                spinner.fail(`Failed to install ${tool}: ${error.message}`);
            }
        }
        
        console.log(chalk.green('\n✨ Installation complete!'));
    });

// Worktree command - manage git worktrees
program
    .command('worktree')
    .description('Manage git worktrees for parallel development')
    .addCommand(
        new Command('list')
            .description('List all worktrees')
            .action(() => {
                try {
                    const output = execSync('git worktree list', { encoding: 'utf-8' });
                    console.log(output);
                } catch (error) {
                    console.error(chalk.red('Error listing worktrees. Make sure you are in a git repository.'));
                }
            })
    )
    .addCommand(
        new Command('clean')
            .description('Clean up Hanzo Dev worktrees')
            .action(() => {
                try {
                    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
                    const worktrees = output.split('\n\n').filter(Boolean);
                    
                    let cleaned = 0;
                    for (const worktree of worktrees) {
                        if (worktree.includes('.worktrees/')) {
                            const path = worktree.split('\n')[0].replace('worktree ', '');
                            execSync(`git worktree remove --force "${path}"`);
                            cleaned++;
                        }
                    }
                    
                    console.log(chalk.green(`Cleaned up ${cleaned} worktrees`));
                } catch (error) {
                    console.error(chalk.red(`Error cleaning worktrees: ${error.message}`));
                }
            })
    );

// Interactive mode
program
    .command('interactive')
    .description('Start interactive mode')
    .action(async () => {
        console.log(chalk.bold('Welcome to Hanzo Dev Interactive Mode!\n'));
        
        while (true) {
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'What would you like to do?',
                    choices: [
                        { name: 'Run a tool', value: 'run' },
                        { name: 'Compare tools', value: 'compare' },
                        { name: 'Check job status', value: 'status' },
                        { name: 'Manage worktrees', value: 'worktree' },
                        { name: 'Exit', value: 'exit' }
                    ]
                }
            ]);
            
            if (action === 'exit') {
                console.log(chalk.gray('Goodbye!'));
                break;
            }
            
            // Handle different actions
            switch (action) {
                case 'run':
                    await interactiveRun();
                    break;
                case 'compare':
                    await interactiveCompare();
                    break;
                case 'status':
                    await program.parseAsync(['node', 'hanzo-dev', 'status']);
                    break;
                case 'worktree':
                    await program.parseAsync(['node', 'hanzo-dev', 'worktree', 'list']);
                    break;
            }
            
            console.log(''); // Add spacing
        }
    });

// Helper functions
function loadConfig(): any {
    const configPath = path.join(process.cwd(), '.hanzo-dev', 'config.json');
    
    if (!fs.existsSync(configPath)) {
        console.log(chalk.yellow('No config found. Run "hanzo-dev init" first.'));
        process.exit(1);
    }
    
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function findGitRoot(): string | null {
    try {
        const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
        return root;
    } catch {
        return null;
    }
}

function getToolCommand(tool: string): string {
    const commands = {
        claude: 'claude',
        codex: 'openai',
        gemini: 'gemini',
        openhands: 'openhands',
        aider: 'aider'
    };
    return commands[tool] || tool;
}

function getToolArgs(tool: string, task: string, options: any): string[] {
    const args = [];
    
    if (options.model) {
        args.push('--model', options.model);
    }
    
    if (options.files) {
        options.files.forEach(file => args.push(file));
    }
    
    args.push(task);
    
    return args;
}

function getStatusColor(status: string): (text: string) => string {
    switch (status) {
        case 'running':
            return chalk.green;
        case 'completed':
            return chalk.blue;
        case 'failed':
            return chalk.red;
        case 'idle':
            return chalk.yellow;
        default:
            return chalk.gray;
    }
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

async function interactiveRun(): Promise<void> {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'tool',
            message: 'Which tool would you like to use?',
            choices: ['claude', 'codex', 'gemini', 'openhands', 'aider']
        },
        {
            type: 'input',
            name: 'task',
            message: 'What task would you like to perform?'
        },
        {
            type: 'confirm',
            name: 'async',
            message: 'Run in background (async mode)?',
            default: false
        },
        {
            type: 'confirm',
            name: 'worktree',
            message: 'Create a separate git worktree?',
            default: false
        }
    ]);
    
    const args = ['node', 'hanzo-dev', 'run', answers.tool, answers.task];
    if (answers.async) args.push('--async');
    if (answers.worktree) args.push('--worktree');
    
    await program.parseAsync(args);
}

async function interactiveCompare(): Promise<void> {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'task',
            message: 'What task would you like to compare?'
        },
        {
            type: 'checkbox',
            name: 'tools',
            message: 'Which tools to compare?',
            choices: ['claude', 'codex', 'gemini', 'openhands', 'aider'],
            default: ['claude', 'codex', 'gemini']
        }
    ]);
    
    const args = ['node', 'hanzo-dev', 'compare', answers.task];
    if (answers.tools.length > 0) {
        args.push('--tools', ...answers.tools);
    }
    
    await program.parseAsync(args);
}

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}