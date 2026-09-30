import * as vscode from 'vscode';

/**
 * Hanzo's MCP server, hanzo-mcp, for every agent in VS Code: Copilot's agent
 * mode, @hanzo, and any extension that reads vscode.lm.tools. Its browser and
 * cdp tools drive the person's own signed-in browser through the Hanzo browser
 * extension, which joins the ZAP router hanzo-mcp embeds. hanzo-mcp keeps its
 * own Hanzo IAM session, so nothing here hands it a credential.
 */
export const servers: vscode.McpServerDefinitionProvider = {
    provideMcpServerDefinitions() {
        const server = new vscode.McpStdioServerDefinition('Hanzo', 'hanzo-mcp', ['--transport', 'stdio']);
        server.cwd = vscode.workspace.workspaceFolders?.[0]?.uri;
        return [server];
    },
};
