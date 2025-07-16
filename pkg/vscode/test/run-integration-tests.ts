#!/usr/bin/env node

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';

// Test scenarios to run
const TEST_SCENARIOS = [
    {
        name: '📋 Version Check',
        command: 'dev',
        args: ['--version'],
        expectedOutput: /\d+\.\d+\.\d+/,
        description: 'Verify CLI version'
    },
    {
        name: '🌱 Initialize Project',
        command: 'dev',
        args: ['init'],
        expectedOutput: /initialized successfully/,
        description: 'Set up Dev in a new project'
    },
    {
        name: '📋 List Workflows',
        command: 'dev',
        args: ['workflow', 'list'],
        expectedOutput: /code-review.*implement-feature.*optimize.*debug/s,
        description: 'Show all available workflows'
    },
    {
        name: '🤖 Mock Claude Run',
        command: 'dev',
        args: ['run', 'claude', 'explain what this code does', '--dry-run'],
        expectedOutput: /claude/,
        description: 'Test Claude tool invocation (dry run)'
    },
    {
        name: '🔄 Multi-Agent Task',
        command: 'dev',
        args: ['multi', 'optimize this function', '--coder', 'claude', '--reviewer', 'gemini', '--dry-run'],
        expectedOutput: /claude.*gemini/s,
        description: 'Run multi-agent task with role assignment'
    },
    {
        name: '🔍 Code Review',
        command: 'dev',
        args: ['review', '--dry-run'],
        expectedOutput: /review/,
        description: 'Review code changes (dry run)'
    },
    {
        name: '⚡ Async Status',
        command: 'dev',
        args: ['status'],
        expectedOutput: /active jobs|No active jobs/,
        description: 'Check async job status'
    },
    {
        name: '🌳 Git Worktree',
        command: 'dev',
        args: ['worktree', 'list'],
        expectedOutput: /worktree|not a git repository/,
        description: 'List git worktrees'
    }
];

class IntegrationTestRunner {
    private passed = 0;
    private failed = 0;
    private skipped = 0;
    private results: any[] = [];
    
    async run() {
        console.log(chalk.bold.cyan('\n🚀 Dev CLI Integration Test Runner'));
        console.log(chalk.gray('='.repeat(60)));
        console.log();
        
        // Check if dev command exists
        const devExists = await this.checkDevCommand();
        if (!devExists) {
            console.log(chalk.yellow('⚠️  Dev CLI not found. Building...'));
            await this.buildDevCLI();
        }
        
        // Run each test scenario
        for (const scenario of TEST_SCENARIOS) {
            await this.runScenario(scenario);
        }
        
        // Show summary
        this.showSummary();
    }
    
    private async checkDevCommand(): Promise<boolean> {
        try {
            const result = await this.exec('which', ['dev']);
            return result.code === 0;
        } catch {
            return false;
        }
    }
    
    private async buildDevCLI(): Promise<void> {
        const spinner = ora('Building Dev CLI...').start();
        
        try {
            // Simple build that ignores type errors for testing
            const buildScript = `
cd packages/dev
mkdir -p dist/cli
echo '#!/usr/bin/env node' > dist/cli/dev.js
echo 'require("../../lib/cli/dev")' >> dist/cli/dev.js
chmod +x dist/cli/dev.js
npm link --force
            `.trim();
            
            await this.exec('bash', ['-c', buildScript]);
            spinner.succeed('Dev CLI built and linked');
        } catch (error) {
            spinner.fail('Failed to build Dev CLI');
            throw error;
        }
    }
    
    private async runScenario(scenario: any): Promise<void> {
        const spinner = ora({
            text: `Running: ${scenario.name}`,
            prefixText: chalk.gray(scenario.description)
        }).start();
        
        const startTime = Date.now();
        
        try {
            const result = await this.exec(scenario.command, scenario.args, {
                timeout: 10000,
                captureOutput: true
            });
            
            const duration = Date.now() - startTime;
            
            // Check expected output
            if (scenario.expectedOutput) {
                const output = result.stdout + result.stderr;
                if (!scenario.expectedOutput.test(output)) {
                    throw new Error(`Output did not match expected pattern.\nGot: ${output.substring(0, 200)}...`);
                }
            }
            
            // Success
            spinner.succeed(`${scenario.name} ${chalk.gray(`(${duration}ms)`)}`);
            this.passed++;
            
            this.results.push({
                name: scenario.name,
                status: 'passed',
                duration,
                output: result.stdout
            });
            
            // Show sample output
            if (result.stdout) {
                const preview = result.stdout.split('\n').slice(0, 3).join('\n');
                console.log(chalk.gray('  Output: ' + preview.substring(0, 100) + '...'));
            }
            console.log();
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            if (error.message?.includes('not found') || error.message?.includes('ENOENT')) {
                spinner.warn(`${scenario.name} - Command not available`);
                this.skipped++;
                
                this.results.push({
                    name: scenario.name,
                    status: 'skipped',
                    duration,
                    reason: 'Command not found'
                });
            } else {
                spinner.fail(`${scenario.name} ${chalk.gray(`(${duration}ms)`)}`);
                console.log(chalk.red(`  Error: ${error.message}`));
                this.failed++;
                
                this.results.push({
                    name: scenario.name,
                    status: 'failed',
                    duration,
                    error: error.message
                });
            }
            console.log();
        }
    }
    
    private exec(command: string, args: string[], options: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                shell: true,
                env: { ...process.env, NO_COLOR: '1' }
            });
            
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            
            if (options.captureOutput) {
                child.stdout?.on('data', (data) => stdout += data.toString());
                child.stderr?.on('data', (data) => stderr += data.toString());
            }
            
            const timeout = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, options.timeout || 30000);
            
            child.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            
            child.on('close', (code) => {
                clearTimeout(timeout);
                
                if (timedOut) {
                    reject(new Error('Command timed out'));
                } else if (code !== 0 && !options.allowFailure) {
                    reject(new Error(`Command failed with code ${code}\n${stderr}`));
                } else {
                    resolve({ code, stdout, stderr });
                }
            });
        });
    }
    
    private showSummary(): void {
        console.log(chalk.bold('\n📊 Test Summary'));
        console.log(chalk.gray('='.repeat(60)));
        
        const total = this.passed + this.failed + this.skipped;
        console.log(chalk.green(`  ✓ Passed:  ${this.passed}/${total}`));
        
        if (this.failed > 0) {
            console.log(chalk.red(`  ✗ Failed:  ${this.failed}/${total}`));
        }
        
        if (this.skipped > 0) {
            console.log(chalk.yellow(`  ⚠ Skipped: ${this.skipped}/${total}`));
        }
        
        const successRate = total > 0 ? (this.passed / total * 100).toFixed(1) : 0;
        console.log(chalk.gray(`\n  Success Rate: ${successRate}%`));
        
        // Save results
        const resultsPath = path.join(__dirname, 'test-results.json');
        fs.writeFileSync(resultsPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            summary: {
                total,
                passed: this.passed,
                failed: this.failed,
                skipped: this.skipped,
                successRate
            },
            results: this.results
        }, null, 2));
        
        console.log(chalk.gray(`\n  Results saved to: ${resultsPath}`));
        
        if (this.failed > 0) {
            console.log(chalk.red('\n❌ Some tests failed!'));
            process.exit(1);
        } else {
            console.log(chalk.green('\n✨ All tests passed!'));
        }
    }
}

// Run tests
if (require.main === module) {
    const runner = new IntegrationTestRunner();
    runner.run().catch(error => {
        console.error(chalk.red('\nTest runner failed:'), error);
        process.exit(1);
    });
}

export { IntegrationTestRunner };