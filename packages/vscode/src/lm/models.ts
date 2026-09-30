import * as vscode from 'vscode';
import { Call, Message, stream } from '../api/chat';
import { API_URL } from '../auth/iam';
import { AuthManager } from '../auth/manager';

// What the gateway assumes of a model the catalog gives no figure for: ai's
// DefaultContextLength and cloud's defaultMaxCompletionTokens.
const WINDOW = 131_072;
const OUTPUT = 32_768;

/** The fields of a GET /v1/models row read here. */
interface Row {
    id: string;
    owned_by: string;
    outputs?: string[];
    context_window?: number;
    max_output_tokens?: number;
}

/**
 * Hanzo's models in VS Code's model picker: every model GET /v1/models lists
 * as owned by Hanzo that answers in text, served from POST
 * /v1/chat/completions on api.hanzo.ai. Both carry the extension's Hanzo IAM
 * session as the bearer.
 */
export class Models implements vscode.LanguageModelChatProvider {
    readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>;

    constructor(private readonly auth: AuthManager, private readonly api = API_URL) {
        // The listing is per bearer, so signing in or out has VS Code ask again.
        this.onDidChangeLanguageModelChatInformation = auth.onDidChange;
    }

    async provideLanguageModelChatInformation(_options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
        const bearer = await this.auth.bearer();
        const resp = await fetch(`${this.api}/v1/models`, {
            headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
            signal: abort(token),
        });
        if (!resp.ok) {
            throw new Error(`api.hanzo.ai answered ${resp.status} for /v1/models`);
        }
        const { data } = await resp.json() as { data: Row[] };
        return data
            .filter(row => row.owned_by === 'hanzo' && (row.outputs ?? ['text']).includes('text'))
            .map(row => ({
                id: row.id,
                name: row.id,
                family: row.id,
                version: row.id,
                maxInputTokens: row.context_window ?? WINDOW,
                maxOutputTokens: row.max_output_tokens ?? OUTPUT,
                capabilities: { toolCalling: true },
            }));
    }

    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const body: Record<string, unknown> = { model: model.id, messages: wire(messages) };
        if (options.tools?.length) {
            body.tools = options.tools.map(tool => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: 'object', properties: {} } },
            }));
            body.tool_choice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
        }
        await stream(await this.auth.bearer(), body, {
            text: value => progress.report(new vscode.LanguageModelTextPart(value)),
            call: (id, name, input) => progress.report(new vscode.LanguageModelToolCallPart(id, name, input)),
        }, abort(token), this.api);
    }

    // Four characters to a token, the usual estimate for prose and code; the gateway meters the real count.
    async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage): Promise<number> {
        return Math.ceil((typeof text === 'string' ? text : JSON.stringify(wire([text]))).length / 4);
    }
}

/**
 * VS Code's messages as /v1/chat/completions takes them. A tool result is a
 * message of its own, placed before the rest of the user message that carried
 * it, so it follows the assistant message holding its call.
 */
export function wire(messages: readonly vscode.LanguageModelChatRequestMessage[]): Message[] {
    const out: Message[] = [];
    for (const message of messages) {
        let text = '';
        const calls: Call[] = [];
        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                text += part.value;
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                calls.push({ id: part.callId, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input) } });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                const content = part.content.map(piece => (piece instanceof vscode.LanguageModelTextPart ? piece.value : '')).join('');
                out.push({ role: 'tool', tool_call_id: part.callId, content });
            }
        }
        if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
            if (text || calls.length) {
                out.push(calls.length ? { role: 'assistant', content: text || null, tool_calls: calls } : { role: 'assistant', content: text });
            }
        } else if (text) {
            // VS Code also sends role 3, System, which the stable API does not name.
            out.push({ role: message.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'system', content: text });
        }
    }
    return out;
}

function abort(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
        controller.abort();
    }
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
}
