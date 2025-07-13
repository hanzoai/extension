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
import { MultiAgentOrchestrator } from '../cli-tools/orchestration/multi-agent-orchestrator';

const program = new Command();
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));

program
    .name('dev')
    .description('Dev - Meta AI development tool that manages and runs all LLMs and CLI tools')
    .version(packageJson.version);

// Global instances
const auth = new HanzoAuth();
const orchestrator = new MultiAgentOrchestrator();

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

// Workflow command - run predefined workflows
program
    .command('workflow <name> [task...]')
    .description('Run a predefined AI workflow (code-review, implement-feature, optimize, debug)')
    .option('-d, --directory <dir>', 'Working directory')
    .option('--list', 'List available workflows')
    .action(async (name, taskParts, options) => {
        if (options.list || name === 'list') {
            const workflows = orchestrator.getWorkflows();
            console.log(chalk.bold('Available Workflows:\n'));
            for (const workflow of workflows) {
                console.log(chalk.cyan(`${workflow.name}`) + ` - ${workflow.description}`);
                console.log(chalk.gray(`  Steps: ${workflow.steps.map(s => s.name).join(' → ')}\n`));
            }
            return;
        }
        
        const task = taskParts.join(' ');
        const spinner = ora(`Running ${name} workflow...`).start();
        
        try {
            await orchestrator.initialize();
            const result = await orchestrator.runWorkflow(name, task, {
                directory: options.directory
            });
            
            spinner.succeed(`Workflow ${name} completed!`);
            console.log('\n' + result);
        } catch (error) {
            spinner.fail(`Workflow failed: ${error.message}`);
            process.exit(1);
        }
    });

// Review command - intelligent code review
program
    .command('review [files...]')
    .description('Run AI code review with multiple agents')
    .option('-t, --type <type>', 'Review type: quick, standard, deep', 'standard')
    .action(async (files, options) => {
        const spinner = ora('Starting code review...').start();
        
        try {
            await orchestrator.initialize();
            
            // Read files or use git diff
            let codeToReview = '';
            if (files.length > 0) {
                for (const file of files) {
                    if (fs.existsSync(file)) {
                        codeToReview += `\n\n### ${file}\n\n${fs.readFileSync(file, 'utf-8')}`;
                    }
                }
            } else {
                // Use git diff
                try {
                    codeToReview = execSync('git diff --cached', { encoding: 'utf-8' });
                    if (!codeToReview) {
                        codeToReview = execSync('git diff', { encoding: 'utf-8' });
                    }
                } catch {
                    spinner.fail('No files specified and no git changes found');
                    return;
                }
            }
            
            const result = await orchestrator.runWorkflow('code-review', codeToReview);
            spinner.succeed('Code review completed!');
            console.log('\n' + result);
        } catch (error) {
            spinner.fail(`Review failed: ${error.message}`);
            process.exit(1);
        }
    });

