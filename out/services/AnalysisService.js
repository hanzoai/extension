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
exports.AnalysisService = void 0;
const vscode = __importStar(require("vscode"));
const StatusBarService_1 = require("./StatusBarService");
class AnalysisService {
    constructor(context) {
        this.context = context;
        this.statusBar = StatusBarService_1.StatusBarService.getInstance();
    }
    static getInstance(context) {
        if (!AnalysisService.instance) {
            AnalysisService.instance = new AnalysisService(context);
        }
        return AnalysisService.instance;
    }
    ensureProjectManager() {
        return this.projectManager;
    }
    setProjectManager(manager) {
        this.projectManager = manager;
    }
    async analyze(details) {
        try {
            const manager = this.ensureProjectManager();
            if (!manager) {
                throw new Error('Project manager not initialized');
            }
            // Call analyze method instead of handleProjectOperation
            await manager.analyzeProject();
        }
        catch (error) {
            console.error('[Hanzo] Analysis failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.statusBar.setError(errorMessage);
            vscode.window.showErrorMessage(`Analysis failed: ${errorMessage}`);
            throw error; // Re-throw for upstream handling if needed
        }
    }
}
exports.AnalysisService = AnalysisService;
//# sourceMappingURL=AnalysisService.js.map