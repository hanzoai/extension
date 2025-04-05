"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebviewStyles = void 0;
const getWebviewStyles = () => `
    body {
        padding: 10px;
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family);
    }
    
    /* Button styles */
    .analyze-button {
        padding: 8px 16px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
        min-width: 150px;
        height: 32px;
        overflow: hidden;
        white-space: nowrap;
    }
    .analyze-button:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .analyze-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    
    .button-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }

    /* Tab styles */
    .tabs {
        display: flex;
        border-bottom: 1px solid var(--vscode-widget-border);
        margin-bottom: 20px;
    }
    .tab {
        padding: 8px 16px;
        cursor: pointer;
        border: none;
        background: none;
        color: var(--vscode-foreground);
        font-size: .875em;
        border-radius: 0;
    }
    .tab.active {
        color: white;
        border-bottom: 2px solid var(--vscode-focusBorder);
    }
    .tab:hover {
        color: white;
        background: none;
        border-bottom: 2px solid var(--vscode-focusBorder);
    }
    
    /* Project form styles */
    .form-container {
        max-width: 600px;
        margin: 20px auto;
        padding: 0 10px;
    }
    .form-group {
        margin-bottom: 16px;
    }
    .form-group label {
        display: block;
        margin-bottom: 8px;
        color: var(--vscode-foreground);
    }
    .form-group textarea {
        width: 100%;
        min-height: 60px;
        padding: 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        box-sizing: border-box;
        font-family: var(--vscode-font-family);
        border-radius: 4px;
        margin-bottom: 8px;
    }
    .form-group button {
        margin-bottom: 8px;
    }

    /* Animation styles */
    .fade-out {
        opacity: 0;
        transition: opacity 0.3s ease-out;
    }
    .fade-in {
        opacity: 1;
        transition: opacity 0.3s ease-in;
    }

    /* Settings styles */
    h2.settings-heading {
        font-size: 1.5em;
        margin-bottom: 1em;
        color: var(--vscode-foreground);
        font-weight: 500;
    }
    
    .radio-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 8px;
    }
    
    .radio-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        position: relative;
    }
    
    .radio-text {
        font-size: 14px;
    }
    
    input[type="radio"] {
        margin: 0;
        width: 16px;
        height: 16px;
        cursor: pointer;
        transform: translateY(3.5px);
        margin-right: 2px;
    }

    input[type="radio"]:focus {
        outline: none;
    }

    /* Loading spinner */
    .spinner {
        width: 16px;
        height: 16px;
        animation: spin 1s linear infinite;
        display: none;
    }
    .spinner.loading {
        display: inline-block;
    }
    @keyframes spin {
        100% { transform: rotate(360deg); }
    }
    .path {
        stroke: var(--vscode-button-foreground);
        stroke-linecap: round;
        animation: dash 1.5s ease-in-out infinite;
    }
    @keyframes dash {
        0% {
            stroke-dasharray: 1, 150;
            stroke-dashoffset: 0;
        }
        50% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -35;
        }
        100% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -124;
        }
    }

    /* Progress indicator */
    .progress-container {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transition: opacity 0.3s ease;
    }
    .progress-container.visible {
        opacity: 1;
    }
    .progress-bar {
        flex-grow: 1;
        height: 2px;
        background: var(--vscode-progressBar-background);
        border-radius: 2px;
        overflow: hidden;
        position: relative;
    }
    .progress-bar::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: var(--progress-width, 0%);
        background: var(--vscode-focusBorder);
        transition: width 0.3s ease;
    }
    .progress-text {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        min-width: 40px;
        text-align: right;
    }
    #statusMessage {
        margin-top: 8px;
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
    }
`;
exports.getWebviewStyles = getWebviewStyles;
//# sourceMappingURL=webview.js.map