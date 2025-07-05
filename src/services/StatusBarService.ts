import * as vscode from 'vscode';
import { getUIText } from '../utils/textContent';

// Forward declaration of the service we'll reference
interface MetricsService {
    hasBeenUsed(): boolean;
}

export class StatusBarService implements vscode.Disposable {
    private static instance: StatusBarService;
    private statusBarItem: vscode.StatusBarItem;
    private metricsService?: MetricsService;

    private constructor() {
        console.log('[Hanzo StatusBar] Creating new status bar item');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.command = 'hanzo.openManager';
        this.setIdle();
        this.statusBarItem.show();
    }

    public static getInstance(): StatusBarService {
        if (!StatusBarService.instance) {
            console.log('[Hanzo StatusBar] Creating new StatusBarService instance');
            StatusBarService.instance = new StatusBarService();
        }
        return StatusBarService.instance;
    }

    public setMetricsService(metricsService: MetricsService): void {
        console.log('[Hanzo StatusBar] Setting metrics service');
        this.metricsService = metricsService;
        this.updateStatusBar();
    }

    public updateStatusBar(): void {
        console.log('[Hanzo StatusBar] Updating status bar');
        if (this.metricsService && this.metricsService.hasBeenUsed()) {
            console.log('[Hanzo StatusBar] Metrics service has been used, setting boost active');
            this.setBoostActive();
        } else {
            console.log('[Hanzo StatusBar] Metrics service has not been used or is undefined, setting idle');
            this.setIdle();
        }
    }

    public setAnalyzing(message: string = 'Analyzing project...'): void {
        const uiText = getUIText();
        console.log(`[Hanzo StatusBar] Setting analyzing state: ${message}`);
        this.statusBarItem.text = message === 'Analyzing project...' ? uiText.statusBar.analyzing : `$(sync~spin) ${message}`;
        this.statusBarItem.tooltip = uiText.tooltips.analyzing;
        this.statusBarItem.command = undefined;
    }

    public setIdle(): void {
        const uiText = getUIText();
        console.log('[Hanzo StatusBar] Setting idle state');
        this.statusBarItem.text = uiText.statusBar.idle;
        this.statusBarItem.tooltip = uiText.tooltips.idle;
        this.statusBarItem.command = 'hanzo.openManager';
        // Reset any custom colors
        this.statusBarItem.color = undefined;
    }

    public setNewUserNotice(): void {
        const uiText = getUIText();
        console.log('[Hanzo StatusBar] Setting login state for new user');
        this.statusBarItem.text = uiText.statusBar.login;
        this.statusBarItem.tooltip = uiText.tooltips.login;
        this.statusBarItem.command = 'hanzo.openManager';
        this.statusBarItem.color = new vscode.ThemeColor('notificationsInfoIcon.foreground');
    }

    public setBoostActive(): void {
        const uiText = getUIText();
        console.log('[Hanzo StatusBar] Setting boost active state');
        this.statusBarItem.text = uiText.statusBar.boostActive;
        this.statusBarItem.color = new vscode.ThemeColor('debugIcon.startForeground');
        this.statusBarItem.tooltip = uiText.tooltips.boostActive;
        this.statusBarItem.command = 'hanzo.openManager';
    }

    public setError(message: string = 'Analysis failed'): void {
        const uiText = getUIText();
        console.log(`[Hanzo StatusBar] Setting error state: ${message}`);
        this.statusBarItem.text = message === 'Analysis failed' ? uiText.statusBar.error : `$(error) ${message}`;
        this.statusBarItem.tooltip = uiText.tooltips.error;
        this.statusBarItem.command = 'hanzo.reanalyzeProject';
    }

    public setSuccess(message: string = 'Analysis complete'): void {
        const uiText = getUIText();
        console.log(`[Hanzo StatusBar] Setting success state: ${message}`);
        this.statusBarItem.text = message === 'Analysis complete' ? uiText.statusBar.success : `$(check) ${message}`;
        this.statusBarItem.tooltip = uiText.tooltips.success;
        this.statusBarItem.command = 'hanzo.reanalyzeProject';
        
        // Reset to boost active or idle after 3 seconds
        console.log('[Hanzo StatusBar] Scheduling status bar update in 3 seconds');
        setTimeout(() => this.updateStatusBar(), 3000);
    }

    public dispose(): void {
        console.log('[Hanzo StatusBar] Disposing status bar item');
        this.statusBarItem.dispose();
    }
}