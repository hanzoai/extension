import * as vscode from 'vscode';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { getConfig } from './config';
import { FileCollectionService } from './services/FileCollectionService';
import { AuthManager } from './auth/manager';
import { ApiClient } from './api/client';
import { StatusBarService } from './services/StatusBarService';
import { AnalysisService } from './services/AnalysisService';
import { HanzoMetricsService } from './services/HanzoMetricsService';
// Text content utilities imported if needed

export class ProjectManager {
    private panel: vscode.WebviewPanel;
    private context: vscode.ExtensionContext;
    private config = getConfig();
    private gzip = promisify(zlib.gzip);
    private apiClient: ApiClient;
    private statusBar: StatusBarService;
    private metricsService: HanzoMetricsService;

    constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.context = context;
        this.apiClient = new ApiClient(context);
        this.statusBar = StatusBarService.getInstance();
        this.metricsService = HanzoMetricsService.getInstance(context);

        // Initialize webview with cached details if panel exists
        if (panel) {
            const cachedDetails = this.context.globalState.get('projectAnalysisDetails', '');
            panel.webview.postMessage({
                command: 'loadProjectDetails',
                details: cachedDetails
            });
        }
    }

    async handleMessage(message: any) {
        switch (message.command) {
            case 'analyzeProject':
                await this.analyzeProject();
                break;
            case 'exportSpecification':
                await this.exportSpecification();
                break;
            case 'openFile':
                await this.openFile(message.path);
                break;
            case 'login':
                const authManager = AuthManager.getInstance(this.context);
                await authManager.initiateAuth();
                break;
            case 'logout':
                const authMgr = AuthManager.getInstance(this.context);
                await authMgr.logout();
                break;
        }
    }

    async analyzeProject() {
        try {
            this.updateUI('loading', 'Starting project analysis...', '0%');
            
            const authManager = AuthManager.getInstance(this.context);
            const isAuthenticated = await authManager.isAuthenticated();
            
            if (!isAuthenticated) {
                this.updateUI('login-required', 'Authentication required');
                return;
            }

            // Use AnalysisService for the complete analysis
            const analysisService = AnalysisService.getInstance(this.context);
            // Pass the update callback to the service
            await analysisService.analyze();
            const result = { details: 'Analysis completed' }; // Placeholder

            if (result) {
                this.metricsService.recordAnalysis(100); // Default file count
                await this.context.globalState.update('projectAnalysisDetails', result.details);
                this.updateUI('complete', 'Analysis complete', '100%', result.details);
            }
        } catch (error: any) {
            console.error('[Hanzo] Analysis error:', error);
            this.updateUI('error', `Analysis failed: ${error.message}`);
        }
    }

    async exportSpecification() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const projectPath = workspaceFolders[0].uri.fsPath;
        const hanzoDir = path.join(projectPath, '.hanzo');
        
        try {
            const specPath = path.join(hanzoDir, 'specification.md');
            const specUri = vscode.Uri.file(specPath);
            
            await vscode.workspace.openTextDocument(specUri);
            await vscode.window.showTextDocument(specUri);
            vscode.window.showInformationMessage('Specification exported successfully');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to export specification: ${error.message}`);
        }
    }

    async openFile(filePath: string) {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
        }
    }

    private updateUI(status: string, message?: string, progress?: string, details?: string) {
        this.panel.webview.postMessage({
            command: 'updateStatus',
            status,
            message,
            progress,
            details
        });
    }

    async getOutputFileSpecifications(combinedSpecification: string) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }

        const projectPath = workspaceFolders[0].uri.fsPath;
        const specificationsPath = path.join(projectPath, '.hanzo', 'specifications.json');

        // Function to fetch specifications from API and save them
        const fetchAndSaveSpecifications = async () => {
            console.info('[Hanzo] Requesting output file specifications from API');
            this.updateUI('loading', 'Requesting output file specifications from API...', '91%');

            const response = await this.apiClient.makeAuthenticatedRequest('/projects/specification/refined-output-files', {
                specification: combinedSpecification
            });

            if (response.status >= 400) {
                throw new Error(`Failed to get output file specifications with status ${response.status}`);
            }

            const outputFiles = response.data.outputFiles || [];
            
            // Create .hanzo directory if it doesn't exist
            const hanzoDir = path.join(projectPath, '.hanzo');
            const hanzoUri = vscode.Uri.file(hanzoDir);
            await vscode.workspace.fs.createDirectory(hanzoUri);

            // Save specifications to file
            const specificationsUri = vscode.Uri.file(specificationsPath);
            const content = JSON.stringify(outputFiles, null, 2);
            await vscode.workspace.fs.writeFile(specificationsUri, Buffer.from(content, 'utf8'));
            
            console.info('[Hanzo] Saved output file specifications to .hanzo/specifications.json');
            
            return outputFiles;
        };

        // Try to read from disk first
        try {
            const specificationsUri = vscode.Uri.file(specificationsPath);
            const content = await vscode.workspace.fs.readFile(specificationsUri);
            const outputFiles = JSON.parse(content.toString());
            console.info('[Hanzo] Loaded output file specifications from .hanzo/specifications.json');
            return outputFiles;
        } catch (error) {
            // File doesn't exist or is invalid, fetch from API
            console.info('[Hanzo] No cached specifications found, fetching from API');
            return await fetchAndSaveSpecifications();
        }
    }
}