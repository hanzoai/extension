"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBarService = void 0;
const vscode = __importStar(require("vscode"));
const textContent_1 = require("../utils/textContent");
class StatusBarService {
    constructor() {
        console.log('[Hanzo StatusBar] Creating new status bar item');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.statusBarItem.command = 'hanzo.openManager';
        this.setIdle();
        this.statusBarItem.show();
    }
    static getInstance() {
        if (!StatusBarService.instance) {
            console.log('[Hanzo StatusBar] Creating new StatusBarService instance');
            StatusBarService.instance = new StatusBarService();
        }
        return StatusBarService.instance;
    }
    setMetricsService(metricsService) {
        console.log('[Hanzo StatusBar] Setting metrics service');
        this.metricsService = metricsService;
        this.updateStatusBar();
    }
    updateStatusBar() {
        console.log('[Hanzo StatusBar] Updating status bar');
        if (this.metricsService && this.metricsService.hasBeenUsed()) {
            console.log('[Hanzo StatusBar] Metrics service has been used, setting boost active');
            this.setBoostActive();
        }
        else {
            console.log('[Hanzo StatusBar] Metrics service has not been used or is undefined, setting idle');
            this.setIdle();
        }
    }
    setAnalyzing(message = 'Analyzing project...') {
        const uiText = (0, textContent_1.getUIText)();
        console.log(`[Hanzo StatusBar] Setting analyzing state: ${message}`);
        this.statusBarItem.text = message === 'Analyzing project...' ? uiText.statusBar.analyzing : `$(sync~spin) ${message}`;
        this.statusBarItem.tooltip = uiText.tooltips.analyzing;
        this.statusBarItem.command = undefined;
    }
    setIdle() {
        const uiText = (0, textContent_1.getUIText)();
        console.log('[Hanzo StatusBar] Setting idle state');
        this.statusBarItem.text = uiText.statusBar.idle;
        this.statusBarItem.tooltip = uiText.tooltips.idle;
        this.statusBarItem.command = 'hanzo.openManager';
        // Reset any custom colors
        this.statusBarItem.color = undefined;
    }
    setNewUserNotice() {
        const uiText = (0, textContent_1.getUIText)();
        console.log('[Hanzo StatusBar] Setting login state for new user');
        this.statusBarItem.text = uiText.statusBar.login;
        this.statusBarItem.tooltip = uiText.tooltips.login;
        this.statusBarItem.command = 'hanzo.openManager';
        this.statusBarItem.color = new vscode.ThemeColor('notificationsInfoIcon.foreground');
    }
    setBoostActive() {
        const uiText = (0, textContent_1.getUIText)();
        console.log('[Hanzo StatusBar] Setting boost active state');
        this.statusBarItem.text = uiText.statusBar.boostActive;
        this.statusBarItem.color = new vscode.ThemeColor('debugIcon.startForeground');
        this.statusBarItem.tooltip = uiText.tooltips.boostActive;
        this.statusBarItem.command = 'hanzo.openManager';
    }
    setError(message = 'Analysis failed') {
        const uiText = (0, textContent_1.getUIText)();
        console.log(`[Hanzo StatusBar] Setting error state: ${message}`);
        this.statusBarItem.text = message === 'Analysis failed' ? uiText.statusBar.error : `$(error) ${message}`;
        this.statusBarItem.tooltip = uiText.tooltips.error;
        this.statusBarItem.command = 'hanzo.reanalyzeProject';
    }
    setSuccess(message = 'Analysis complete') {
        const uiText = (0, textContent_1.getUIText)();
        console.log(`[Hanzo StatusBar] Setting success state: ${message}`);
        this.statusBarItem.text = message === 'Analysis complete' ? uiText.statusBar.success : `$(check) ${message}`;
        this.statusBarItem.tooltip = uiText.tooltips.success;
        this.statusBarItem.command = 'hanzo.reanalyzeProject';
        // Reset to boost active or idle after 3 seconds
        console.log('[Hanzo StatusBar] Scheduling status bar update in 3 seconds');
        setTimeout(() => this.updateStatusBar(), 3000);
    }
    dispose() {
        console.log('[Hanzo StatusBar] Disposing status bar item');
        this.statusBarItem.dispose();
    }
}
exports.StatusBarService = StatusBarService;
//# sourceMappingURL=StatusBarService.js.map