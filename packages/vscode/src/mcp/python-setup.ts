import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as util from 'util';

const exec = util.promisify(cp.exec);

export class PythonSdkSetup {
    private context: vscode.ExtensionContext;
    private readonly serverName = 'hanzo-python';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async setup() {
        const config = vscode.workspace.getConfiguration('hanzo');
        const mcpEnabled = config.get<boolean>('mcp.enabled', true);

        if (!mcpEnabled) {
            return;
        }

        // Check if already configured
        const servers = this.context.globalState.get<any[]>('hanzo.mcpServers', []);
        if (servers.find(s => s.name === this.serverName)) {
            console.log('[Hanzo] Python SDK already configured');
            return;
        }

        // Strategy 1: Check Local Dev Repo
        // This is primarily for the "Unified Hanzo Experience" for internal/power users
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const localRepoPath = path.join(homeDir, 'work', 'hanzo', 'python-sdk');

        if (fs.existsSync(localRepoPath)) {
            await this.setupLocalRepo(localRepoPath);
            return;
        }

        // Strategy 2: Check Global Pip Package
        try {
            await exec('pip show hanzo-mcp');
            await this.setupGlobalPackage();
            return;
        } catch (e) {
            // Not installed globally
        }

        // Strategy 3: Prompt to Install
        // We generally avoid blocking startup with modals, but a discrete notification is okay
        // Or we just stay silent until they ask for it. 
        // For now, let's log availability but not force install to avoid annoyance.
        console.log('[Hanzo] Python SDK not found. Skipping auto-setup.');
    }

    private async setupLocalRepo(repoPath: string) {
        console.log('[Hanzo] Found local Python SDK at', repoPath);

        const venvPath = path.join(repoPath, '.venv');
        const pythonPath = path.join(venvPath, 'bin', 'python');
        const pkgPath = path.join(repoPath, 'pkg', 'hanzo-mcp');

        // Check if venv exists
        if (!fs.existsSync(pythonPath)) {
            const answer = await vscode.window.showInformationMessage(
                'Hanzo Python SDK found. Initialize virtual environment?',
                'Yes', 'No'
            );

            if (answer === 'Yes') {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Setting up Hanzo Python SDK...',
                    cancellable: false
                }, async () => {
                    // Try using uv if available, else standard python venv
                    try {
                        await exec('uv sync', { cwd: repoPath });
                    } catch {
                        // Fallback
                        await exec('python3 -m venv .venv', { cwd: repoPath });
                        await exec(`${pythonPath} -m pip install -e pkg/hanzo-mcp`, { cwd: repoPath });
                    }
                });
            } else {
                return;
            }
        }

        // Register Server
        const serverConfig = {
            name: this.serverName,
            command: pythonPath,
            args: ['-m', 'hanzo_mcp', '--stdio'],
            env: {
                'PYTHONPATH': pkgPath,
                'HANZO_MCP_unified': 'true'
            },
            transport: 'stdio',
            status: 'stopped'
        };

        const servers = this.context.globalState.get<any[]>('hanzo.mcpServers', []);
        servers.push(serverConfig);
        await this.context.globalState.update('hanzo.mcpServers', servers);

        vscode.window.showInformationMessage(`Hanzo Python SDK registered as '${this.serverName}'!`);
    }

    private async setupGlobalPackage() {
        console.log('[Hanzo] Found global hanzo-mcp package');

        // Find python executable
        let pythonPath = 'python3';
        try {
            const { stdout } = await exec('which python3');
            pythonPath = stdout.trim();
        } catch { }

        const serverConfig = {
            name: this.serverName,
            command: pythonPath,
            args: ['-m', 'hanzo_mcp', '--stdio'],
            transport: 'stdio',
            status: 'stopped'
        };

        const servers = this.context.globalState.get<any[]>('hanzo.mcpServers', []);
        servers.push(serverConfig);
        await this.context.globalState.update('hanzo.mcpServers', servers);

        vscode.window.showInformationMessage(`Hanzo Python SDK registered as '${this.serverName}'!`);
    }
}
