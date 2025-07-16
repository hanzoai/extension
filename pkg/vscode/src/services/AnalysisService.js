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
exports.AnalysisService = void 0;
const vscode = __importStar(require("vscode"));
const extension_1 = require("../extension");
const StatusBarService_1 = require("./StatusBarService");
class AnalysisService {
    context;
    static instance;
    statusBar;
    projectManager;
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
        if (!this.projectManager) {
            this.projectManager = new extension_1.ProjectManager(undefined, this.context);
        }
        return this.projectManager;
    }
    setProjectManager(manager) {
        this.projectManager = manager;
    }
    async analyze(details) {
        try {
            const manager = this.ensureProjectManager();
            await manager.handleProjectOperation(details);
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