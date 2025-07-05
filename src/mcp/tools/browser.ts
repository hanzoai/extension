import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface BrowserAction {
    action: 'navigate' | 'screenshot' | 'click' | 'type' | 'extract' | 'wait' | 'evaluate';
    url?: string;
    selector?: string;
    text?: string;
    script?: string;
    timeout?: number;
    outputPath?: string;
}

export function createBrowserTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'browser',
            description: 'Control a browser instance via Playwright. Automatically installs Playwright MCP if needed.',
            inputSchema: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['navigate', 'screenshot', 'click', 'type', 'extract', 'wait', 'evaluate', 'install'],
                        description: 'Browser action to perform'
                    },
                    url: {
                        type: 'string',
                        description: 'URL to navigate to (for navigate action)'
                    },
                    selector: {
                        type: 'string',
                        description: 'CSS selector for click/type/extract actions'
                    },
                    text: {
                        type: 'string',
                        description: 'Text to type (for type action)'
                    },
                    script: {
                        type: 'string',
                        description: 'JavaScript to evaluate (for evaluate action)'
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds (default: 30000)',
                        default: 30000
                    },
                    outputPath: {
                        type: 'string',
                        description: 'Path to save screenshot (for screenshot action)'
                    }
                },
                required: ['action']
            },
            handler: async (args: BrowserAction) => {
                const playwrightMcpPath = await ensurePlaywrightMCP(context);
                
                if (args.action === 'install') {
                    return `✅ Playwright MCP installed at: ${playwrightMcpPath}`;
                }
                
                // Check if browser instance is running
                const browserState = context.globalState.get<{ pid?: number }>('browserState', {});
                
                if (!browserState.pid || !isProcessRunning(browserState.pid)) {
                    // Start browser instance
                    const result = await startBrowser(context, playwrightMcpPath);
                    if (result.error) {
                        return `Error starting browser: ${result.error}`;
                    }
                    browserState.pid = result.pid;
                    await context.globalState.update('browserState', browserState);
                }
                
                // Execute browser action
                try {
                    const result = await executeBrowserAction(args, playwrightMcpPath);
                    return result;
                } catch (error: any) {
                    return `Browser action failed: ${error.message}`;
                }
            }
        },
        {
            name: 'browser_close',
            description: 'Close the browser instance',
            inputSchema: {
                type: 'object',
                properties: {}
            },
            handler: async () => {
                const browserState = context.globalState.get<{ pid?: number }>('browserState', {});
                
                if (browserState.pid && isProcessRunning(browserState.pid)) {
                    process.kill(browserState.pid);
                    await context.globalState.update('browserState', {});
                    return '✅ Browser closed';
                }
                
                return 'No browser instance running';
            }
        }
    ];
}

