import { API_URL } from '../auth/iam';

/**
 * Chat completions from api.hanzo.ai, the OpenAI-compatible gateway every
 * model is reached through. Nothing here imports vscode, so it runs under
 * plain node in tests.
 */

/** The id catalog.hanzo.ai marks "Zen5 (Default)"; GET /v1/models lists it. */
export const MODEL = 'zen5';

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface Options {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

/** Sends messages to POST /v1/chat/completions and returns the reply's text. */
export async function complete(token: string | undefined, messages: Message[], opts: Options = {}, api = API_URL): Promise<string> {
    if (!token) {
        throw new Error('Sign in to Hanzo AI (command "Hanzo: Login") or set HANZO_API_KEY.');
    }
    const body: Record<string, unknown> = { model: opts.model || MODEL, messages };
    if (opts.temperature !== undefined) {
        body.temperature = opts.temperature;
    }
    if (opts.maxTokens !== undefined) {
        body.max_tokens = opts.maxTokens;
    }
    const resp = await fetch(`${api}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
    });
    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`api.hanzo.ai answered ${resp.status}: ${text.slice(0, 200)}`);
    }
    const content = JSON.parse(text)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        throw new Error('api.hanzo.ai answered with no message');
    }
    return content;
}
