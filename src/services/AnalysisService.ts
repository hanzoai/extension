import * as vscode from 'vscode';
import { ProjectManager } from '../ProjectManager';
import { StatusBarService } from './StatusBarService';

export class AnalysisService {
    private context: vscode.ExtensionContext;
    private static instance: AnalysisService;
    private statusBar: StatusBarService;
    private projectManager?: ProjectManager;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.statusBar = StatusBarService.getInstance();
    }

    public static getInstance(context: vscode.ExtensionContext): AnalysisService {
        if (!AnalysisService.instance) {
            AnalysisService.instance = new AnalysisService(context);
        }
        return AnalysisService.instance;
    }

    private ensureProjectManager(): ProjectManager | undefined {
        return this.projectManager;
    }

    public setProjectManager(manager: ProjectManager): void {
        this.projectManager = manager;
    }

    public async analyze(details?: string): Promise<void> {
        try {
            const manager = this.ensureProjectManager();
            if (!manager) {
                throw new Error('Project manager not initialized');
            }
            // Call analyze method instead of handleProjectOperation
            await manager.analyzeProject();
        } catch (error) {
            console.error('[Hanzo] Analysis failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.statusBar.setError(errorMessage);
            vscode.window.showErrorMessage(`Analysis failed: ${errorMessage}`);
            throw error; // Re-throw for upstream handling if needed
        }
    }
}