async function ensurePlaywrightMCP(context: vscode.ExtensionContext): Promise<string> {
    const extensionPath = context.extensionPath;
    const playwrightDir = path.join(extensionPath, '.playwright-mcp');
    const mcpServerPath = path.join(playwrightDir, 'node_modules', '@modelcontextprotocol', 'server-playwright', 'dist', 'index.js');
    
    // Check if already installed
    if (fs.existsSync(mcpServerPath)) {
        return mcpServerPath;
    }
    
    // Install Playwright MCP
    console.log('Installing Playwright MCP server...');
    
    // Create directory
    if (!fs.existsSync(playwrightDir)) {
        fs.mkdirSync(playwrightDir, { recursive: true });
    }
    
    // Create package.json
    const packageJson = {
        name: 'playwright-mcp-wrapper',
        version: '1.0.0',
        private: true,
        dependencies: {
            '@modelcontextprotocol/server-playwright': 'latest',
            'playwright': 'latest'
        }
    };
    
    fs.writeFileSync(
        path.join(playwrightDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
    );
    
    // Install dependencies
    return new Promise((resolve, reject) => {
        const npm = cp.spawn('npm', ['install'], {
            cwd: playwrightDir,
            stdio: 'pipe'
        });
        
        npm.on('close', (code) => {
            if (code === 0) {
                // Install browsers
                const npx = cp.spawn('npx', ['playwright', 'install', 'chromium'], {
                    cwd: playwrightDir,
                    stdio: 'pipe'
                });
                
                npx.on('close', (code) => {
                    if (code === 0) {
                        resolve(mcpServerPath);
                    } else {
                        reject(new Error('Failed to install Playwright browsers'));
                    }
                });
            } else {
                reject(new Error('Failed to install Playwright MCP'));
            }
        });
    });
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function startBrowser(context: vscode.ExtensionContext, mcpServerPath: string): Promise<{ pid?: number; error?: string }> {
    return new Promise((resolve) => {
        const browser = cp.spawn('node', [mcpServerPath], {
            stdio: 'pipe',
            env: {
                ...process.env,
                PLAYWRIGHT_BROWSERS_PATH: path.join(context.extensionPath, '.playwright-mcp', 'browsers')
            }
        });
        
        browser.on('error', (error) => {
            resolve({ error: error.message });
        });
        
        browser.stdout.on('data', (data) => {
            console.log('Browser stdout:', data.toString());
        });
        
        browser.stderr.on('data', (data) => {
            console.error('Browser stderr:', data.toString());
        });
        
        // Give browser time to start
        setTimeout(() => {
            resolve({ pid: browser.pid });
        }, 2000);
    });
}

async function executeBrowserAction(action: BrowserAction, mcpServerPath: string): Promise<string> {
    // For now, we'll execute actions through a simple command interface
    // In a full implementation, this would communicate with the MCP server
    
    const command = buildPlaywrightCommand(action);
    
    return new Promise((resolve, reject) => {
        cp.exec(command, { 
            env: {
                ...process.env,
                NODE_PATH: path.dirname(mcpServerPath)
            }
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Browser action failed: ${error.message}\n${stderr}`));
            } else {
                resolve(formatActionResult(action, stdout));
            }
        });
    });
}

function buildPlaywrightCommand(action: BrowserAction): string {
    const script = `
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    
    try {
        ${generateActionCode(action)}
    } finally {
        // Keep browser open for reuse
        // await browser.close();
    }
})();
    `;
    
    return `node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function generateActionCode(action: BrowserAction): string {
    switch (action.action) {
        case 'navigate':
            return `await page.goto('${action.url}', { timeout: ${action.timeout} });
                    console.log('Navigated to:', '${action.url}');`;
        
        case 'screenshot':
            const screenshotPath = action.outputPath || 'screenshot.png';
            return `await page.screenshot({ path: '${screenshotPath}' });
                    console.log('Screenshot saved to:', '${screenshotPath}');`;
        
        case 'click':
            return `await page.click('${action.selector}', { timeout: ${action.timeout} });
                    console.log('Clicked:', '${action.selector}');`;
        
        case 'type':
            return `await page.type('${action.selector}', '${action.text}', { timeout: ${action.timeout} });
                    console.log('Typed text into:', '${action.selector}');`;
        
        case 'extract':
            return `const text = await page.textContent('${action.selector}');
                    console.log('Extracted:', text);`;
        
        case 'wait':
            return `await page.waitForSelector('${action.selector}', { timeout: ${action.timeout} });
                    console.log('Element appeared:', '${action.selector}');`;
        
        case 'evaluate':
            return `const result = await page.evaluate(() => { ${action.script} });
                    console.log('Evaluation result:', JSON.stringify(result));`;
        
        default:
            return `console.log('Unknown action: ${action.action}');`;
    }
}

function formatActionResult(action: BrowserAction, output: string): string {
    const lines = output.trim().split('\n');
    const lastLine = lines[lines.length - 1] || '';
    
    switch (action.action) {
        case 'navigate':
            return `✅ Navigated to: ${action.url}`;
        
        case 'screenshot':
            return `📸 Screenshot saved to: ${action.outputPath || 'screenshot.png'}`;
        
        case 'click':
            return `🖱️ Clicked element: ${action.selector}`;
        
        case 'type':
            return `⌨️ Typed "${action.text}" into: ${action.selector}`;
        
        case 'extract':
            return `📝 Extracted text: ${lastLine.replace('Extracted: ', '')}`;
        
        case 'wait':
            return `⏳ Element appeared: ${action.selector}`;
        
        case 'evaluate':
            return `🔧 Evaluation result: ${lastLine.replace('Evaluation result: ', '')}`;
        
        default:
            return output;
    }
}