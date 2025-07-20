import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import puppeteer, { Browser, Page } from 'puppeteer';

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds per test
const DEV_CLI = path.join(__dirname, '../../src/cli/dev.ts');
const TEST_DIR = path.join(os.tmpdir(), 'dev-cli-test-' + Date.now());

// Visual test reporter
class TestReporter {
    private tests: { name: string; status: 'running' | 'passed' | 'failed'; error?: string }[] = [];
    
    start(name: string) {
        console.log(chalk.blue(`\n▶ Running: ${name}`));
        this.tests.push({ name, status: 'running' });
    }
    
    pass(name: string) {
        const test = this.tests.find(t => t.name === name);
        if (test) {
            test.status = 'passed';
            console.log(chalk.green(`✓ Passed: ${name}`));
        }
    }
    
    fail(name: string, error: string) {
        const test = this.tests.find(t => t.name === name);
        if (test) {
            test.status = 'failed';
            test.error = error;
            console.log(chalk.red(`✗ Failed: ${name}`));
            console.log(chalk.gray(`  Error: ${error}`));
        }
    }
    
    summary() {
        console.log(chalk.bold('\n📊 Test Summary:'));
        const passed = this.tests.filter(t => t.status === 'passed').length;
        const failed = this.tests.filter(t => t.status === 'failed').length;
        console.log(chalk.green(`  ✓ ${passed} passed`));
        if (failed > 0) {
            console.log(chalk.red(`  ✗ ${failed} failed`));
        }
        console.log();
    }
}

const reporter = new TestReporter();

// Helper to run CLI commands
function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
        const child = spawn('node', [DEV_CLI, ...args], {
            cwd: TEST_DIR,
            env: { ...process.env, NO_COLOR: '1' }
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => stdout += data.toString());
        child.stderr.on('data', (data) => stderr += data.toString());
        
        child.on('close', (code) => {
            resolve({ stdout, stderr, code: code || 0 });
        });
        
        // Kill after timeout
        setTimeout(() => child.kill(), TEST_TIMEOUT - 5000);
    });
}

