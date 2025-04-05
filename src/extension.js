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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectManager = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const zlib = __importStar(require("zlib"));
const util_1 = require("util");
const config_1 = require("./config");
const webview_1 = require("./styles/webview");
const FileCollectionService_1 = require("./services/FileCollectionService");
const manager_1 = require("./auth/manager");
const client_1 = require("./api/client");
const ReminderService_1 = require("./services/ReminderService");
const StatusBarService_1 = require("./services/StatusBarService");
const AnalysisService_1 = require("./services/AnalysisService");
const HanzoMetricsService_1 = require("./services/HanzoMetricsService");
const textContent_1 = require("./utils/textContent");
// Project management utilities
class ProjectManager {
    panel;
    context;
    config = (0, config_1.getConfig)();
    gzip = (0, util_1.promisify)(zlib.gzip);
    apiClient;
    statusBar;
    metricsService;
    constructor(panel, context) {
        this.panel = panel;
        this.context = context;
        this.apiClient = new client_1.ApiClient(context);
        this.statusBar = StatusBarService_1.StatusBarService.getInstance();
        this.metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
        // Initialize webview with cached details if panel exists
        if (panel) {
            const cachedDetails = this.context.globalState.get('projectAnalysisDetails', '');
            panel.webview.postMessage({
                command: 'loadProjectDetails',
                details: cachedDetails
            });
        }
    }
    /**
     * Gets output file specifications from .hanzo/specifications.json or from the API
     * @param combinedSpecification The combined specification to send to the API if needed
     * @returns Array of output file specifications
     */
    async getOutputFileSpecifications(combinedSpecification) {
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
            // Log the raw response for debugging
            console.info(`[Hanzo] API Response Status: ${response.status}`);
            console.info(`[Hanzo] Raw API response body: ${JSON.stringify(response.data)}`);
            // Ensure the response data is properly processed
            let specifications = response.data;
            // Check if the response has the expected structure
            if (specifications && specifications.success && specifications.data && Array.isArray(specifications.data.outputFiles)) {
                // Extract the outputFiles array from the nested structure
                specifications = specifications.data.outputFiles;
                console.info(`[Hanzo] Extracted ${specifications.length} output files from response`);
            }
            else {
                // Try to handle different response formats
                if (Array.isArray(specifications)) {
                    console.info(`[Hanzo] Response is already an array with ${specifications.length} items`);
                }
                else if (specifications && typeof specifications === 'object') {
                    console.error('[Hanzo] API response is not in the expected format:', JSON.stringify(specifications));
                    // Try to extract any array we can find in the response
                    const possibleArrays = Object.values(specifications).filter(val => Array.isArray(val));
                    if (possibleArrays.length > 0) {
                        // Use the first array we find
                        specifications = possibleArrays[0];
                        console.info(`[Hanzo] Found an array in the response with ${specifications.length} items`);
                    }
                    else {
                        // Check if there's a nested data object
                        if (specifications.data && typeof specifications.data === 'object') {
                            const nestedArrays = Object.values(specifications.data).filter(val => Array.isArray(val));
                            if (nestedArrays.length > 0) {
                                // Use the first array we find in the data object
                                specifications = nestedArrays[0];
                                console.info(`[Hanzo] Found an array in the data object with ${specifications.length} items`);
                            }
                            else {
                                console.error('[Hanzo] Could not find any arrays in the response');
                                specifications = [];
                            }
                        }
                        else {
                            console.error('[Hanzo] No data object found in the response');
                            specifications = [];
                        }
                    }
                }
                else {
                    console.error('[Hanzo] API response is not an object or array:', specifications);
                    specifications = [];
                }
            }
            // Validate that we received valid specifications
            if (specifications.length === 0) {
                console.error('[Hanzo] API returned empty specifications array');
                this.showNotification('error', 'API returned empty specifications. Please try again.');
                throw new Error('API returned empty specifications array');
            }
            // Validate that each specification has the required properties
            const validSpecifications = specifications.filter((spec) => typeof spec === 'object' &&
                spec !== null &&
                typeof spec.fileName === 'string' &&
                typeof spec.description === 'string');
            if (validSpecifications.length === 0) {
                console.error('[Hanzo] No valid specifications found in API response');
                this.showNotification('error', 'No valid specifications found in API response. Please try again.');
                throw new Error('No valid specifications found in API response');
            }
            if (validSpecifications.length < specifications.length) {
                console.warn(`[Hanzo] Filtered out ${specifications.length - validSpecifications.length} invalid specifications`);
                specifications = validSpecifications;
            }
            // Create .hanzo directory if it doesn't exist
            const hanzoDir = path.join(projectPath, '.hanzo');
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(hanzoDir));
            }
            catch (e) {
                // Directory might already exist
            }
            // Save specifications to file
            await vscode.workspace.fs.writeFile(vscode.Uri.file(specificationsPath), Buffer.from(JSON.stringify(specifications, null, 2)));
            console.info(`[Hanzo] Saved ${specifications.length} output file specifications to ${specificationsPath}`);
            return specifications;
        };
        try {
            // Check if specifications.json exists
            const fileUri = vscode.Uri.file(specificationsPath);
            await vscode.workspace.fs.stat(fileUri);
            // File exists, read and parse it
            console.info('[Hanzo] Found existing specifications.json file, using cached specifications');
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            const fileContent = Buffer.from(fileData).toString('utf8');
            // Check if the file is empty or just whitespace
            if (!fileContent.trim()) {
                console.warn('[Hanzo] Specifications file is empty, fetching from API');
                this.showNotification('info', 'Specifications file is empty, regenerating from API...');
                // Delete the empty file
                await vscode.workspace.fs.delete(fileUri);
                // Fetch and save new specifications
                return await fetchAndSaveSpecifications();
            }
            // Log the file content for debugging
            console.info(`[Hanzo] Specifications file content: ${fileContent}`);
            try {
                const specifications = JSON.parse(fileContent);
                // Validate that specifications is an array
                if (!Array.isArray(specifications)) {
                    console.error('[Hanzo] Cached specifications is not an array, fetching from API instead');
                    this.showNotification('info', 'Invalid specifications format, regenerating from API...');
                    // Delete the invalid file
                    await vscode.workspace.fs.delete(fileUri);
                    // Fetch and save new specifications
                    return await fetchAndSaveSpecifications();
                }
                // Validate that each item has the required properties
                const isValid = specifications.every(spec => typeof spec === 'object' &&
                    spec !== null &&
                    typeof spec.fileName === 'string' &&
                    typeof spec.description === 'string');
                if (!isValid) {
                    console.error('[Hanzo] Cached specifications has invalid format, fetching from API instead');
                    this.showNotification('info', 'Invalid specifications format, regenerating from API...');
                    // Delete the invalid file
                    await vscode.workspace.fs.delete(fileUri);
                    // Fetch and save new specifications
                    return await fetchAndSaveSpecifications();
                }
                // Check if the array is empty
                if (specifications.length === 0) {
                    console.warn('[Hanzo] Cached specifications array is empty, fetching from API instead');
                    this.showNotification('info', 'Empty specifications, regenerating from API...');
                    // Delete the empty array file
                    await vscode.workspace.fs.delete(fileUri);
                    // Fetch and save new specifications
                    return await fetchAndSaveSpecifications();
                }
                console.info(`[Hanzo] Successfully parsed ${specifications.length} specifications from cache`);
                return specifications;
            }
            catch (parseError) {
                console.error('[Hanzo] Failed to parse specifications.json:', parseError);
                this.showNotification('info', 'Failed to parse specifications, regenerating from API...');
                // If parsing fails, delete the invalid file and fetch from API
                await vscode.workspace.fs.delete(fileUri);
                // Fetch and save new specifications
                return await fetchAndSaveSpecifications();
            }
        }
        catch (error) {
            // File doesn't exist, can't be read, or has invalid format - fetch from API
            console.info('[Hanzo] No valid specifications.json file found, fetching from API');
            // Try to delete the file if it exists but is invalid
            try {
                const fileUri = vscode.Uri.file(specificationsPath);
                await vscode.workspace.fs.stat(fileUri);
                // If we get here, the file exists, so delete it
                console.info('[Hanzo] Deleting invalid specifications.json file');
                await vscode.workspace.fs.delete(fileUri);
            }
            catch (e) {
                // File doesn't exist or can't be deleted, ignore
            }
            // Fetch and save new specifications
            return await fetchAndSaveSpecifications();
        }
    }
    getIdeConfig() {
        const ide = vscode.workspace.getConfiguration('hanzo').get('ide', 'cursor');
        const formatContent = (specification, existingContent) => {
            if (!existingContent?.includes('START SPECIFICATION:')) {
                return `${existingContent || ''}\nSTART SPECIFICATION:\n${specification}\nEND SPECIFICATION`;
            }
            const specRegex = new RegExp('START SPECIFICATION:[\\s\\S]*?END SPECIFICATION', 's');
            return existingContent.replace(specRegex, `START SPECIFICATION:\n${specification}\nEND SPECIFICATION`);
        };
        const configs = {
            cursor: {
                filePath: '.cursorrules',
                formatContent,
                rulesDir: '.cursor/rules'
            },
            copilot: {
                filePath: '.github/copilot-instructions.md',
                formatContent,
                rulesDir: '.hanzo/rules'
            },
            codium: {
                filePath: '.windsurfrules',
                formatContent,
                rulesDir: '.hanzo/rules'
            }
        };
        return configs[ide] || configs.cursor;
    }
    async updateMultiSpecificationFiles(specifications, message) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        const projectPath = workspaceFolders[0].uri.fsPath;
        const ideConfig = this.getIdeConfig();
        // Find the main overview file
        let mainOverviewFile = specifications.find(spec => spec.name.toLowerCase().includes('overview') ||
            spec.name.toLowerCase().includes('main'));
        // If no main overview file is found, use the first file
        if (!mainOverviewFile && specifications.length > 0) {
            console.warn('[Hanzo] No main overview file found, using the first specification file');
            mainOverviewFile = specifications[0];
        }
        if (!mainOverviewFile) {
            throw new Error('No specification files found');
        }
        console.info(`[Hanzo] Using "${mainOverviewFile.name}" as the main overview file`);
        // Write main overview file to IDE-specific location
        const rulesPath = path.join(projectPath, ideConfig.filePath);
        // Create directory if needed (for nested paths like .github/)
        const rulesDir = path.dirname(rulesPath);
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(rulesDir));
        }
        catch (e) {
            // Directory might already exist
        }
        // Read existing content if any
        let existingContent = '';
        try {
            const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(rulesPath));
            existingContent = Buffer.from(fileData).toString('utf8');
        }
        catch (e) {
            // File doesn't exist yet
        }
        // Format and write the main overview content
        const newContent = ideConfig.formatContent(mainOverviewFile.content, existingContent);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(rulesPath), Buffer.from(newContent));
        console.info(`[Hanzo] Wrote main overview file to ${rulesPath}`);
        // Create rules directory for additional specification files
        const specificRulesDir = path.join(projectPath, ideConfig.rulesDir);
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(specificRulesDir));
            console.info(`[Hanzo] Created rules directory at ${specificRulesDir}`);
        }
        catch (e) {
            // Directory might already exist
            console.info(`[Hanzo] Rules directory already exists at ${specificRulesDir}`);
        }
        // Write additional specification files
        for (const spec of specifications) {
            // Skip the main overview file as it's already written
            if (spec === mainOverviewFile) {
                continue;
            }
            const fileName = `${spec.name}.mdc`;
            const filePath = path.join(specificRulesDir, fileName);
            await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(spec.content));
            console.info(`[Hanzo] Wrote specification file "${spec.name}" to ${filePath}`);
        }
        if (message) {
            await this.context.globalState.update('projectDetails', message);
        }
    }
    async updateProjectFiles(specification, message) {
        try {
            this.updateUI('loading', 'Generating project files...');
            // Get workspace folder
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder found');
            }
            const projectPath = workspaceFolders[0].uri.fsPath;
            // Collect files for analysis to track metrics
            console.log('[Hanzo Metrics] Collecting files for metrics tracking');
            const fileCollectionService = new FileCollectionService_1.FileCollectionService(workspaceFolders[0].uri.fsPath);
            const fileNodes = await fileCollectionService.collectFiles();
            console.log(`[Hanzo Metrics] Collected ${fileNodes.length} file nodes`);
            // Get IDE-specific configuration
            const ideConfig = this.getIdeConfig();
            const rulesPath = path.join(projectPath, ideConfig.filePath);
            // Create directory if needed (for nested paths like .github/)
            const rulesDir = path.dirname(rulesPath);
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(rulesDir));
            }
            catch (e) {
                // Directory might already exist
            }
            // Read existing content if any
            let existingContent = '';
            try {
                const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(rulesPath));
                existingContent = Buffer.from(fileData).toString('utf8');
            }
            catch (e) {
                // File doesn't exist yet
            }
            // Format and write the content
            const newContent = ideConfig.formatContent(specification, existingContent);
            await vscode.workspace.fs.writeFile(vscode.Uri.file(rulesPath), Buffer.from(newContent));
            if (message) {
                await this.context.globalState.update('projectDetails', message);
            }
            // After successful update, record metrics
            if (fileNodes && fileNodes.length > 0) {
                console.log('[Hanzo Metrics] Processing file nodes for metrics');
                const flattenedNodes = this.flattenFileNodes(fileNodes);
                const fileCount = flattenedNodes.filter(node => node.type === 'file').length;
                console.log(`[Hanzo Metrics] Recording analysis of ${fileCount} files`);
                // Ensure we have at least one file to record
                if (fileCount > 0) {
                    this.metricsService.recordAnalysis(fileCount);
                    // Get updated metrics for logging
                    const updatedMetrics = this.metricsService.getMetricsForDisplay();
                    console.log('[Hanzo Metrics] After recording analysis, metrics are now:', JSON.stringify(updatedMetrics));
                }
                else {
                    console.log('[Hanzo Metrics] No files to record for analysis (fileCount is 0)');
                }
            }
            else {
                console.log('[Hanzo Metrics] No file nodes to record metrics for');
            }
            this.updateUI('success', 'Project files updated');
        }
        catch (error) {
            console.error('[Hanzo] Error updating project files:', error);
            this.updateUI('error', error instanceof Error ? error.message : 'Unknown error');
            throw error;
        }
    }
    // Helper method to flatten file nodes
    flattenFileNodes(nodes) {
        const result = [];
        const flatten = (nodeList) => {
            for (const node of nodeList) {
                result.push(node);
                if (node.children && node.children.length > 0) {
                    flatten(node.children);
                }
            }
        };
        flatten(nodes);
        return result;
    }
    updateUI(status, message, progress) {
        if (this.panel) {
            try {
                this.panel.webview.postMessage({
                    command: 'updateProjectStatus',
                    status,
                    message: message || (status === 'loading' ? 'Processing...' :
                        status === 'success' ? 'Operation completed successfully' :
                            'Operation failed'),
                    progress
                });
            }
            catch (error) {
                // Webview is likely disposed, silently ignore
                console.debug('[Hanzo] Skipping UI update - webview may be disposed');
            }
        }
        // Update metrics in UI
        if (this.panel && status === 'success') {
            console.log('[Hanzo UI] Updating metrics in UI after successful operation');
            // Get the current raw metrics for debugging
            const rawMetrics = this.metricsService.getMetricsForDisplay();
            console.log('[Hanzo UI] Current raw metrics:', JSON.stringify(rawMetrics));
            // Get calculated metrics for display
            const calculatedMetrics = this.metricsService.getCalculatedMetrics();
            console.log('[Hanzo UI] Sending calculated metrics to webview:', JSON.stringify(calculatedMetrics));
            // Send metrics to webview with increased delay to ensure UI is ready
            // Also explicitly request the container to be shown
            setTimeout(() => {
                if (this.panel) {
                    console.log('[Hanzo UI] Sending delayed metrics update to webview');
                    this.panel.webview.postMessage({
                        command: 'updateMetrics',
                        metrics: calculatedMetrics,
                        forceShow: calculatedMetrics.filesAnalyzed > 0 // Add explicit flag to force showing metrics
                    });
                    // Send a second update after a slightly longer delay to ensure it's processed
                    setTimeout(() => {
                        if (this.panel) {
                            console.log('[Hanzo UI] Sending follow-up metrics update to ensure visibility');
                            this.panel.webview.postMessage({
                                command: 'updateMetrics',
                                metrics: calculatedMetrics,
                                forceShow: calculatedMetrics.filesAnalyzed > 0
                            });
                        }
                    }, 1000);
                }
            }, 800); // Increased from 500ms to 800ms
            // Show a notification with metrics
            if (calculatedMetrics.filesAnalyzed > 0) {
                console.log('[Hanzo UI] Showing metrics notification');
                const notificationMessage = `Hanzo has analyzed ${calculatedMetrics.filesAnalyzed} files across ${calculatedMetrics.totalAnalyses} analyses, improving AI context by ${calculatedMetrics.aiContextScore}%.`;
                const viewDetailsButton = 'View Details';
                vscode.window.showInformationMessage(notificationMessage, viewDetailsButton)
                    .then(selection => {
                    if (selection === viewDetailsButton) {
                        console.log('[Hanzo UI] User clicked View Details button');
                        vscode.commands.executeCommand('hanzo.openManager');
                    }
                });
            }
            else {
                console.log('[Hanzo UI] No files analyzed yet, skipping metrics notification');
            }
        }
        // Update status bar
        console.log(`[Hanzo UI] Updating status bar with status: ${status}`);
        switch (status) {
            case 'loading':
                this.statusBar.setAnalyzing(message);
                break;
            case 'success':
                this.statusBar.setSuccess(message);
                break;
            case 'error':
                this.statusBar.setError(message);
                break;
        }
    }
    showNotification(type, message) {
        if (type === 'info') {
            vscode.window.showInformationMessage(message);
        }
        else {
            vscode.window.showErrorMessage(message);
        }
    }
    async determineProjectType() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        const fileCollector = new FileCollectionService_1.FileCollectionService(workspaceFolders[0].uri.fsPath);
        const files = await fileCollector.collectFiles();
        // If we have any valid files, use analyze endpoint
        return files.length > 0 ? 'analyze' : 'initialize';
    }
    async handleProjectOperation(details) {
        try {
            // Cache the project details if provided
            if (details !== undefined) {
                await this.context.globalState.update('projectAnalysisDetails', details);
            }
            else {
                // Use cached details if none provided (analyze case)
                details = this.context.globalState.get('projectAnalysisDetails', '');
            }
            this.statusBar.setAnalyzing('Hanzo: Analyzing...');
            this.updateUI('loading', 'Analyzing project...', '10%');
            console.info('[Hanzo] Analyzing project...');
            const projectType = await this.determineProjectType();
            this.updateUI('loading', 'Scanning project files...', '20%');
            console.info(`[Hanzo] Determined project type: ${projectType}`);
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder found');
            }
            let requestBody;
            let fileCount = 0;
            if (projectType === 'analyze') {
                console.info('[Hanzo] Collecting project files...');
                this.updateUI('loading', 'Collecting and analyzing files...', '40%');
                const fileCollector = new FileCollectionService_1.FileCollectionService(workspaceFolders[0].uri.fsPath);
                const files = await fileCollector.collectFiles();
                // Log directory sizes before API call
                console.info('\n[Hanzo] Project Size Analysis:');
                console.info(fileCollector.getDirectorySizeReport());
                const totalSizeMB = fileCollector.getTotalSize() / (1024 * 1024);
                console.info(`\n[Hanzo] Total Project Size (including JSON structure): ${totalSizeMB.toFixed(2)} MB`);
                // Add function to flatten file hierarchy
                const flattenFiles = (nodes) => {
                    return nodes.reduce((acc, node) => {
                        if (node.type === 'directory') {
                            // Add directory node without children
                            acc.push({
                                path: node.path,
                                type: 'directory'
                            });
                            // Recursively flatten and add children
                            if (node.children) {
                                acc.push(...flattenFiles(node.children));
                            }
                        }
                        else {
                            acc.push(node);
                        }
                        return acc;
                    }, []);
                };
                // Filter and flatten files
                const validFiles = flattenFiles(files).filter(file => file.type === 'directory' ||
                    (file.content && file.content !== '[File too large to process]'));
                // Count files for metrics
                fileCount = validFiles.filter(file => file.type === 'file').length;
                console.info(`[Hanzo] Valid files for analysis: ${validFiles.length} (${fileCount} actual files)`);
                console.info(`[Hanzo Metrics] Pre-analysis file count: ${fileCount}`);
                this.updateUI('loading', 'Processing project data...', '60%');
                requestBody = {
                    files: validFiles,
                    ...(details ? { initialDescription: details } : {})
                };
            }
            else {
                requestBody = { initialDescription: details };
            }
            // Add try-catch for JSON stringify with size logging
            let jsonBody;
            try {
                jsonBody = JSON.stringify(requestBody);
                console.info(`[Hanzo] Request body size: ${(jsonBody.length / (1024 * 1024)).toFixed(2)} MB`);
            }
            catch (error) {
                console.error('Failed to stringify request body:', error);
                throw new Error('Project is too large to process. Try removing some files or directories.');
            }
            this.updateUI('loading', 'Sending data to server...', '80%');
            const endpoint = projectType === 'initialize' ? '/projects/initialize' : '/projects/analyze';
            console.info('[Hanzo] Sending request to API...', `${this.config.apiUrl}${endpoint}`);
            // Determine if we should use gzip compression
            // CURRENTLY TIMES OUT ON LARGE PROJECTS, SO DISABLED
            const shouldGzip = false;
            // Send request to API using ApiClient
            let response = await this.apiClient.makeAuthenticatedRequest(`/projects/${projectType}`, jsonBody, {
                shouldGzip,
                progressLocation: vscode.ProgressLocation.Notification
            });
            let responseText;
            try {
                responseText = JSON.stringify(response.data);
                console.info('[Hanzo] API Response Status:', response.status);
                if (response.status >= 400) {
                    if (response.status === 413) {
                        // Log directory sizes if content length exceeded
                        const fileCollector = new FileCollectionService_1.FileCollectionService(workspaceFolders[0].uri.fsPath);
                        console.info('[Hanzo] Directory Size Report:');
                        console.info(fileCollector.getDirectorySizeReport());
                        // Check if the error occurred despite chunking
                        if (jsonBody.includes('"chunkInfo"')) {
                            // This means we were already using chunking
                            throw new Error(`API request failed: Request entity too large despite chunking. ` +
                                `Please reduce your project size by excluding large files or directories using .hanzoignore.`);
                        }
                        else {
                            // Standard chunking message
                            throw new Error(`API request failed: Request entity too large. The system will automatically chunk large requests. ` +
                                `If you continue to see this error, please try reducing your project size by excluding large files or directories.`);
                        }
                    }
                    throw new Error(`API request failed with status ${response.status}: ${responseText}`);
                }
                const content = response.data;
                if (!content.success) {
                    throw new Error(content.error?.message || 'API request failed');
                }
                // Add refinement step
                if (content.data?.specification) {
                    this.updateUI('loading', 'Refining specification...', '90%');
                    console.info('[Hanzo] Starting specification refinement process...');
                    this.showNotification('info', 'Starting specification refinement process. This may take a few minutes.');
                    // Create an array to store all specification files
                    let allSpecifications = [];
                    try {
                        const combinedSpecification = content.data.specification.content;
                        // Step 1: Get output file specifications
                        console.info('[Hanzo] Getting output file specifications...');
                        this.updateUI('loading', 'Determining required output files...', '90%');
                        const outputFileSpecs = await this.getOutputFileSpecifications(combinedSpecification);
                        console.info(`[Hanzo] Retrieved ${outputFileSpecs.length} output file specifications`);
                        this.showNotification('info', `Determined ${outputFileSpecs.length} specification files to generate.`);
                        // Check if we have any output file specifications
                        if (!outputFileSpecs || outputFileSpecs.length === 0) {
                            console.warn('[Hanzo] No output file specifications found, skipping refinement');
                            return;
                        }
                        // Step 2: Process each output file specification with refine-multi
                        console.info('[Hanzo] Starting serial refinement of output files...');
                        this.updateUI('loading', `Refining ${outputFileSpecs.length} specification files...`, '90%');
                        console.info(`[Hanzo] Using API endpoint: ${this.config.apiUrl}/projects/specification/refine-multi`);
                        // Process files in batches of 3 (parallel requests)
                        const batchSize = 3;
                        for (let i = 0; i < outputFileSpecs.length; i += batchSize) {
                            const batch = outputFileSpecs.slice(i, i + batchSize);
                            console.info(`[Hanzo] Processing batch ${Math.floor(i / batchSize) + 1} with ${batch.length} files`);
                            const batchFileNames = batch.map(spec => spec.fileName).join(', ');
                            this.updateUI('loading', `Refining files (${i + 1}-${Math.min(i + batch.length, outputFileSpecs.length)}/${outputFileSpecs.length}): ${batchFileNames}`, `${Math.min(90 + (i / outputFileSpecs.length) * 9, 98)}%`);
                            // Process batch in parallel
                            const batchPromises = batch.map(async (outputSpec, index) => {
                                const batchIndex = i + index;
                                console.info(`[Hanzo] Refining output file ${batchIndex + 1}/${outputFileSpecs.length}: ${outputSpec.fileName}`);
                                this.statusBar.setAnalyzing(`Refining: ${outputSpec.fileName}`);
                                // Add retry logic for each file
                                let retryCount = 0;
                                const maxRetries = 1;
                                const performFileRefinement = async () => {
                                    console.info(`[Hanzo] Sending refinement request for ${outputSpec.fileName} (attempt ${retryCount + 1}/${maxRetries + 1})...`);
                                    // Log the request payload for debugging
                                    const payload = {
                                        specification: combinedSpecification,
                                        outputFileRequired: outputSpec
                                    };
                                    console.info(`[Hanzo] Refinement request payload for ${outputSpec.fileName}:`, JSON.stringify(outputSpec));
                                    return this.apiClient.makeAuthenticatedRequest('/projects/specification/refine-multi', payload);
                                };
                                try {
                                    let fileRefinementResponse;
                                    try {
                                        fileRefinementResponse = await performFileRefinement();
                                        // Log the response for debugging
                                        console.info(`[Hanzo] Received refinement response for ${outputSpec.fileName} with status: ${fileRefinementResponse.status}`);
                                        console.info(`[Hanzo] Response data for ${outputSpec.fileName}:`, JSON.stringify(fileRefinementResponse.data));
                                    }
                                    catch (error) {
                                        // Check if it's a timeout error and we haven't retried yet
                                        if (retryCount < maxRetries &&
                                            error instanceof Error &&
                                            (error.message.includes('timed out') || error.message.includes('timeout'))) {
                                            retryCount++;
                                            console.info(`[Hanzo] Refinement for ${outputSpec.fileName} timed out, retrying (attempt ${retryCount + 1}/${maxRetries + 1})...`);
                                            // Wait a moment before retrying
                                            await new Promise(resolve => setTimeout(resolve, 2000));
                                            // Retry the refinement
                                            fileRefinementResponse = await performFileRefinement();
                                        }
                                        else {
                                            // If it's not a timeout or we've already retried, rethrow
                                            throw error;
                                        }
                                    }
                                    if (fileRefinementResponse.status >= 400) {
                                        console.error(`[Hanzo] Refinement API request for ${outputSpec.fileName} failed with status ${fileRefinementResponse.status}`);
                                        console.error(`[Hanzo] Response data:`, JSON.stringify(fileRefinementResponse.data));
                                        throw new Error(`Refinement API request for ${outputSpec.fileName} failed with status ${fileRefinementResponse.status}`);
                                    }
                                    const fileRefinementContent = fileRefinementResponse.data;
                                    // Check if the response is a string (sometimes happens with certain API configurations)
                                    if (typeof fileRefinementResponse.data === 'string') {
                                        try {
                                            console.info(`[Hanzo] Response for ${outputSpec.fileName} is a string, attempting to parse as JSON`);
                                            const parsedData = JSON.parse(fileRefinementResponse.data);
                                            // Check if the parsed data has the expected structure
                                            if (parsedData && parsedData.success) {
                                                console.info(`[Hanzo] Successfully parsed string response for ${outputSpec.fileName}`);
                                                // If we have specifications array in the parsed data
                                                if (parsedData.data?.specifications &&
                                                    Array.isArray(parsedData.data.specifications) &&
                                                    parsedData.data.specifications.length > 0) {
                                                    // Find the matching specification in the array
                                                    const matchingSpec = parsedData.data.specifications.find((spec) => spec.name === outputSpec.fileName.replace(/\.mdc$/, '') ||
                                                        `${spec.name}.mdc` === outputSpec.fileName);
                                                    if (matchingSpec) {
                                                        console.info(`[Hanzo] Found matching specification for ${outputSpec.fileName} in parsed string response`);
                                                        return matchingSpec;
                                                    }
                                                    // If no exact match, use the first specification
                                                    if (parsedData.data.specifications[0]) {
                                                        console.warn(`[Hanzo] No exact match found for ${outputSpec.fileName} in parsed string response, using first specification`);
                                                        return parsedData.data.specifications[0];
                                                    }
                                                }
                                                // If we have a single specification in the parsed data
                                                if (parsedData.data?.specification) {
                                                    console.info(`[Hanzo] Found single specification in parsed string response for ${outputSpec.fileName}`);
                                                    return {
                                                        name: outputSpec.fileName.replace(/\.mdc$/, ''),
                                                        description: outputSpec.description,
                                                        content: parsedData.data.specification.content,
                                                        timestamp: parsedData.data.specification.timestamp
                                                    };
                                                }
                                            }
                                        }
                                        catch (parseError) {
                                            console.error(`[Hanzo] Failed to parse string response for ${outputSpec.fileName}:`, parseError);
                                            // Continue with normal processing if parsing fails
                                        }
                                    }
                                    if (!fileRefinementContent.success) {
                                        console.error(`[Hanzo] Refinement for ${outputSpec.fileName} was not successful:`, JSON.stringify(fileRefinementContent));
                                        throw new Error(`Failed to refine specification for ${outputSpec.fileName}: ${fileRefinementContent.error?.message || 'Unknown error'}`);
                                    }
                                    // Check if we have a specification in the response
                                    if (fileRefinementContent.data?.specification) {
                                        // Create a SpecificationFile from the response
                                        const specFile = {
                                            name: outputSpec.fileName.replace(/\.mdc$/, ''), // Remove .mdc extension if present
                                            description: outputSpec.description,
                                            content: fileRefinementContent.data.specification.content,
                                            timestamp: fileRefinementContent.data.specification.timestamp
                                        };
                                        console.info(`[Hanzo] Successfully refined specification for ${outputSpec.fileName}`);
                                        return specFile;
                                    }
                                    // Check if we have specifications array in the response
                                    else if (fileRefinementContent.data?.specifications &&
                                        Array.isArray(fileRefinementContent.data.specifications) &&
                                        fileRefinementContent.data.specifications.length > 0) {
                                        // Find the matching specification in the array
                                        const matchingSpec = fileRefinementContent.data.specifications.find((spec) => spec.name === outputSpec.fileName.replace(/\.mdc$/, '') ||
                                            `${spec.name}.mdc` === outputSpec.fileName);
                                        if (matchingSpec) {
                                            console.info(`[Hanzo] Found matching specification for ${outputSpec.fileName} in specifications array`);
                                            return matchingSpec;
                                        }
                                        // If no exact match, use the first specification
                                        if (fileRefinementContent.data.specifications[0]) {
                                            console.warn(`[Hanzo] No exact match found for ${outputSpec.fileName}, using first specification`);
                                            return fileRefinementContent.data.specifications[0];
                                        }
                                        throw new Error(`No matching specification found in specifications array for ${outputSpec.fileName}`);
                                    }
                                    else {
                                        // Log the response for debugging
                                        console.error(`[Hanzo] Unexpected response format for ${outputSpec.fileName}:`, JSON.stringify(fileRefinementContent.data));
                                        throw new Error(`No specification content found in refinement response for ${outputSpec.fileName}`);
                                    }
                                }
                                catch (error) {
                                    console.error(`[Hanzo] Failed to refine specification for ${outputSpec.fileName}:`, error);
                                    // Fail silently instead of creating a placeholder specification
                                    return null;
                                }
                            });
                            // Wait for all files in this batch to complete
                            const batchResults = await Promise.all(batchPromises);
                            // Filter out null results (failed specifications)
                            const validResults = batchResults.filter(result => result !== null);
                            allSpecifications.push(...validResults);
                            // Update progress
                            const progress = Math.min(90 + (i + batch.length) / outputFileSpecs.length * 10, 99);
                            this.updateUI('loading', `Refining specifications (${i + batch.length}/${outputFileSpecs.length})...`, `${progress.toFixed(0)}%`);
                        }
                        console.info(`[Hanzo] All ${allSpecifications.length} specification files have been refined successfully`);
                        if (allSpecifications.length < outputFileSpecs.length) {
                            console.info(`[Hanzo] ${outputFileSpecs.length - allSpecifications.length} specification files failed to refine and were skipped`);
                        }
                        // Step 3: Update the specification files
                        if (allSpecifications.length > 0) {
                            this.updateUI('loading', `Writing ${allSpecifications.length} specification files to disk...`, '99%');
                            console.info('[Hanzo] Writing specification files to disk...');
                            await this.updateMultiSpecificationFiles(allSpecifications, details);
                            this.showNotification('info', `Successfully generated ${allSpecifications.length} specification files.`);
                        }
                        else {
                            console.warn('[Hanzo] No specification files were successfully refined');
                            // this.showNotification('info', 'No specification files were successfully refined.');
                            // Do not use original specification as fallback, just log the failure
                        }
                    }
                    catch (error) {
                        console.error('[Hanzo] Failed to refine specification:', error);
                        // Provide more helpful error message based on error type
                        let errorMessage = 'Failed to refine specification';
                        if (error instanceof Error) {
                            errorMessage = `Failed to refine specification: ${error.message}`;
                        }
                        // Show error notification to user
                        vscode.window.showErrorMessage(errorMessage);
                        // Continue with the rest of the process instead of throwing an error
                        console.info('[Hanzo] Continuing despite refinement errors');
                    }
                }
                // Record metrics for successful analysis only if we analyzed files
                console.log(`[Hanzo Metrics] About to record analysis. Project type: ${projectType}, File count: ${fileCount}`);
                if (projectType === 'analyze' && fileCount > 0) {
                    console.log(`[Hanzo Metrics] Recording analysis of ${fileCount} files after successful API call`);
                    this.metricsService.recordAnalysis(fileCount);
                    // Get updated metrics for logging
                    const updatedMetrics = this.metricsService.getMetricsForDisplay();
                    console.log('[Hanzo Metrics] After API analysis, metrics are now:', JSON.stringify(updatedMetrics));
                    // Specifically show metrics if we've analyzed files
                    if (this.panel) {
                        console.log('[Hanzo UI] Panel is available, forcing display of metrics container');
                        const calculatedMetrics = this.metricsService.getCalculatedMetrics();
                        // Force metrics display with minimal delay to catch webview in ready state
                        for (let delay of [100, 500, 1000, 2000]) {
                            setTimeout(() => {
                                if (this.panel) {
                                    console.log(`[Hanzo UI] Sending metrics update after ${delay}ms delay to force display`);
                                    this.panel.webview.postMessage({
                                        command: 'updateMetrics',
                                        metrics: calculatedMetrics,
                                        forceShow: true
                                    });
                                }
                            }, delay);
                        }
                    }
                    else {
                        console.log('[Hanzo UI] No panel available to display metrics. Metrics will be shown when panel is opened.');
                    }
                }
                else {
                    console.log(`[Hanzo Metrics] Skipping metrics recording. Project type: ${projectType}, File count: ${fileCount}`);
                }
                this.statusBar.setSuccess('Analysis complete');
                this.updateUI('success', projectType === 'analyze' ?
                    'Project analysis complete!' :
                    content.data?.message.content, '100%');
                this.showNotification('info', projectType === 'analyze' ?
                    'Project analysis complete!' :
                    'Project files created successfully!');
            }
            catch (error) {
                console.error('Error:', error);
                const projectType = await this.determineProjectType().catch(() => 'analyze');
                const errorMessage = error instanceof Error ? error.message : 'Operation failed';
                this.statusBar.setError(errorMessage);
                this.updateUI('error', errorMessage);
                this.showNotification('error', `Failed to ${projectType} project: ${errorMessage}`);
                throw error;
            }
        }
        catch (error) {
            console.error('[Hanzo] Project Operation Error:', error);
            if (error instanceof Error) {
                console.error('[Hanzo] Error Stack:', error.stack);
            }
            const projectType = await this.determineProjectType().catch(() => 'analyze');
            const errorMessage = error instanceof Error ? error.message : 'Operation failed';
            console.error('[Hanzo] Error Message:', errorMessage);
            console.error('[Hanzo] Project Type:', projectType);
            this.statusBar.setError(errorMessage);
            this.updateUI('error', errorMessage);
            this.showNotification('error', `Failed to ${projectType} project: ${errorMessage}`);
            throw error;
        }
    }
}
exports.ProjectManager = ProjectManager;
// Add this class before the activate function
class HanzoProjectProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        const items = [];
        const projectDetails = this.context.globalState.get('projectDetails');
        if (projectDetails) {
            const item = new vscode.TreeItem('Project Details');
            item.description = projectDetails;
            items.push(item);
        }
        return Promise.resolve(items);
    }
    constructor(context) {
        this.context = context;
    }
}
async function activate(context) {
    // Initialize auth manager first
    const authManager = manager_1.AuthManager.getInstance(context);
    // Store extension API for command access
    let extensionApi = {};
    // Check if this is first run and show welcome view
    const isFirstRun = context.globalState.get('installationTime', 0) === 0;
    const hasShownWelcome = context.globalState.get('hasShownWelcomeView', false);
    if (isFirstRun || !hasShownWelcome) {
        // Show welcome view on first run
        setTimeout(async () => {
            const isAuthenticated = await authManager.isAuthenticated();
            if (!isAuthenticated) {
                // Only show welcome view for non-authenticated users
                await showWelcomeView(context);
            }
        }, 2000); // Small delay to allow VS Code to fully load
    }
    // Register commands immediately to prevent "command not found" errors
    const immediateCommands = [
        vscode.commands.registerCommand('hanzo.openManager', async () => {
            // await initializeExtension(context, authManager);
            const api = await vscode.commands.executeCommand('hanzo._getApi');
            if (api?.panel) {
                api.panel.reveal();
            }
            else if (api?.createPanel) {
                api.createPanel();
            }
        }),
        vscode.commands.registerCommand('hanzo.openWelcomeGuide', async () => {
            await showWelcomeView(context);
        }),
        vscode.commands.registerCommand('hanzo.login', async () => {
            try {
                await authManager.initiateAuth();
                // await initializeExtension(context, authManager);
            }
            catch (error) {
                console.error('[Hanzo] Login failed:', error);
                vscode.window.showErrorMessage('Failed to login to Hanzo. Please try again.');
            }
        }),
        vscode.commands.registerCommand('hanzo.checkMetrics', async () => {
            console.log('[Hanzo] Manually checking metrics');
            const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
            const metrics = metricsService.getCalculatedMetrics();
            console.log('[Hanzo] Current metrics:', JSON.stringify(metrics));
            // Show metrics in notification
            const message = `Hanzo metrics: ${metrics.filesAnalyzed} files analyzed, AI context improved by ${metrics.aiContextScore}%, productivity boosted by ${metrics.productivityBoost}%`;
            vscode.window.showInformationMessage(message);
            // Update status bar
            const statusBar = StatusBarService_1.StatusBarService.getInstance();
            statusBar.setMetricsService(metricsService);
            // Update webview if it exists
            const api = await vscode.commands.executeCommand('hanzo._getApi');
            console.log('[Hanzo Debug] API object available:', !!api);
            console.log('[Hanzo Debug] Panel available:', !!(api && api.panel));
            if (api?.panel) {
                console.log('[Hanzo] Updating metrics in webview');
                api.panel.webview.postMessage({
                    command: 'updateMetrics',
                    metrics: metrics
                });
            }
            else {
                console.log('[Hanzo Debug] No panel found, creating one to display metrics');
                // If no panel exists, create one to show the metrics
                if (api && typeof api.createPanel === 'function') {
                    const panel = api.createPanel();
                    console.log('[Hanzo Debug] Panel created, sending metrics');
                    setTimeout(() => {
                        // Wait a bit for the panel to initialize
                        panel.webview.postMessage({
                            command: 'updateMetrics',
                            metrics: metrics
                        });
                    }, 1000);
                }
                else {
                    console.log('[Hanzo Debug] Cannot create panel, api.createPanel is not available');
                    // Open the manager using the command
                    vscode.commands.executeCommand('hanzo.openManager').then(() => {
                        console.log('[Hanzo Debug] Opened manager via command, now trying to get API again');
                        // Try again to get the API after opening the manager
                        setTimeout(async () => {
                            const refreshedApi = await vscode.commands.executeCommand('hanzo._getApi');
                            if (refreshedApi?.panel) {
                                console.log('[Hanzo Debug] Got panel after opening manager, sending metrics');
                                refreshedApi.panel.webview.postMessage({
                                    command: 'updateMetrics',
                                    metrics: metrics
                                });
                            }
                            else {
                                console.log('[Hanzo Debug] Still no panel available after opening manager');
                            }
                        }, 1000);
                    });
                }
            }
        }),
        vscode.commands.registerCommand('hanzo.resetMetrics', async () => {
            console.log('[Hanzo] Manually resetting metrics');
            const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
            metricsService.resetMetrics();
            // Show confirmation
            vscode.window.showInformationMessage('Hanzo metrics have been reset');
            // Update status bar
            const statusBar = StatusBarService_1.StatusBarService.getInstance();
            statusBar.setMetricsService(metricsService);
            // Update webview if it exists
            const api = await vscode.commands.executeCommand('hanzo._getApi');
            if (api?.panel) {
                console.log('[Hanzo] Updating metrics in webview after reset');
                api.panel.webview.postMessage({
                    command: 'updateMetrics',
                    metrics: metricsService.getCalculatedMetrics()
                });
            }
        }),
    ];
    context.subscriptions.push(...immediateCommands);
    context.subscriptions.push(vscode.commands.registerCommand('hanzo._getApi', () => extensionApi));
    // Initialize extension and store API
    const api = await initializeExtension(context, authManager);
    extensionApi = api;
    // Initialize metrics service
    console.log('[Hanzo] Initializing metrics service in activate function');
    const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
    const statusBar = StatusBarService_1.StatusBarService.getInstance();
    console.log('[Hanzo] Setting metrics service on status bar');
    statusBar.setMetricsService(metricsService);
    // We don't need a separate command for showing metrics anymore
    // as we're displaying them in the Project Manager view
    console.log('[Hanzo] Extension activation complete');
    return api;
}
async function initializeExtension(context, authManager) {
    let panel;
    let projectManager;
    // Initialize services
    const statusBar = StatusBarService_1.StatusBarService.getInstance();
    const analysisService = AnalysisService_1.AnalysisService.getInstance(context);
    const reminderService = new ReminderService_1.ReminderService(context);
    context.subscriptions.push(statusBar, reminderService);
    async function checkAuthAndExecute(action) {
        const isAuthenticated = await authManager.isAuthenticated();
        if (!isAuthenticated) {
            vscode.window.showErrorMessage('Please login to use Hanzo features');
            vscode.commands.executeCommand('hanzo.login');
            return;
        }
        await action();
    }
    function createPanel() {
        if (!panel) {
            panel = vscode.window.createWebviewPanel('hanzoManager', 'Hanzo', vscode.ViewColumn.Two, {
                enableScripts: true
            });
            panel.webview.html = getWebviewContent();
            projectManager = new ProjectManager(panel, context);
            analysisService.setProjectManager(projectManager);
            // Get metrics service and pass it to the status bar
            const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
            const statusBar = StatusBarService_1.StatusBarService.getInstance();
            statusBar.setMetricsService(metricsService);
            panel.onDidDispose(() => {
                panel = undefined;
                if (!projectManager) {
                    projectManager = new ProjectManager(undefined, context);
                    analysisService.setProjectManager(projectManager);
                }
            }, null, context.subscriptions);
            panel.webview.onDidReceiveMessage(async (message) => {
                console.info('Received message from webview:', message);
                if (message.command === 'checkAuthStatus') {
                    const isAuthenticated = await authManager.isAuthenticated();
                    panel.webview.postMessage({
                        command: 'updateAuthStatus',
                        isAuthenticated
                    });
                    // If authenticated, also send the metrics data
                    if (isAuthenticated) {
                        const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
                        const metrics = metricsService.getCalculatedMetrics();
                        console.log('[Hanzo Panel] Sending initial metrics on auth check:', JSON.stringify(metrics));
                        // Delay metrics update to ensure DOM is ready
                        setTimeout(() => {
                            panel.webview.postMessage({
                                command: 'updateMetrics',
                                metrics: metrics
                            });
                        }, 500);
                    }
                }
                else if (message.command === 'login') {
                    try {
                        await authManager.initiateAuth();
                        panel.webview.postMessage({
                            command: 'updateAuthStatus',
                            isAuthenticated: true
                        });
                        // After successful login, send metrics
                        const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
                        const metrics = metricsService.getCalculatedMetrics();
                        // Delay metrics update to ensure DOM is ready
                        setTimeout(() => {
                            panel.webview.postMessage({
                                command: 'updateMetrics',
                                metrics: metrics
                            });
                        }, 500);
                    }
                    catch (error) {
                        console.error('[Hanzo] Login failed:', error);
                        vscode.window.showErrorMessage('Failed to login to Hanzo. Please try again.');
                    }
                }
                else {
                    // For all other commands, check auth first
                    const isAuthenticated = await authManager.isAuthenticated();
                    if (!isAuthenticated) {
                        panel.webview.postMessage({
                            command: 'updateAuthStatus',
                            isAuthenticated: false
                        });
                        return;
                    }
                    if (message.command === 'analyzeProject') {
                        await analysisService.analyze(message.details);
                    }
                    else if (message.command === 'getIdePreference') {
                        const ide = vscode.workspace.getConfiguration('hanzo').get('ide', 'cursor');
                        panel.webview.postMessage({
                            command: 'updateIdePreference',
                            ide: ide
                        });
                        // Also send metrics after IDE preference is updated
                        const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
                        const metrics = metricsService.getCalculatedMetrics();
                        // Delay metrics update to ensure DOM is ready
                        setTimeout(() => {
                            panel.webview.postMessage({
                                command: 'updateMetrics',
                                metrics: metrics
                            });
                        }, 500);
                    }
                    else if (message.command === 'updateIdePreference') {
                        await vscode.workspace.getConfiguration('hanzo').update('ide', message.ide, true);
                        vscode.window.showInformationMessage(`IDE preference updated to ${message.ide}`);
                    }
                    else if (message.command === 'requestMetrics') {
                        // Handle explicit request for metrics from webview
                        const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
                        const metrics = metricsService.getCalculatedMetrics();
                        panel.webview.postMessage({
                            command: 'updateMetrics',
                            metrics: metrics
                        });
                    }
                }
            });
            // Send metrics after the panel is created (with a delay to ensure DOM is ready)
            setTimeout(() => {
                if (panel) {
                    const metricsService = HanzoMetricsService_1.HanzoMetricsService.getInstance(context);
                    const metrics = metricsService.getCalculatedMetrics();
                    console.log('[Hanzo Panel] Sending initial metrics after panel creation:', JSON.stringify(metrics));
                    panel.webview.postMessage({
                        command: 'updateMetrics',
                        metrics: metrics
                    });
                }
            }, 1000);
        }
        return panel;
    }
    // Initialize projectManager without panel for command palette usage
    if (!projectManager) {
        projectManager = new ProjectManager(undefined, context);
        analysisService.setProjectManager(projectManager);
    }
    // Register remaining commands
    const commands = [
        vscode.commands.registerCommand('hanzo.reanalyzeProject', () => checkAuthAndExecute(async () => {
            try {
                await analysisService.analyze();
            }
            catch (error) {
                // Error already handled by AnalysisService
            }
        })),
        vscode.commands.registerCommand('hanzo.triggerReminder', () => checkAuthAndExecute(async () => {
            reminderService.triggerManually();
        })),
        vscode.commands.registerCommand('hanzo.logout', async () => {
            await authManager.logout();
            if (panel) {
                panel.dispose();
            }
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }),
        // Debug commands for testing
        vscode.commands.registerCommand('hanzo.debug.authState', async () => {
            const token = await authManager.getAuthToken();
            const isAuthenticated = await authManager.isAuthenticated();
            const clientId = await context.secrets.get('client_id');
            const authState = context.globalState.get('auth_state');
            console.info('[Hanzo Debug] Auth State:', {
                isAuthenticated,
                hasToken: !!token,
                clientId,
                authState
            });
            vscode.window.showInformationMessage(`Auth State: ${isAuthenticated ? 'Authenticated' : 'Not Authenticated'}`);
        }),
        vscode.commands.registerCommand('hanzo.debug.clearAuth', async () => {
            await context.secrets.delete('auth_token');
            await context.secrets.delete('client_id');
            await context.globalState.update('auth_state', undefined);
            // Also reset installation time for easier testing
            await context.globalState.update('installationTime', 0);
            await context.globalState.update('lastNotificationTime', 0);
            // Reset welcome notification flag for testing onboarding
            await context.globalState.update('hasShownWelcome', false);
            // Reset welcome view flag as well
            await context.globalState.update('hasShownWelcomeView', false);
            console.info('[Hanzo Debug] Cleared all auth data and reset installation time');
            vscode.window.showInformationMessage('Auth data and installation time cleared. Please reload window.');
        })
    ];
    context.subscriptions.push(...commands);
    return {
        panel,
        createPanel
    };
}
/// Update getWebviewContent to use imported styles
function getWebviewContent() {
    const uiText = (0, textContent_1.getUIText)();
    return `<!DOCTYPE html>
    <html>
        <head>
            <style>${(0, webview_1.getWebviewStyles)()}
                .login-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    text-align: center;
                    padding: 20px;
                }
                .login-title {
                    font-size: 28px;
                    color: var(--vscode-terminal-ansiGreen);
                    margin-bottom: 20px;
                }
                .login-description {
                    font-size: 16px;
                    line-height: 1.5;
                    margin-bottom: 30px;
                    color: var(--vscode-foreground);
                    max-width: 600px;
                }
                .login-benefits {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 30px;
                }
                .login-benefit {
                    font-size: 16px;
                    line-height: 1.5;
                    display: flex;
                    align-items: center;
                    color: var(--vscode-foreground);
                }
                .login-benefit::before {
                    content: "✓";
                    color: var(--vscode-terminal-ansiGreen);
                    margin-right: 10px;
                    font-weight: bold;
                }
                .login-button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 12px 24px;
                    cursor: pointer;
                    margin-top: 20px;
                    border-radius: 4px;
                    font-size: 16px;
                    font-weight: bold;
                }
                .login-button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .hidden {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                }
                
                .visible {
                    display: block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                }
                
                /* Keyframe animations */
                @keyframes pulse {
                    0% {
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 20px rgba(76, 175, 80, 0.2);
                    }
                    50% {
                        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 30px rgba(76, 175, 80, 0.5);
                    }
                    100% {
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 20px rgba(76, 175, 80, 0.2);
                    }
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .metrics-container {
                    margin-top: 20px;
                    padding: 16px;
                    border-radius: 6px;
                    background: linear-gradient(135deg, rgba(32, 40, 62, 0.95) 0%, rgba(46, 55, 80, 0.95) 100%);
                    border: 1px solid rgba(76, 175, 80, 0.4);
                    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.3), 0 0 5px rgba(76, 175, 80, 0.2);
                    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif);
                    animation: fadeIn 0.5s ease-out;
                    transition: box-shadow 0.3s ease;
                }
                
                .metrics-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 12px;
                    border-bottom: 1px solid rgba(76, 175, 80, 0.4);
                    padding-bottom: 8px;
                }
                
                .metrics-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: #4CAF50;
                    margin: 0;
                    flex-grow: 1;
                    letter-spacing: 0.2px;
                }
                
                .metrics-status {
                    background-color: #4CAF50;
                    color: #fff;
                    font-size: 9px;
                    font-weight: 500;
                    padding: 2px 8px;
                    border-radius: 16px;
                    text-transform: uppercase;
                    letter-spacing: 0.2px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                
                .metrics-status::before {
                    content: "";
                    display: inline-block;
                    width: 5px;
                    height: 5px;
                    background-color: #fff;
                    border-radius: 50%;
                }
                
                .metrics-list {
                    list-style-type: none;
                    padding: 0;
                    margin: 0;
                }
                
                .metrics-item {
                    display: flex;
                    align-items: center;
                    margin-bottom: 10px;
                    font-size: 12px;
                    color: #e8e8e8;
                    animation: fadeIn 0.5s ease-out;
                    animation-fill-mode: both;
                }
                
                .metrics-item:nth-child(1) { animation-delay: 0.1s; }
                .metrics-item:nth-child(2) { animation-delay: 0.2s; }
                .metrics-item:nth-child(3) { animation-delay: 0.3s; }
                
                .metrics-item:last-child {
                    margin-bottom: 0;
                }
                
                .metrics-item:before {
                    content: "";
                    display: inline-block;
                    width: 5px;
                    height: 5px;
                    background-color: #4CAF50;
                    border-radius: 50%;
                    margin-right: 8px;
                }
                
                .metrics-label {
                    flex: 1;
                    font-size: 12px;
                    letter-spacing: 0.1px;
                }
                
                .metrics-value {
                    font-weight: 600;
                    color: #4CAF50;
                    margin-left: 8px;
                    font-size: 12px;
                }
                
                .metrics-footer {
                    margin-top: 12px;
                    padding-top: 10px;
                    border-top: 1px solid rgba(76, 175, 80, 0.2);
                    font-size: 11px;
                    color: #bbb;
                    font-style: italic;
                    text-align: center;
                    animation: fadeIn 0.5s ease-out;
                    animation-delay: 0.5s;
                    animation-fill-mode: both;
                }
            </style>
        </head>
        <body>
            <div id="loginView" class="login-container hidden">
                <h2 class="login-title">${uiText.loggedOutView.title}</h2>
                <p class="login-description">${uiText.loggedOutView.description}</p>
                
                <div class="login-benefits">
                    ${uiText.loggedOutView.benefits.map((benefit) => `<div class="login-benefit">${benefit}</div>`).join('')}
                </div>
                
                <button class="login-button" onclick="handleLogin()">
                    ${uiText.loggedOutView.loginButton}
                </button>
            </div>

            <div id="mainView" class="hidden">
                <div class="tabs">
                    <button class="tab active" onclick="showTab('project')">Project</button>
                    <button class="tab" onclick="showTab('settings')">Settings</button>
                </div>

                <div id="project" class="tab-content">
                    <div class="form-container">
                        <div id="initForm">
                            <div class="form-group">
                                <label>Your code will be analyzed with the information you provide below to generate context for AI.</label>
                                <textarea 
                                    placeholder="(Optional) Enter project details..."
                                    id="projectDetails"
                                ></textarea>
                                <button class="analyze-button">
                                    <span class="button-content">
                                        <span class="button-text">Analyze Project (Ctrl + ⏎)</span>
                                        <svg class="spinner" viewBox="0 0 50 50">
                                            <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle>
                                        </svg>
                                    </span>
                                </button>
                                <div class="progress-container">
                                    <div class="progress-bar"></div>
                                    <div class="progress-text">0%</div>
                                </div>
                                <div id="statusMessage"></div>
                            </div>
                        </div>
                        <div id="resultMessage"></div>
                        
                        <div id="metricsContainer" class="metrics-container hidden">
                            <div class="metrics-header">
                                <h2 class="metrics-title">Hanzo Impact</h2>
                                <span id="metricsStatus" class="metrics-status">ANALYSIS DONE</span>
                            </div>
                            <ul class="metrics-list">
                                <li class="metrics-item">
                                    <span class="metrics-label">Files analyzed:</span>
                                    <span id="filesAnalyzed" class="metrics-value">0</span>
                                </li>
                                <li class="metrics-item">
                                    <span class="metrics-label">Analysis runs:</span>
                                    <span id="totalAnalyses" class="metrics-value">0</span>
                                </li>
                                <li class="metrics-item">
                                    <span class="metrics-label">AI context improved by:</span>
                                    <span id="aiContextScore" class="metrics-value">0%</span>
                                </li>
                            </ul>
                            <div class="metrics-footer">
                                Your AI is now supercharged with deep context from your codebase — Experience smarter, faster, more accurate results.
                            </div>
                        </div>
                    </div>
                </div>
                
                <div id="settings" class="tab-content">
                    <div class="form-container">
                        <div class="form-group">
                            <h2 class="settings-heading">IDE Preference</h2>
                            <div class="radio-group">
                                <label class="radio-label">
                                    <input type="radio" name="ide" value="cursor" onclick="updateIdePreference('cursor')">
                                    <span class="radio-text">Cursor</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="ide" value="copilot" onclick="updateIdePreference('copilot')">
                                    <span class="radio-text">GitHub Copilot</span>
                                </label>
                                <label class="radio-label">
                                    <input type="radio" name="ide" value="codium" onclick="updateIdePreference('codium')">
                                    <span class="radio-text">Codium</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentProjectDetails = '';
                let isAuthenticated = false;

                function initializeView() {
                    showTab('project');
                    // Check auth status and get IDE preference
                    vscode.postMessage({ command: 'checkAuthStatus' });
                    vscode.postMessage({ command: 'getIdePreference' });
                }

                function handleLogin() {
                    vscode.postMessage({ command: 'login' });
                }

                function updateViewState() {
                    const loginView = document.getElementById('loginView');
                    const mainView = document.getElementById('mainView');
                    
                    if (isAuthenticated) {
                        loginView.classList.add('hidden');
                        mainView.classList.remove('hidden');
                    } else {
                        loginView.classList.remove('hidden');
                        mainView.classList.add('hidden');
                    }
                }

                function showTab(tabName) {
                    document.querySelectorAll('.tab-content').forEach(content => {
                        content.style.display = 'none';
                    });
                    const selectedTab = document.getElementById(tabName);
                    if (selectedTab) {
                        selectedTab.style.display = 'block';
                    }
                    
                    document.querySelectorAll('.tab').forEach(tab => {
                        tab.classList.remove('active');
                    });
                    document.querySelector(\`.tab[onclick="showTab('\${tabName}')"]\`).classList.add('active');
                }

                document.addEventListener('DOMContentLoaded', () => {
                    console.log('[Hanzo Webview] DOM content loaded, initializing UI');
                    initializeView();
                    initializeButton(document.querySelector('.analyze-button'));
                    initializeProjectDetails();
                    
                    // Check for metrics container and elements
                    const metricsContainer = document.getElementById('metricsContainer');
                    const filesAnalyzedElement = document.getElementById('filesAnalyzed');
                    const aiContextScoreElement = document.getElementById('aiContextScore');
                    const productivityBoostElement = document.getElementById('productivityBoost');
                    const codeQualityImprovementElement = document.getElementById('codeQualityImprovement');
                    
                    console.log('[Hanzo Webview] Metrics elements on DOM load:', {
                        filesAnalyzedElement: !!filesAnalyzedElement,
                        aiContextScoreElement: !!aiContextScoreElement,
                        productivityBoostElement: !!productivityBoostElement,
                        codeQualityImprovementElement: !!codeQualityImprovementElement
                    });
                    
                    // Request metrics explicitly
                    console.log('[Hanzo Webview] Requesting metrics from extension');
                    setTimeout(() => {
                        vscode.postMessage({ command: 'requestMetrics' });
                    }, 500);
                });

                // Add keyboard shortcut handler
                document.addEventListener('keydown', function(e) {
                    if (e.ctrlKey && e.key === 'Enter') {
                        const activeButton = document.querySelector('.analyze-button');
                        if (activeButton && !activeButton.disabled) {
                            handleAnalyze({ currentTarget: activeButton });
                        }
                    }
                });

                function createAnalyzeButton() {
                    return \`
                        <button class="analyze-button">
                            <span class="button-content">
                                <span class="button-text">Analyze Project (Ctrl + ⏎)</span>
                                <svg class="spinner" viewBox="0 0 50 50">
                                    <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle>
                                </svg>
                            </span>
                        </button>
                    \`;
                }

                function setButtonState(button, state, message = '') {
                    if (!button) return;
                    
                    const buttonText = button.querySelector('.button-text');
                    const spinner = button.querySelector('.spinner');
                    const progressContainer = document.querySelector('.progress-container');
                    const baseText = 'Analyze Project (Ctrl + ⏎)';
                    
                    switch(state) {
                        case 'loading':
                            button.disabled = true;
                            buttonText.textContent = 'Analyzing...';
                            if (spinner) {
                                spinner.classList.add('loading');
                            }
                            if (progressContainer) {
                                progressContainer.classList.add('visible');
                            }
                            break;
                        case 'success':
                            button.disabled = true;
                            buttonText.textContent = message || 'Success!';
                            if (spinner) {
                                spinner.classList.remove('loading');
                            }
                            if (progressContainer) {
                                progressContainer.classList.remove('visible');
                            }
                            setTimeout(() => {
                                buttonText.textContent = baseText;
                                button.disabled = false;
                            }, 2000);
                            break;
                        case 'error':
                            button.disabled = false;
                            buttonText.textContent = baseText;
                            if (spinner) {
                                spinner.classList.remove('loading');
                            }
                            if (progressContainer) {
                                progressContainer.classList.remove('visible');
                            }
                            break;
                        default:
                            button.disabled = false;
                            buttonText.textContent = baseText;
                            if (spinner) {
                                spinner.classList.remove('loading');
                            }
                            if (progressContainer) {
                                progressContainer.classList.remove('visible');
                                // Reset progress bar to 0%
                                const progressBar = progressContainer.querySelector('.progress-bar');
                                const progressText = progressContainer.querySelector('.progress-text');
                                if (progressBar && progressText) {
                                    progressBar.style.setProperty('--progress-width', '0%');
                                    progressText.textContent = '0%';
                                }
                            }
                    }
                }

                function handleAnalyze(event) {
                    const button = event.currentTarget;
                    if (!button) return;
                    
                    const statusMessage = document.getElementById('statusMessage');
                    const details = document.getElementById('projectDetails')?.value || '';
                    currentProjectDetails = details;  // Store current details
                    
                    // Reset progress bar to 0% before starting
                    const progressContainer = document.querySelector('.progress-container');
                    if (progressContainer) {
                        const progressBar = progressContainer.querySelector('.progress-bar');
                        const progressText = progressContainer.querySelector('.progress-text');
                        if (progressBar && progressText) {
                            progressBar.style.setProperty('--progress-width', '0%');
                            progressText.textContent = '0%';
                        }
                    }
                    
                    setButtonState(button, 'loading');
                    statusMessage.innerHTML = 'Analyzing project...';
                    
                    vscode.postMessage({
                        command: 'analyzeProject',
                        details: details
                    });
                }

                function initializeButton(button) {
                    if (button) {
                        button.onclick = handleAnalyze;
                    }
                }

                function updateIdePreference(ide) {
                    vscode.postMessage({ 
                        command: 'updateIdePreference',
                        ide: ide
                    });
                }

                // Add live update handler for textarea
                function initializeProjectDetails() {
                    const textarea = document.getElementById('projectDetails');
                    if (textarea) {
                        textarea.value = currentProjectDetails;
                        textarea.addEventListener('input', (e) => {
                            currentProjectDetails = e.target.value;
                        });
                    }
                }

                // Add this function to forcibly show metrics container
                function showMetricsContainer() {
                    console.log('[Hanzo Webview] Forcibly showing metrics container');
                    const metricsContainer = document.getElementById('metricsContainer');
                    if (metricsContainer) {
                        // Force display properties to ensure visibility
                        metricsContainer.classList.remove('hidden');
                        metricsContainer.classList.add('visible');
                        metricsContainer.style.display = 'block';
                        metricsContainer.style.visibility = 'visible';
                        metricsContainer.style.opacity = '1';
                        
                        // Add animation to make it noticeable
                        metricsContainer.style.animation = 'none';
                        setTimeout(() => {
                            metricsContainer.style.animation = 'pulse 2s';
                        }, 10);
                        
                        // Log container state after forcing display
                        setTimeout(() => {
                            const computedStyle = window.getComputedStyle(metricsContainer);
                            console.log('[Hanzo Webview] Metrics container after forced display:', {
                                display: computedStyle.display,
                                visibility: computedStyle.visibility,
                                opacity: computedStyle.opacity,
                                hasHiddenClass: metricsContainer.classList.contains('hidden'),
                                hasVisibleClass: metricsContainer.classList.contains('visible')
                            });
                        }, 50);
                    } else {
                        console.error('[Hanzo Webview] Could not find metrics container element to show');
                    }
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('[Hanzo Webview] Received message:', message.command);
                    
                    if (message.command === 'loadProjectDetails') {
                        currentProjectDetails = message.details;
                        const textarea = document.getElementById('projectDetails');
                        if (textarea) {
                            textarea.value = currentProjectDetails;
                        }
                    } else if (message.command === 'updateAuthStatus') {
                        isAuthenticated = message.isAuthenticated;
                        updateViewState();
                    } else if (message.command === 'updateProjectStatus') {
                        const button = document.querySelector('.analyze-button');
                        const statusMessage = document.getElementById('statusMessage');
                        const progressBar = document.querySelector('.progress-bar');
                        const progressText = document.querySelector('.progress-text');
                        
                        switch(message.status) {
                            case 'loading':
                                setButtonState(button, 'loading');
                                if (statusMessage) {
                                    statusMessage.innerHTML = message.message || 'Processing...';
                                }
                                if (message.progress && progressBar && progressText) {
                                    progressBar.style.setProperty('--progress-width', message.progress);
                                    progressText.textContent = message.progress;
                                }
                                break;
                            case 'success':
                                setButtonState(button, 'success', 'Success!');
                                
                                // Update the status message with success message
                                if (statusMessage) {
                                    statusMessage.innerHTML = message.message.replace('Check specification files for details.', 'Review specification files for details.');
                                }
                                
                                // Reset the progress bar to 0%
                                if (progressBar && progressText) {
                                    progressBar.style.setProperty('--progress-width', '0%');
                                    progressText.textContent = '0%';
                                }
                                
                                // Reset the form for next use but keep it visible
                                setTimeout(() => {
                                    setButtonState(button, 'default');
                                }, 2000);
                                break;
                            case 'error':
                                setButtonState(button, 'error');
                                if (statusMessage) {
                                    statusMessage.innerHTML = message.message || 'Operation failed';
                                }
                                break;
                        }
                    } else if (message.command === 'updateIdePreference') {
                        const radio = document.querySelector(\`input[name="ide"][value="\${message.ide}"]\`);
                        if (radio) {
                            radio.checked = true;
                        }
                    } else if (message.command === 'updateMetrics') {
                        console.log('[Hanzo Webview] Received metrics update:', JSON.stringify(message.metrics));
                        const metrics = message.metrics;
                        const forceShow = message.forceShow === true;
                        
                        console.log('[Hanzo Webview] Force show metrics container:', forceShow);
                        
                        // Check if metrics is defined and has the expected properties
                        if (!metrics) {
                            console.error('[Hanzo Webview] Metrics is undefined in updateMetrics message');
                            return;
                        }
                        
                        // Find all the elements
                        const filesAnalyzedElement = document.getElementById('filesAnalyzed');
                        const totalAnalysesElement = document.getElementById('totalAnalyses');
                        const aiContextScoreElement = document.getElementById('aiContextScore');
                        const metricsContainer = document.getElementById('metricsContainer');
                        const metricsStatus = document.getElementById('metricsStatus');
                        
                        // Debug element existence
                        console.log('[Hanzo Webview] Elements found:', {
                            filesAnalyzedElement: !!filesAnalyzedElement,
                            totalAnalysesElement: !!totalAnalysesElement,
                            aiContextScoreElement: !!aiContextScoreElement,
                            metricsContainer: !!metricsContainer,
                            metricsStatus: !!metricsStatus
                        });
                        
                        console.log('[Hanzo Webview] Metric values to display: filesAnalyzed=' + 
                            metrics.filesAnalyzed + ', totalAnalyses=' + 
                            metrics.totalAnalyses + ', aiContextScore=' + 
                            metrics.aiContextScore);
                        
                        // Update element contents with null checks
                        if (filesAnalyzedElement) {
                            filesAnalyzedElement.textContent = metrics.filesAnalyzed.toString();
                            console.log('[Hanzo Webview] Updated filesAnalyzed to: ' + metrics.filesAnalyzed);
                        }
                        
                        if (totalAnalysesElement) {
                            totalAnalysesElement.textContent = metrics.totalAnalyses.toString();
                            console.log('[Hanzo Webview] Updated totalAnalyses to: ' + metrics.totalAnalyses);
                        }
                        
                        if (aiContextScoreElement) {
                            aiContextScoreElement.textContent = metrics.aiContextScore + '%';
                            console.log('[Hanzo Webview] Updated aiContextScore to: ' + metrics.aiContextScore + '%');
                        }
                        
                        if (metricsStatus) {
                            metricsStatus.textContent = 'ANALYSIS DONE';
                        }
                        
                        // Always show the metrics container if we have files or forceShow is true
                        if ((metrics.filesAnalyzed > 0 || forceShow) && metricsContainer) {
                            console.log('[Hanzo Webview] Showing metrics container');
                            
                            // Use the dedicated function to show metrics
                            showMetricsContainer();
                        } else if (metricsContainer) {
                            console.log('[Hanzo Webview] No files analyzed yet, keeping metrics container hidden');
                        } else {
                            console.log('[Hanzo Webview] Could not find metrics container element');
                        }
                    }
                });
            </script>
        </body>
    </html>`;
}
// Optional deactivate function
function deactivate() { }
// Add this function before the activate function
async function showWelcomeView(context) {
    // Mark that we've shown the welcome view
    await context.globalState.update('hasShownWelcomeView', true);
    // Create and show a welcome webview panel
    const panel = vscode.window.createWebviewPanel('hanzoWelcome', 'Welcome to Hanzo', vscode.ViewColumn.One, {
        enableScripts: true
    });
    // Set HTML content
    panel.webview.html = getWelcomeViewContent();
    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'openProjectManager') {
            vscode.commands.executeCommand('hanzo.openManager');
            panel.dispose();
        }
    });
    // Auto-close after 3 minutes if user doesn't interact
    setTimeout(() => {
        try {
            panel.dispose();
        }
        catch (e) {
            // Panel might already be disposed
        }
    }, 3 * 60 * 1000);
}
// Add this function to generate welcome view content
function getWelcomeViewContent() {
    const uiText = (0, textContent_1.getUIText)();
    return `<!DOCTYPE html>
    <html>
        <head>
            <style>
                body {
                    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif);
                    padding: 40px;
                    color: var(--vscode-foreground);
                    text-align: center;
                }
                h1 {
                    color: var(--vscode-terminal-ansiGreen);
                    font-size: 36px;
                    margin-bottom: 30px;
                }
                .welcome-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    max-width: 800px;
                    margin: 0 auto;
                }
                .benefits-section {
                    margin: 40px 0;
                }
                .benefits-title {
                    font-size: 24px;
                    font-weight: bold;
                    margin-bottom: 20px;
                    color: var(--vscode-editor-foreground);
                }
                .benefits-description {
                    font-size: 18px;
                    line-height: 1.6;
                    margin-bottom: 30px;
                    color: var(--vscode-descriptionForeground);
                }
                .benefits-list {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                    margin-bottom: 40px;
                }
                .benefit {
                    font-size: 20px;
                    line-height: 1.5;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .benefit::before {
                    content: "✓";
                    color: var(--vscode-terminal-ansiGreen);
                    margin-right: 15px;
                    font-weight: bold;
                    font-size: 24px;
                }
                .cta-button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 15px 30px;
                    font-size: 18px;
                    cursor: pointer;
                    border-radius: 6px;
                    margin-top: 20px;
                    font-weight: bold;
                }
                .cta-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="welcome-container">
                <h1>${uiText.welcomeView.title}</h1>
                
                <div class="benefits-section">
                    <div class="benefits-title">${uiText.welcomeView.benefitsTitle}</div>
                    <div class="benefits-description">${uiText.welcomeView.benefitsDescription}</div>
                    
                    <div class="benefits-list">
                        ${uiText.welcomeView.benefits.map((benefit) => `<div class="benefit">${benefit}</div>`).join('')}
                    </div>
                    
                    <button class="cta-button" onclick="openProjectManager()">${uiText.welcomeView.ctaButton}</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function openProjectManager() {
                    vscode.postMessage({
                        command: 'openProjectManager'
                    });
                }
            </script>
        </body>
    </html>`;
}
//# sourceMappingURL=extension.js.map