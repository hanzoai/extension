import * as path from 'path';
import * as fs from 'fs';

// Define interface for the UI text content
interface UIText {
    statusBar: {
        login: string;
        idle: string;
        analyzing: string;
        boostActive: string;
        error: string;
        success: string;
    };
    tooltips: {
        login: string;
        idle: string;
        analyzing: string;
        boostActive: string;
        error: string;
        success: string;
    };
    notifications: {
        welcome: string;
        nonLoggedInReminder: string;
        analyzeReminder: string;
    };
    buttons: {
        setupNow: string;
        setupHanzo: string;
        analyzeNow: string;
        remindLater: string;
    };
    welcomeView: {
        title: string;
        benefitsTitle: string;
        benefitsDescription: string;
        benefits: string[];
        ctaButton: string;
    };
    loggedOutView: {
        title: string;
        description: string;
        benefits: string[];
        loginButton: string;
    };
}

// Default text content used as fallback
const defaultText: UIText = {
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

let cachedText: UIText | null = null;

export function getUIText(): UIText {
    if (cachedText) {
        return cachedText;
    }
    
    try {
        // Get extension directory
        const extensionPath = path.dirname(path.dirname(__dirname));
        const contentPath = path.join(extensionPath, 'out', 'content', 'uiText.json');
        
        if (fs.existsSync(contentPath)) {
            const textContent = fs.readFileSync(contentPath, 'utf8');
            cachedText = JSON.parse(textContent) as UIText;
            console.log('[Hanzo] Loaded UI text content from file');
            return cachedText;
        } else {
            console.warn('[Hanzo] UI text content file not found, using default text');
            cachedText = defaultText;
            return defaultText;
        }
    } catch (error) {
        console.error('[Hanzo] Error loading UI text content:', error);
        cachedText = defaultText;
        return defaultText;
    }
}