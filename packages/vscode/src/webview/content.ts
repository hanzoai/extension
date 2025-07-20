import * as vscode from 'vscode';
import { getWebviewStyles } from '../styles/webview';

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, isWelcome: boolean = false): string {
    const nonce = getNonce();
    const styles = getWebviewStyles();

    if (isWelcome) {
        return getWelcomeContent(webview, extensionUri, nonce, styles);
    }

    return getManagerContent(webview, extensionUri, nonce, styles);
}

function getManagerContent(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string, styles: string): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>Hanzo Project Manager</title>
        <style>${styles}</style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>🔷 Hanzo Project Manager</h1>
                <p class="subtitle">AI-powered project analysis and context management</p>
            </header>

            <div id="auth-section" style="display: none;">
                <div class="auth-message">
                    <p>Please log in to use Hanzo AI features</p>
                    <button id="login-btn" class="primary-btn">Login with Hanzo</button>
                </div>
            </div>

            <div id="main-content">
                <div class="action-section">
                    <button id="analyze-btn" class="primary-btn">
                        <span class="btn-icon">🔍</span>
                        Analyze Project
                    </button>
                    <button id="export-btn" class="secondary-btn" disabled>
                        <span class="btn-icon">📄</span>
                        Export Specification
                    </button>
                </div>

                <div id="status-section" class="status-section" style="display: none;">
                    <div class="status-message"></div>
                    <div class="progress-container" style="display: none;">
                        <div class="progress-bar">
                            <div class="progress-fill"></div>
                        </div>
                        <span class="progress-text">0%</span>
                    </div>
                </div>

                <div id="details-section" class="details-section" style="display: none;">
                    <h2>Project Analysis</h2>
                    <div id="project-details" class="project-details"></div>
                </div>
            </div>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            
            const analyzeBtn = document.getElementById('analyze-btn');
            const exportBtn = document.getElementById('export-btn');
            const loginBtn = document.getElementById('login-btn');
            const statusSection = document.getElementById('status-section');
            const detailsSection = document.getElementById('details-section');
            const authSection = document.getElementById('auth-section');
            const mainContent = document.getElementById('main-content');

            analyzeBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'analyzeProject' });
            });

            exportBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'exportSpecification' });
            });

            loginBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'login' });
            });

            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'updateStatus':
                        updateStatus(message.status, message.message, message.progress, message.details);
                        break;
                    case 'loadProjectDetails':
                        if (message.details) {
                            updateStatus('complete', 'Previous analysis loaded', '100%', message.details);
                        }
                        break;
                }
            });

            function updateStatus(status, message, progress, details) {
                const statusMessage = document.querySelector('.status-message');
                const progressContainer = document.querySelector('.progress-container');
                const progressFill = document.querySelector('.progress-fill');
                const progressText = document.querySelector('.progress-text');
                const projectDetails = document.getElementById('project-details');
                
                if (status === 'login-required') {
                    authSection.style.display = 'block';
                    mainContent.style.display = 'none';
                    return;
                } else {
                    authSection.style.display = 'none';
                    mainContent.style.display = 'block';
                }

                if (message) {
                    statusSection.style.display = 'block';
                    statusMessage.textContent = message;
                    statusMessage.className = 'status-message ' + status;
                }

                if (progress) {
                    progressContainer.style.display = 'flex';
                    progressFill.style.width = progress;
                    progressText.textContent = progress;
                } else {
                    progressContainer.style.display = 'none';
                }

                if (status === 'complete' && details) {
                    detailsSection.style.display = 'block';
                    projectDetails.innerHTML = details;
                    exportBtn.disabled = false;
                    
                    // Add click handlers for file links
                    const fileLinks = projectDetails.querySelectorAll('.file-link');
                    fileLinks.forEach(link => {
                        link.addEventListener('click', (e) => {
                            e.preventDefault();
                            const path = link.getAttribute('data-path');
                            vscode.postMessage({ command: 'openFile', path: path });
                        });
                    });
                }

                if (status === 'error') {
                    progressContainer.style.display = 'none';
                    detailsSection.style.display = 'none';
                }
            }
        </script>
    </body>
    </html>`;
}

function getWelcomeContent(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string, styles: string): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>Welcome to Hanzo</title>
        <style>${styles}</style>
    </head>
    <body>
        <div class="container welcome-container">
            <header>
                <h1>🔷 Welcome to Hanzo AI</h1>
                <p class="subtitle">Your AI-powered development assistant</p>
            </header>

            <div class="welcome-content">
                <section class="feature-section">
                    <h2>🚀 Getting Started</h2>
                    <ol>
                        <li>Open a project in VS Code</li>
                        <li>Run <strong>Hanzo: Analyze Project</strong> from the command palette</li>
                        <li>View your project's AI-generated specification</li>
                        <li>Export to share with AI coding assistants</li>
                    </ol>
                </section>

                <section class="feature-section">
                    <h2>✨ Key Features</h2>
                    <ul>
                        <li><strong>Smart Analysis</strong> - AI-powered codebase understanding</li>
                        <li><strong>Auto Documentation</strong> - Generate comprehensive project specs</li>
                        <li><strong>Change Tracking</strong> - Monitor project evolution</li>
                        <li><strong>AI Integration</strong> - Works with Cursor, Copilot, and more</li>
                        <li><strong>MCP Support</strong> - Claude Desktop integration</li>
                    </ul>
                </section>

                <section class="feature-section">
                    <h2>🛠️ Available Commands</h2>
                    <ul>
                        <li><code>Hanzo: Open Project Manager</code> - Main interface</li>
                        <li><code>Hanzo: Analyze Project</code> - Run analysis</li>
                        <li><code>Hanzo: View Getting Started Guide</code> - This guide</li>
                    </ul>
                </section>

                <div class="action-section">
                    <button id="open-manager-btn" class="primary-btn">
                        Open Project Manager
                    </button>
                </div>
            </div>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            
            document.getElementById('open-manager-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'openManager' });
            });
        </script>
    </body>
    </html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}