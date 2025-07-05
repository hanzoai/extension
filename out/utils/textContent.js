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
exports.getUIText = getUIText;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Default text content used as fallback
const defaultText = {
    statusBar: {
        login: "$(person-add) Hanzo: Login",
        idle: "$(hanzo) Hanzo",
        analyzing: "$(sync~spin) Analyzing project...",
        boostActive: "$(check) Hanzo Boost: Active",
        error: "$(error) Analysis failed",
        success: "$(check) Analysis complete"
    },
    tooltips: {
        login: "Login to Hanzo to improve AI accuracy",
        idle: "Click to open Hanzo Project Manager",
        analyzing: "Hanzo is analyzing your project",
        boostActive: "Hanzo is actively improving your AI context. Click to open Hanzo Project Manager.",
        error: "Click to analyze project",
        success: "Click to analyze project"
    },
    notifications: {
        welcome: "Welcome to Hanzo! Get started by connecting to improve AI accuracy with your codebase.",
        nonLoggedInReminder: "Your AI assistant could work better with your project. Set up Hanzo to reduce hallucinations.",
        analyzeReminder: "Would you like to analyze your project to boost AI quality?"
    },
    buttons: {
        setupNow: "Set Up Now",
        setupHanzo: "Set Up Hanzo",
        analyzeNow: "Analyze Now",
        remindLater: "Remind Me Later"
    },
    welcomeView: {
        title: "Welcome to Hanzo!",
        benefitsTitle: "Supercharge Your AI Assistant",
        benefitsDescription: "Connect your account to enhance your AI coding experience with accurate, context-aware responses.",
        benefits: [
            "Eliminate hallucinations with proper project context",
            "Get more precise code suggestions tailored to your codebase",
            "Save time with AI that truly understands your project"
        ],
        ctaButton: "Set Up Hanzo Now"
    },
    loggedOutView: {
        title: "Log in to Get Started",
        description: "Please log in to connect your account and supercharge your AI coding experience.",
        benefits: [
            "Eliminate AI hallucinations with proper context",
            "Get more accurate code suggestions",
            "Save time with AI that understands your codebase"
        ],
        loginButton: "Login to Hanzo"
    }
};
let cachedText = null;
function getUIText() {
    if (cachedText) {
        return cachedText;
    }
    try {
        // Get extension directory
        const extensionPath = path.dirname(path.dirname(__dirname));
        const contentPath = path.join(extensionPath, 'out', 'content', 'uiText.json');
        if (fs.existsSync(contentPath)) {
            const textContent = fs.readFileSync(contentPath, 'utf8');
            cachedText = JSON.parse(textContent);
            console.log('[Hanzo] Loaded UI text content from file');
            return cachedText;
        }
        else {
            console.warn('[Hanzo] UI text content file not found, using default text');
            cachedText = defaultText;
            return defaultText;
        }
    }
    catch (error) {
        console.error('[Hanzo] Error loading UI text content:', error);
        cachedText = defaultText;
        return defaultText;
    }
}
//# sourceMappingURL=textContent.js.map