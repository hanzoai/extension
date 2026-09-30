import { API_URL } from '../auth/iam';

/**
 * Chat completions from api.hanzo.ai, the OpenAI-compatible gateway every
 * model is reached through. Nothing here imports vscode, so it runs under
 * plain node in tests.
 */

/** The id catalog.hanzo.ai marks "Zen5 (Default)"; GET /v1/models lists it. */
export const MODEL = 'zen5';

const SIGN_IN = 'Sign in to Hanzo AI (command "Hanzo: Login") or set HANZO_API_KEY.';

/** A tool call as /v1/chat/completions carries it, its arguments a JSON string. */
export interface Call {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: Call[];
    tool_call_id?: string;
}

export interface Options {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

/** Sends messages to POST /v1/chat/completions and returns the reply's text. */
export async function complete(token: string | undefined, messages: Message[], opts: Options = {}, api = API_URL): Promise<string> {
    if (!token) {
        throw new Error(SIGN_IN);
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

/** Where stream delivers a reply: text as it arrives, each tool call once its arguments are whole. */
export interface Sink {
    text(value: string): void;
    call(id: string, name: string, input: object): void;
}

/**
 * Sends body to POST /v1/chat/completions with stream set and reads the
 * server-sent events back into sink.
 */
export async function stream(token: string | undefined, body: object, sink: Sink, signal?: AbortSignal, api = API_URL): Promise<void> {
    if (!token) {
        throw new Error(SIGN_IN);
    }
    const resp = await fetch(`${api}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ ...body, stream: true }),
        signal,
    });
    if (!resp.ok || !resp.body) {
        throw new Error(`api.hanzo.ai answered ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }

    // A call's id and name come in its first delta and its arguments in pieces, keyed by index.
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const read = (line: string) => {
        if (!line.startsWith('data:')) {
            return;
        }
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
            return;
        }
        const event = JSON.parse(data);
        if (event.error) {
            throw new Error(`api.hanzo.ai: ${event.error.message ?? JSON.stringify(event.error)}`);
        }
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) {
            sink.text(delta.content);
        }
        for (const piece of delta?.tool_calls ?? []) {
            const index = piece.index ?? 0;
            const call = calls.get(index) ?? { id: `call_${index}`, name: '', args: '' };
            call.id = piece.id || call.id;
            call.name ||= piece.function?.name ?? '';
            call.args += piece.function?.arguments ?? '';
            calls.set(index, call);
        }
    };

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = done ? '' : lines.pop();
        lines.forEach(line => read(line.trim()));
        if (done) {
            break;
        }
    }

    for (const { id, name, args } of calls.values()) {
        let input: object;
        try {
            input = args ? JSON.parse(args) : {};
        } catch {
            throw new Error(`api.hanzo.ai called ${name} with arguments that are not JSON: ${args.slice(0, 200)}`);
        }
        sink.call(id, name, input);
    }
}