// Multi command - run custom multi-agent tasks
program
    .command('multi <task>')
    .description('Run a task with multiple AI agents in parallel')
    .option('--coder <tool>', 'Tool for coding (claude, codex, aider, openhands)')
    .option('--reviewer <tool>', 'Tool for review (gemini, claude)')
    .option('--critic <tool>', 'Tool for critique (codex, gemini)')
    .option('--local <model>', 'Use local LLM with specified model')
    .action(async (task, options) => {
        const spinner = ora('Running multi-agent task...').start();
        
        try {
            await orchestrator.initialize();
            
            const agents = [];
            if (options.coder) {
                agents.push({ role: 'coder', tool: options.coder });
            }
            if (options.reviewer) {
                agents.push({ role: 'reviewer', tool: options.reviewer });
            }
            if (options.critic) {
                agents.push({ role: 'critic', tool: options.critic });
            }
            if (options.local) {
                agents.push({ role: 'coder', tool: 'local-llm', model: options.local });
            }
            
            if (agents.length === 0) {
                // Default agents
                agents.push(
                    { role: 'coder', tool: 'claude' },
                    { role: 'reviewer', tool: 'gemini' },
                    { role: 'critic', tool: 'codex' }
                );
            }
            
            const results = await orchestrator.runCustomAgents(task, agents);
            spinner.succeed('Multi-agent task completed!');
            
            console.log(chalk.bold('\nResults from each agent:\n'));
            for (const [agent, output] of results) {
                console.log(chalk.cyan(`${agent}:`));
                console.log(output);
                console.log(chalk.gray('\n' + '-'.repeat(80) + '\n'));
            }
        } catch (error) {
            spinner.fail(`Multi-agent task failed: ${error.message}`);
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
            
            for (const [tool, result] of results) {
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

// Swarm command - manage agent swarms
program
    .command('swarm')
    .description('Manage AI agent swarms for complex multi-agent workflows')
    .addCommand(
        new Command('init')
            .description('Initialize a new agent swarm configuration')
            .option('-p, --path <path>', 'Path for the configuration file', '.hanzo/agents.yaml')
            .option('--peer-network', 'Initialize as peer network with Hanzo Zen main loop')
            .action(async (options) => {
                const spinner = ora('Initializing agent swarm configuration...').start();
                
                try {
                    const { AgentSwarmManager } = await import('../cli-tools/config/agent-swarm-config');
                    
                    if (options.peerNetwork) {
                        // Create peer network configuration
                        await AgentSwarmManager.initPeerNetworkConfig(options.path);
                        spinner.succeed('Peer network configuration initialized with Hanzo Zen!');
                        console.log(chalk.cyan('Using Hanzo Zen for cost-effective local orchestration'));
                    } else {
                        await AgentSwarmManager.initConfig(options.path);
                        spinner.succeed('Agent swarm configuration initialized!');
                    }
                    
                    console.log(chalk.gray(`Edit the configuration file to customize your agent swarm.`));
                } catch (error) {
                    spinner.fail(`Failed to initialize: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        new Command('run <task>')
            .description('Run a task with the configured agent swarm')
            .option('-c, --config <path>', 'Path to agent configuration file')
            .option('--peer', 'Run as peer network with Hanzo Zen orchestration')
            .option('--critic', 'Include critic analysis in results')
            .option('--local-llm <endpoint>', 'Local LLM endpoint', 'http://localhost:8080')
            .action(async (task, options) => {
                const spinner = ora('Starting agent swarm...').start();
                
                try {
                    if (options.peer) {
                        // Use peer network with local Hanzo Zen
                        const { PeerAgentNetwork } = await import('../cli-tools/orchestration/peer-agent-network');
                        
                        const network = new PeerAgentNetwork({
                            mainLoopLLM: {
                                model: 'hanzo-zen',
                                endpoint: options.localLlm
                            },
                            enableRecursiveCalls: true,
                            maxRecursionDepth: 10,
                            costOptimization: true
                        });
                        
                        await network.initialize();
                        spinner.succeed('Peer network initialized with Hanzo Zen');
                        
                        console.log(chalk.cyan('\n🌐 Executing with peer network...'));
                        console.log(chalk.gray('Using local Hanzo Zen for orchestration (cost-optimized)'));
                        
                        const results = await network.executeTask(task, {
                            requireCritic: options.critic
                        });
                        
                        console.log(chalk.bold('\n📊 Peer Network Results:\n'));
                        console.log(JSON.stringify(results, null, 2));
                        
                        await network.shutdown();
                    } else {
                        // Traditional swarm orchestration
                        const { SwarmOrchestrator } = await import('../cli-tools/orchestration/swarm-orchestrator');
                        const orchestrator = new SwarmOrchestrator();
                        
                        // Initialize with custom config path if provided
                        if (options.config) {
                            const { AgentSwarmManager } = await import('../cli-tools/config/agent-swarm-config');
                            const manager = new AgentSwarmManager(options.config);
                            await manager.loadConfig();
                        }
                        
                        await orchestrator.initialize();
                        spinner.succeed('Agent swarm initialized');
                        
                        console.log(chalk.cyan('\nExecuting task with agent swarm...'));
                        const results = await orchestrator.executeTask(task);
                        
                        console.log(chalk.bold('\n📊 Swarm Results:\n'));
                        for (const result of results) {
                            console.log(chalk.cyan(`🤖 ${result.agentName}:`));
                            if (result.error) {
                                console.log(chalk.red(`   ❌ Error: ${result.error}`));
                            } else {
                                console.log(`   ✅ Completed in ${result.duration}ms`);
                                console.log(chalk.gray(`   ${result.result.substring(0, 200)}...`));
                            }
                            console.log();
                        }
                        
                        await orchestrator.shutdown();
                    }
                } catch (error) {
                    spinner.fail(`Execution failed: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        new Command('status')
            .description('Show status of the current agent swarm')
            .option('-c, --config <path>', 'Path to agent configuration file')
            .action(async (options) => {
                try {
                    const { SwarmOrchestrator } = await import('../cli-tools/orchestration/swarm-orchestrator');
                    const orchestrator = new SwarmOrchestrator();
                    
                    if (options.config) {
                        const { AgentSwarmManager } = await import('../cli-tools/config/agent-swarm-config');
                        const manager = new AgentSwarmManager(options.config);
                        await manager.loadConfig();
                    }
                    
                    await orchestrator.initialize();
                    const status = orchestrator.getStatus();
                    
                    console.log(chalk.bold('🐝 Agent Swarm Status\n'));
                    
                    // Show agents
                    console.log(chalk.cyan('Agents:'));
                    for (const [name, agent] of Object.entries(status.agents)) {
                        const statusColor = agent.status === 'active' ? chalk.green : chalk.gray;
                        console.log(`  ${statusColor('●')} ${name} - ${agent.model} (${agent.directory})`);
                    }
                    
                    // Show MCP servers
                    if (Object.keys(status.mcpServers).length > 0) {
                        console.log(chalk.cyan('\nMCP Servers:'));
                        for (const [key, server] of Object.entries(status.mcpServers)) {
                            const statusColor = server.status === 'running' ? chalk.green : chalk.red;
                            console.log(`  ${statusColor('●')} ${key} - ${server.config.command}`);
                        }
                    }
                    
                    // Show recent results
                    if (status.results.length > 0) {
                        console.log(chalk.cyan('\nRecent Results:'));
                        for (const result of status.results) {
                            const icon = result.error ? '❌' : '✅';
                            console.log(`  ${icon} ${result.agentName} - ${result.duration}ms`);
                        }
                    }
                    
                    await orchestrator.shutdown();
                } catch (error) {
                    console.error(chalk.red(`Error checking status: ${error.message}`));
                    process.exit(1);
                }
            })
    )
    .addCommand(
        new Command('network <networkName> [task]')
            .description('Run a task with agents in a specific network')
            .option('-c, --config <path>', 'Path to agent configuration file')
            .action(async (networkName, task, options) => {
                const spinner = ora('Starting network agents...').start();
                
                try {
                    const { SwarmOrchestrator } = await import('../cli-tools/orchestration/swarm-orchestrator');
                    const { AgentSwarmManager } = await import('../cli-tools/config/agent-swarm-config');
                    
                    const manager = new AgentSwarmManager(options.config);
                    await manager.loadConfig();
                    
                    const network = manager.getNetwork(networkName);
                    if (!network) {
                        spinner.fail(`Network '${networkName}' not found`);
                        return;
                    }
                    
                    spinner.succeed(`Network '${networkName}' loaded`);
                    console.log(chalk.cyan(`\nAgents in network: ${network.agents.join(', ')}`));
                    
                    if (task) {
                        const orchestrator = new SwarmOrchestrator();
                        await orchestrator.initialize();
                        
                        console.log(chalk.cyan('\nExecuting task with network agents...'));
                        
                        // Execute task with first agent in network as main
                        const mainAgent = network.agents[0];
                        const results = await orchestrator.executeTask(task);
                        
                        console.log(chalk.bold('\n📊 Network Results:\n'));
                        for (const result of results) {
                            if (network.agents.includes(result.agentName)) {
                                console.log(chalk.cyan(`🤖 ${result.agentName}:`));
                                if (result.error) {
                                    console.log(chalk.red(`   ❌ Error: ${result.error}`));
                                } else {
                                    console.log(`   ✅ Completed in ${result.duration}ms`);
                                    console.log(chalk.gray(`   ${result.result.substring(0, 200)}...`));
                                }
                                console.log();
                            }
                        }
                        
                        await orchestrator.shutdown();
                    } else {
                        console.log(chalk.gray('\nProvide a task to execute with this network'));
                    }
                } catch (error) {
                    spinner.fail(`Network operation failed: ${error.message}`);
                    process.exit(1);
                }
            })
    )
    .addCommand(
        new Command('chat')
            .description('Start an interactive chat session between agents')
            .option('-c, --config <path>', 'Path to agent configuration file')
            .option('-f, --from <agent>', 'Agent to chat from', 'project_manager')
            .option('-t, --to <agent>', 'Agent to chat with')
            .action(async (options) => {
                try {
                    const { SwarmOrchestrator } = await import('../cli-tools/orchestration/swarm-orchestrator');
                    const { AgentSwarmManager } = await import('../cli-tools/config/agent-swarm-config');
                    
                    const manager = new AgentSwarmManager(options.config);
                    await manager.loadConfig();
                    
                    const fromAgent = manager.getAgent(options.from);
                    const toAgent = options.to ? manager.getAgent(options.to) : null;
                    
                    if (!fromAgent) {
                        console.error(chalk.red(`Agent '${options.from}' not found`));
                        return;
                    }
                    
                    console.log(chalk.bold('🗨️  Agent Chat Session\n'));
                    console.log(chalk.cyan(`Chatting as: ${options.from}`));
                    
                    if (toAgent) {
                        console.log(chalk.cyan(`Chatting with: ${options.to}`));
                    } else {
                        console.log(chalk.gray('Type "@agent_name message" to chat with a specific agent'));
                    }
                    
                    console.log(chalk.gray('Type "exit" to end the session\n'));
                    
                    const orchestrator = new SwarmOrchestrator();
                    await orchestrator.initialize();
                    
                    // Interactive chat loop
                    while (true) {
                        const { message } = await inquirer.prompt([{
                            type: 'input',
                            name: 'message',
                            message: `${options.from}>`,
                        }]);
                        
                        if (message.toLowerCase() === 'exit') {
                            break;
                        }
                        
                        // Parse @mentions
                        const mentionMatch = message.match(/^@(\w+)\s+(.+)/);
                        const targetAgent = mentionMatch ? mentionMatch[1] : options.to;
                        const actualMessage = mentionMatch ? mentionMatch[2] : message;
                        
                        if (!targetAgent) {
                            console.log(chalk.yellow('Please specify a target agent with @agent_name or use -t flag'));
                            continue;
                        }
                        
                        const spinner = ora(`${options.from} is thinking...`).start();
                        
                        try {
                            // Simulate the from agent using MCP to chat with target
                            const prompt = `You need to send this message to ${targetAgent}: "${actualMessage}"\n\n` +
                                         `Use the chat_with_${targetAgent} tool to send the message and get a response.`;
                            
                            const result = await orchestrator.executeAgentTask(options.from, prompt);
                            
                            spinner.stop();
                            console.log(chalk.green(`\n${targetAgent}> ${result}\n`));
                        } catch (error) {
                            spinner.fail(`Chat failed: ${error.message}`);
                        }
                    }
                    
                    await orchestrator.shutdown();
                    console.log(chalk.gray('\nChat session ended'));
                } catch (error) {
                    console.error(chalk.red(`Error: ${error.message}`));
                    process.exit(1);
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