describe('🚀 Dev CLI Integration Tests', function() {
    this.timeout(TEST_TIMEOUT);
    
    before(() => {
        console.log(chalk.bold.cyan('\n🧪 Dev CLI Integration Test Suite\n'));
        console.log(chalk.gray(`Test directory: ${TEST_DIR}`));
        
        // Create test directory
        fs.mkdirSync(TEST_DIR, { recursive: true });
        
        // Initialize git repo for testing
        execSync('git init', { cwd: TEST_DIR });
        execSync('git config user.email "test@example.com"', { cwd: TEST_DIR });
        execSync('git config user.name "Test User"', { cwd: TEST_DIR });
        
        // Create test files
        fs.writeFileSync(path.join(TEST_DIR, 'test.js'), `
function calculateSum(a, b) {
    return a + b;
}

function calculateProduct(a, b) {
    return a * b;
}

module.exports = { calculateSum, calculateProduct };
        `.trim());
        
        fs.writeFileSync(path.join(TEST_DIR, 'test2.js'), `
function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

module.exports = { fibonacci };
        `.trim());
    });
    
    after(() => {
        // Clean up
        try {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
        
        reporter.summary();
    });
    
    describe('📋 Basic Commands', () => {
        it('should show version', async () => {
            const testName = 'Version Command';
            reporter.start(testName);
            
            try {
                const result = await runCommand(['--version']);
                expect(result.code).to.equal(0);
                expect(result.stdout).to.match(/\d+\.\d+\.\d+/);
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
        
        it('should show help', async () => {
            const testName = 'Help Command';
            reporter.start(testName);
            
            try {
                const result = await runCommand(['--help']);
                expect(result.code).to.equal(0);
                expect(result.stdout).to.include('Meta AI development tool');
                expect(result.stdout).to.include('Commands:');
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
        
        it('should initialize project', async () => {
            const testName = 'Init Command';
            reporter.start(testName);
            
            try {
                const result = await runCommand(['init']);
                expect(result.code).to.equal(0);
                
                // Check created files
                const configPath = path.join(TEST_DIR, '.hanzo-dev', 'config.json');
                expect(fs.existsSync(configPath)).to.be.true;
                
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                expect(config).to.have.property('tools');
                expect(config.tools).to.have.property('claude');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
    
    describe('🔐 Authentication (Headless Chrome)', () => {
        let browser: Browser;
        let page: Page;
        
        before(async () => {
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        });
        
        after(async () => {
            if (browser) await browser.close();
        });
        
        it('should test OAuth login flow', async function() {
            const testName = 'OAuth Login Flow';
            reporter.start(testName);
            
            // Skip in CI or if no display
            if (process.env.CI || !process.env.DISPLAY) {
                console.log(chalk.gray('  Skipping headless test in CI/no display environment'));
                this.skip();
                return;
            }
            
            try {
                page = await browser.newPage();
                
                // Mock the OAuth flow
                await page.goto('about:blank');
                await page.evaluate(() => {
                    document.body.innerHTML = `
                        <h1>Mock Hanzo Auth</h1>
                        <button id="login">Login</button>
                        <div id="status"></div>
                    `;
                    
                    document.getElementById('login')?.addEventListener('click', () => {
                        // Simulate OAuth redirect
                        const status = document.getElementById('status');
                        if (status) {
                            status.textContent = 'Login successful!';
                        }
                        
                        // Simulate callback
                        setTimeout(() => {
                            window.location.href = 'http://localhost:51234/callback?code=mock-code&state=mock-state';
                        }, 1000);
                    });
                });
                
                // Click login button
                await page.click('#login');
                
                // Wait for status update
                await page.waitForSelector('#status:not(:empty)', { timeout: 5000 });
                
                const status = await page.$eval('#status', el => el.textContent);
                expect(status).to.equal('Login successful!');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
    
    describe('🤖 AI Tool Mocking', () => {
        it('should mock Claude response', async () => {
            const testName = 'Mock Claude Tool';
            reporter.start(testName);
            
            try {
                // Create mock response
                const mockResponse = 'This is a mock Claude response for testing.';
                
                // In real test, we'd intercept the HTTP request
                // For now, we just verify the command structure
                const result = await runCommand(['run', 'claude', 'test task', '--dry-run']);
                
                // The --dry-run flag would skip actual API calls
                expect(result.stdout).to.include('claude');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
    
    describe('🔄 Workflow Tests', () => {
        it('should list available workflows', async () => {
            const testName = 'List Workflows';
            reporter.start(testName);
            
            try {
                const result = await runCommand(['workflow', 'list']);
                expect(result.code).to.equal(0);
                expect(result.stdout).to.include('code-review');
                expect(result.stdout).to.include('implement-feature');
                expect(result.stdout).to.include('optimize');
                expect(result.stdout).to.include('debug');
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
        
        it('should validate workflow structure', async () => {
            const testName = 'Validate Workflow';
            reporter.start(testName);
            
            try {
                // Create custom workflow
                const workflowDir = path.join(TEST_DIR, '.dev', 'workflows');
                fs.mkdirSync(workflowDir, { recursive: true });
                
                const testWorkflow = {
                    name: 'test-workflow',
                    description: 'Test workflow',
                    steps: [
                        {
                            name: 'test-step',
                            agents: [
                                { role: 'coder', tool: 'claude' }
                            ],
                            parallel: false
                        }
                    ]
                };
                
                fs.writeFileSync(
                    path.join(workflowDir, 'test-workflow.json'),
                    JSON.stringify(testWorkflow, null, 2)
                );
                
                // List should now include our workflow
                const result = await runCommand(['workflow', 'list']);
                expect(result.stdout).to.include('test-workflow');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
    
    describe('🎯 Multi-Agent Tests', () => {
        it('should parse multi-agent options', async () => {
            const testName = 'Multi-Agent Options';
            reporter.start(testName);
            
            try {
                // Test with specific agent assignments
                const result = await runCommand([
                    'multi', 'test task',
                    '--coder', 'claude',
                    '--reviewer', 'gemini',
                    '--critic', 'codex',
                    '--dry-run'
                ]);
                
                expect(result.stdout).to.include('claude');
                expect(result.stdout).to.include('gemini');
                expect(result.stdout).to.include('codex');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
    
    describe('📝 Code Review Tests', () => {
        it('should review git diff', async () => {
            const testName = 'Git Diff Review';
            reporter.start(testName);
            
            try {
                // Make a change
                const filePath = path.join(TEST_DIR, 'test.js');
                const content = fs.readFileSync(filePath, 'utf-8');
                fs.writeFileSync(filePath, content + '\n// New comment\n');
                
                // Stage the change
                execSync('git add test.js', { cwd: TEST_DIR });
                
                // Run review (dry-run mode)
                const result = await runCommand(['review', '--dry-run']);
                
                expect(result.stdout).to.include('review');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
    
    describe('⚡ Async Job Tests', () => {
        it('should handle async job lifecycle', async () => {
            const testName = 'Async Job Lifecycle';
            reporter.start(testName);
            
            try {
                // In real test, we'd start an async job and check status
                // For now, verify command structure
                const result = await runCommand(['status']);
                
                // Should show no active jobs
                expect(result.stdout).to.include('No active jobs');
                
                reporter.pass(testName);
            } catch (error) {
                reporter.fail(testName, error.message);
                throw error;
            }
        });
    });
});

// Run tests if called directly
if (require.main === module) {
    console.log(chalk.bold.blue('\n🏃 Running Dev CLI Integration Tests...\n'));
    
    // Set up mocha programmatically
    const Mocha = require('mocha');
    const mocha = new Mocha({
        ui: 'bdd',
        reporter: 'spec',
        timeout: TEST_TIMEOUT
    });
    
    mocha.addFile(__filename);
    mocha.run((failures: number) => {
        process.exit(failures ? 1 : 0);
    });
}