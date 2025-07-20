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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReminderService = void 0;
const vscode = __importStar(require("vscode"));
const lodash_1 = require("lodash");
const ignore_1 = __importDefault(require("ignore"));
const ignored_patterns_1 = require("../constants/ignored-patterns");
const StatusBarService_1 = require("./StatusBarService");
const AnalysisService_1 = require("./AnalysisService");
const manager_1 = require("../auth/manager");
class ReminderService {
    context;
    static CHANGE_THRESHOLD = 200;
    static COOLDOWN_HOURS = 24; // Changed from COOLDOWN_MINUTES to COOLDOWN_HOURS
    static FORCE_SHOW_HOURS = 24; // how many hours to wait before showing the reminder again
    static CHECK_INTERVAL_HOURS = 24; // Changed from minutes to hours
    static INITIAL_REMINDER_MINUTES = 5; // Changed from 15 to 5 minutes for faster testing
    lastNotificationTime = 0;
    lastCommitSha = '';
    disposables = [];
    gitAPI;
    ignoreFilter;
    checkInterval; // Using definite assignment assertion
    initialReminderTimeout; // For the 15-minute initial reminder
    statusBar;
    analysisService;
    authManager;
    constructor(context) {
        this.context = context;
        this.ignoreFilter = (0, ignore_1.default)().add(ignored_patterns_1.DEFAULT_IGNORED_PATTERNS);
        this.statusBar = StatusBarService_1.StatusBarService.getInstance();
        this.analysisService = AnalysisService_1.AnalysisService.getInstance(context);
        this.authManager = manager_1.AuthManager.getInstance(context);
        this.initialize();
        // Start daily check
        this.startPeriodicChecks();
        // Check if this is a first-time installation
        this.checkFirstTimeInstallation();
    }
    async checkFirstTimeInstallation() {
        // Get installation timestamp, or set it if this is the first run
        const installationTime = this.context.globalState.get('installationTime', 0);
        if (installationTime === 0) {
            // This is the first time the extension has been activated
            const currentTime = Date.now();
            await this.context.globalState.update('installationTime', currentTime);
            console.info('[Hanzo] First installation detected, setting installation time:', new Date(currentTime).toISOString());
            // Show immediate welcome notification for new installs
            await this.showWelcomeNotification();
            // Also schedule the initial reminder for 5 minutes after installation
            this.scheduleInitialReminder();
        }
        else {
            console.info('[Hanzo] Extension previously installed on:', new Date(installationTime).toISOString());
            // Check if welcome notification has been shown
            const hasShownWelcome = this.context.globalState.get('hasShownWelcome', false);
            if (!hasShownWelcome) {
                // Show welcome notification for users who haven't seen it yet
                await this.showWelcomeNotification();
            }
        }
    }
    async showWelcomeNotification() {
        // Only show welcome notification to non-authenticated users
        const isAuthenticated = await this.authManager.isAuthenticated();
        if (isAuthenticated) {
            console.info('[Hanzo] User is already authenticated, skipping welcome notification');
            return;
        }
        console.info('[Hanzo] Showing welcome notification for new installation');
        // Set status bar to new user notice state for persistent visual cue
        this.statusBar.setNewUserNotice();
        const choice = await vscode.window.showInformationMessage('Welcome to Hanzo! Get started by connecting to improve AI accuracy with your codebase.', 'Set Up Now');
        if (choice === 'Set Up Now') {
            // Open the project manager which will prompt for authentication
            vscode.commands.executeCommand('hanzo.openManager');
        }
        // Mark that we've shown the welcome notification
        await this.context.globalState.update('hasShownWelcome', true);
    }
    scheduleInitialReminder() {
        console.info('[Hanzo] Scheduling initial reminder for 5 minutes after installation');
        // Clear any existing timeout
        if (this.initialReminderTimeout) {
            clearTimeout(this.initialReminderTimeout);
        }
        // Set timeout for 5 minutes
        this.initialReminderTimeout = setTimeout(async () => {
            console.info('[Hanzo] Showing initial reminder 5 minutes after installation');
            await this.checkAndShowNonLoggedInReminder(true);
        }, ReminderService.INITIAL_REMINDER_MINUTES * 60 * 1000);
        // Add to disposables for cleanup
        this.disposables.push(new vscode.Disposable(() => {
            if (this.initialReminderTimeout) {
                clearTimeout(this.initialReminderTimeout);
            }
        }));
    }
    startPeriodicChecks() {
        // Check every CHECK_INTERVAL_HOURS
        this.checkInterval = setInterval(async () => {
            // First check authentication status
            const isAuthenticated = await this.authManager.isAuthenticated();
            if (isAuthenticated) {
                // For logged-in users, show the regular analytics reminder
                await this.checkTimeBasedReminder();
            }
            else {
                // For non-logged-in users, show the non-logged-in reminder
                await this.checkAndShowNonLoggedInReminder();
            }
        }, ReminderService.CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
        // Add to disposables for cleanup
        this.disposables.push(new vscode.Disposable(() => {
            clearInterval(this.checkInterval);
        }));
    }
    async checkTimeBasedReminder() {
        const hoursSinceLastNotification = (Date.now() - this.lastNotificationTime) / (1000 * 60 * 60);
        console.info('[Hanzo] Checking time-based reminder:', {
            hoursSinceLastNotification: hoursSinceLastNotification.toFixed(2),
            threshold: ReminderService.FORCE_SHOW_HOURS
        });
        if (hoursSinceLastNotification >= ReminderService.FORCE_SHOW_HOURS) {
            console.info('[Hanzo] Showing time-based reminder');
            await this.showReminder(true);
        }
    }
    async checkAndShowNonLoggedInReminder(forceShow = false) {
        const isAuthenticated = await this.authManager.isAuthenticated();
        // Only show for non-logged-in users
        if (isAuthenticated) {
            console.info('[Hanzo] User is authenticated, skipping non-logged-in reminder');
            return;
        }
        const hoursSinceLastNotification = (Date.now() - this.lastNotificationTime) / (1000 * 60 * 60);
        console.info('[Hanzo] Checking non-logged-in reminder criteria:', {
            forceShow,
            hoursSinceLastNotification: hoursSinceLastNotification.toFixed(2),
            cooldownHours: ReminderService.COOLDOWN_HOURS
        });
        // Only show if force is true or cooldown period has passed
        if (!forceShow && hoursSinceLastNotification < ReminderService.COOLDOWN_HOURS) {
            console.info('[Hanzo] Skipping non-logged-in reminder due to cooldown period');
            return;
        }
        await this.showNonLoggedInReminder();
    }
    shouldTrackFile(filePath) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return false;
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const relativePath = vscode.workspace.asRelativePath(filePath);
        return !this.ignoreFilter.ignores(relativePath);
    }
    async initialize() {
        try {
            console.info('[Hanzo] Initializing ReminderService...');
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                await gitExtension.activate();
                this.gitAPI = gitExtension.exports.getAPI(1);
            }
            if (this.gitAPI?.repositories?.length > 0) {
                console.info('[Hanzo] Git repository found, initializing Git tracking');
                this.initGitTracking();
            }
            // Restore state
            this.lastNotificationTime = this.context.globalState.get('lastNotificationTime', 0);
            this.lastCommitSha = this.context.globalState.get('lastCommitSha', '');
            console.info('[Hanzo] ReminderService initialized:', {
                lastNotificationTime: new Date(this.lastNotificationTime).toISOString(),
                lastCommitSha: this.lastCommitSha,
                usingGit: Boolean(this.gitAPI?.repositories?.length)
            });
            // Check authentication status first
            const isAuthenticated = await this.authManager.isAuthenticated();
            if (isAuthenticated) {
                // For logged-in users, check the regular reminder
                await this.checkTimeBasedReminder();
            }
            else {
                // For non-logged-in users, check if we should show the non-logged-in reminder
                // (but not immediately on startup, let the 15-minute timer handle that for new installs)
                const installationTime = this.context.globalState.get('installationTime', 0);
                if (installationTime !== 0 && installationTime !== Date.now()) {
                    await this.checkAndShowNonLoggedInReminder();
                }
            }
        }
        catch (error) {
            console.error('[Hanzo] Failed to initialize ReminderService:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }
    initGitTracking() {
        const repo = this.gitAPI.repositories[0];
        // Track repository changes - specifically commits
        repo.state.onDidChange((0, lodash_1.debounce)(async () => {
            const currentCommit = repo.state.HEAD?.commit;
            // Only trigger on new commits, not working directory changes
            if (currentCommit && currentCommit !== this.lastCommitSha) {
                console.info('[Hanzo] New commit detected:', {
                    previousCommit: this.lastCommitSha,
                    currentCommit: currentCommit
                });
                // Update the last commit SHA
                this.lastCommitSha = currentCommit;
                await this.context.globalState.update('lastCommitSha', currentCommit);
                try {
                    // Get the diff to check if changes are significant enough
                    const previousCommit = this.lastCommitSha || 'HEAD~1';
                    const diff = await repo.diffBetween(previousCommit, currentCommit);
                    // Calculate total line changes
                    const totalChanges = diff.reduce((sum, change) => {
                        const shouldTrack = this.shouldTrackFile(change.uri?.fsPath);
                        const lineChanges = change.additions + change.deletions;
                        console.info('[Hanzo] Commit change detected:', {
                            file: change.uri?.fsPath,
                            tracked: shouldTrack,
                            additions: change.additions,
                            deletions: change.deletions,
                            totalChanges: lineChanges
                        });
                        return shouldTrack ? sum + lineChanges : sum;
                    }, 0);
                    console.info('[Hanzo] Total line changes in commit:', {
                        totalChanges,
                        threshold: ReminderService.CHANGE_THRESHOLD
                    });
                    // Check if user is authenticated first
                    const isAuthenticated = await this.authManager.isAuthenticated();
                    if (isAuthenticated) {
                        // Only show regular reminder for authenticated users if changes are significant
                        if (totalChanges >= ReminderService.CHANGE_THRESHOLD) {
                            console.info('[Hanzo] Significant changes detected in commit, showing reminder');
                            await this.showReminder(true);
                        }
                        else {
                            console.info('[Hanzo] Changes below threshold, skipping reminder');
                        }
                    }
                    else {
                        // For non-authenticated users, show the non-logged-in reminder regardless of changes
                        // but respect the cooldown period
                        await this.checkAndShowNonLoggedInReminder();
                    }
                }
                catch (error) {
                    console.error('[Hanzo] Error analyzing commit changes:', error);
                    // If we can't analyze the diff, don't show a reminder
                }
            }
        }, 1000));
    }
    async showReminder(forceShow = false) {
        const hoursSinceLastNotification = (Date.now() - this.lastNotificationTime) / (1000 * 60 * 60);
        console.info('[Hanzo] Checking reminder criteria:', {
            forceShow,
            hoursSinceLastNotification: hoursSinceLastNotification.toFixed(2),
            cooldownHours: ReminderService.COOLDOWN_HOURS
        });
        // Only show if force is true or cooldown period has passed
        if (!forceShow && hoursSinceLastNotification < ReminderService.COOLDOWN_HOURS) {
            console.info('[Hanzo] Skipping reminder due to cooldown period');
            return;
        }
        const choice = await vscode.window.showInformationMessage(`Would you like to analyze your project to boost AI quality?`, 'Analyze Now', 'Remind Me Later');
        if (choice === 'Analyze Now') {
            await this.analyzeProject();
        }
        // Always update the last notification time
        this.lastNotificationTime = Date.now();
        await this.context.globalState.update('lastNotificationTime', this.lastNotificationTime);
        console.info('[Hanzo] Updated last notification time:', new Date(this.lastNotificationTime).toISOString());
    }
    async showNonLoggedInReminder() {
        // This popup specifically for non-logged-in users
        const choice = await vscode.window.showWarningMessage(`Your AI assistant could work better with your project. Set up Hanzo to reduce hallucinations.`, 'Set Up Hanzo');
        if (choice === 'Set Up Hanzo') {
            // Open the project manager which will prompt for authentication
            vscode.commands.executeCommand('hanzo.openManager');
        }
        // Always update the last notification time
        this.lastNotificationTime = Date.now();
        await this.context.globalState.update('lastNotificationTime', this.lastNotificationTime);
        console.info('[Hanzo] Updated last notification time for non-logged-in reminder:', new Date(this.lastNotificationTime).toISOString());
    }
    async analyzeProject() {
        try {
            console.info('[Hanzo] Starting analysis...');
            await this.analysisService.analyze();
            // Update state after successful analysis
            if (this.gitAPI?.repositories?.length > 0) {
                const repo = this.gitAPI.repositories[0];
                const commit = repo.state.HEAD?.commit;
                console.info('[Hanzo] Updating last analyzed commit:', commit);
                await this.context.globalState.update('lastAnalyzedCommit', commit);
            }
        }
        catch (error) {
            console.error('[Hanzo] Analysis failed:', error);
            vscode.window.showErrorMessage(`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async triggerManually() {
        console.info('[Hanzo] Manually triggering reminder...');
        // Check if the user is authenticated
        const isAuthenticated = await this.authManager.isAuthenticated();
        if (isAuthenticated) {
            await this.showReminder(true);
        }
        else {
            await this.showNonLoggedInReminder();
        }
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
exports.ReminderService = ReminderService;
//# sourceMappingURL=ReminderService.js.map