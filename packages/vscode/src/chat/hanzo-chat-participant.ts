import * as vscode from 'vscode';
import { MODEL } from '../api/chat';

const PROMPT = 'You are Hanzo, an AI agent in VS Code. Use the tools to read, change and run things in the workspace and to drive the browser, then answer briefly.';

/**
 * @hanzo: a Hanzo model with every MCP tool VS Code has, hanzo-mcp's among
 * them. It runs on the model picked in the chat view when that is a Hanzo
 * model, else on hanzo.llm.hanzo.model, and invokes each tool the model calls
 * until the model answers without one.
 */
export function participant(context: vscode.ExtensionContext): vscode.ChatParticipant {
    const chat = vscode.chat.createChatParticipant('hanzo', handle);
    chat.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
    return chat;
}

export async function handle(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    const model = await pick(request.model);
    const tools = vscode.lm.tools
        .filter(tool => tool.tags.includes('mcp'))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    const messages = [
        vscode.LanguageModelChatMessage.User(PROMPT),
        ...context.history.map(turn => turn instanceof vscode.ChatRequestTurn
            ? vscode.LanguageModelChatMessage.User(turn.prompt)
            : vscode.LanguageModelChatMessage.Assistant(turn.response.map(part => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : '')).join(''))),
        vscode.LanguageModelChatMessage.User(request.prompt),
    ];

    for (;;) {
        const response = await model.sendRequest(messages, { tools }, token);
        const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
        for await (const part of response.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                stream.markdown(part.value);
                parts.push(part);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                parts.push(part);
            }
        }
        const calls = parts.filter(part => part instanceof vscode.LanguageModelToolCallPart);
        if (calls.length === 0) {
            return;
        }
        messages.push(vscode.LanguageModelChatMessage.Assistant(parts));

        const results: vscode.LanguageModelToolResultPart[] = [];
        for (const call of calls) {
            try {
                const result = await vscode.lm.invokeTool(call.name, { input: call.input, toolInvocationToken: request.toolInvocationToken }, token);
                results.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
            } catch (error) {
                if (token.isCancellationRequested) {
                    throw error;
                }
                // The model reads a failed or declined call and chooses what to do next.
                const message = error instanceof Error ? error.message : String(error);
                results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(`${call.name} failed: ${message}`)]));
            }
        }
        messages.push(vscode.LanguageModelChatMessage.User(results));
    }
}

async function pick(chosen: vscode.LanguageModelChat): Promise<vscode.LanguageModelChat> {
    if (chosen.vendor === 'hanzo') {
        return chosen;
    }
    const id = vscode.workspace.getConfiguration('hanzo').get<string>('llm.hanzo.model', MODEL);
    const [model] = await vscode.lm.selectChatModels({ vendor: 'hanzo', id });
    if (!model) {
        throw new Error(`api.hanzo.ai lists no model ${id}. Set hanzo.llm.hanzo.model to an id GET https://api.hanzo.ai/v1/models lists.`);
    }
    return model;
}
