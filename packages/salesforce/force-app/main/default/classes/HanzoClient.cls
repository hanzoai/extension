/**
 * HanzoClient — the Hanzo API client for the Salesforce package.
 *
 * Mirrors packages/gworkspace/src/hanzo.gs and packages/office/src/{config,chat}.ts,
 * adapted to Apex: requests go through Http/HttpRequest (no fetch/SSE, so one
 * non-streaming completion per call) and the api.hanzo.ai/v1 gateway. The API key
 * lives in a Named Credential (callout:Hanzo_API) so the secret never touches Apex
 * source, debug logs, or metadata — Salesforce injects the Authorization header.
 *
 * The pure methods (buildMessages / requestBody / extractContent / parseModels /
 * the URL builders) have no platform dependency and are the tested core — the same
 * wire format as every other Hanzo integration, so the contract is identical.
 *
 * api.hanzo.ai/v1 only; never an /api/ prefix, never v2.
 */
public with sharing class HanzoClient {
    /**
     * Named Credential endpoint. `callout:Hanzo_API` resolves to the Named
     * Credential's URL (https://api.hanzo.ai) and injects the Bearer token from
     * the linked External Credential — the key is never in Apex.
     */
    public static final String CALLOUT_BASE = 'callout:Hanzo_API';

    /** Default model. Overridable per-request; the gateway routes it. */
    public static final String DEFAULT_MODEL = 'zen5';

    /** Request timeout in milliseconds (Salesforce max is 120000). */
    private static final Integer TIMEOUT_MS = 120000;

    /**
     * A single OpenAI-compatible chat message. Serialized as {"role","content"}.
     */
    public class Message {
        public String role;
        public String content;
        public Message(String role, String content) {
            this.role = role;
            this.content = content;
        }
    }

    /**
     * Options for a completion. model defaults to DEFAULT_MODEL; temperature is
     * only sent when set (null = omit, matching the gateway's default).
     */
    public class Options {
        public String model;
        public Decimal temperature;
        public Options() {}
        public Options(String model) {
            this.model = model;
        }
    }

    /** A model entry from /v1/models. */
    public class ModelInfo {
        @AuraEnabled public String id;
        @AuraEnabled public String ownedBy;
        public ModelInfo(String id, String ownedBy) {
            this.id = id;
            this.ownedBy = ownedBy;
        }
    }

    // ── URL builders — api.hanzo.ai/v1 only ────────────────────────────────

    public static String chatCompletionsUrl() {
        return CALLOUT_BASE + '/v1/chat/completions';
    }

    public static String modelsUrl() {
        return CALLOUT_BASE + '/v1/models';
    }

    // ── Pure request/response shaping (tested core) ────────────────────────

    /**
     * buildMessages turns a task (the user's instruction) plus a context block
     * (the assembled record data) into the OpenAI-compatible message list. Empty
     * context = a plain instruction; non-empty = an operation over the record,
     * fenced so the model treats it as data, not instructions.
     */
    public static List<Message> buildMessages(String task, String context) {
        String system =
            'You are Hanzo AI inside Salesforce, working over a CRM record. ' +
            'Be concise, accurate, and grounded ONLY in the record context provided. ' +
            'Do not invent field values, contacts, or amounts. When you have no basis ' +
            'for an answer, say so. Return plain text suitable for a sales rep — no ' +
            'markdown fences, no preamble like "Here is".';
        List<Message> messages = new List<Message>();
        messages.add(new Message('system', system));
        String trimmed = context == null ? '' : context.trim();
        String userContent = String.isBlank(trimmed)
            ? task
            : task + '\n\n---- record context ----\n' + context;
        messages.add(new Message('user', userContent));
        return messages;
    }

    /**
     * requestBody is the exact JSON the gateway receives. stream is always false —
     * Apex has no streaming reader, so every call is one-shot. Returned as an
     * ordered Map so serialization is deterministic and assertable in tests.
     */
    public static Map<String, Object> requestBody(List<Message> messages, Options opts) {
        Options o = opts == null ? new Options() : opts;
        Map<String, Object> body = new Map<String, Object>();
        body.put('model', String.isBlank(o.model) ? DEFAULT_MODEL : o.model);
        body.put('messages', messages);
        body.put('stream', false);
        if (o.temperature != null) {
            body.put('temperature', o.temperature);
        }
        return body;
    }

    /**
     * extractContent pulls the assistant text out of an OpenAI-compatible response,
     * tolerating the shapes the gateway returns (choices[0].message.content,
     * choices[0].text, or a bare content). Throws on an error payload so the LWC
     * surfaces the real gateway message.
     */
    @SuppressWarnings('PMD.CyclomaticComplexity')
    public static String extractContent(Map<String, Object> data) {
        if (data == null) {
            throw new HanzoException('Hanzo API returned no content');
        }
        if (data.get('error') != null) {
            throw new HanzoException('Hanzo API error: ' + errorMessage(data.get('error')));
        }
        Object choicesObj = data.get('choices');
        String content = null;
        if (choicesObj instanceof List<Object> && !((List<Object>) choicesObj).isEmpty()) {
            Object first = ((List<Object>) choicesObj)[0];
            if (first instanceof Map<String, Object>) {
                Map<String, Object> choice = (Map<String, Object>) first;
                Object messageObj = choice.get('message');
                if (messageObj instanceof Map<String, Object>) {
                    Object c = ((Map<String, Object>) messageObj).get('content');
                    if (c instanceof String) {
                        content = (String) c;
                    }
                }
                if (String.isBlank(content) && choice.get('text') instanceof String) {
                    content = (String) choice.get('text');
                }
            }
        }
        if (String.isBlank(content) && data.get('content') instanceof String) {
            content = (String) data.get('content');
        }
        if (String.isBlank(content)) {
            throw new HanzoException('Hanzo API returned no content');
        }
        return content;
    }

    /**
     * parseModels pulls the routable model ids out of a /v1/models response,
     * tolerating {data:[...]}, {models:[...]}, a bare array, and string-or-object
     * entries. Pure — the network read is in listModels.
     */
    public static List<ModelInfo> parseModels(Object data) {
        List<Object> items = new List<Object>();
        if (data instanceof Map<String, Object>) {
            Map<String, Object> m = (Map<String, Object>) data;
            if (m.get('data') instanceof List<Object>) {
                items = (List<Object>) m.get('data');
            } else if (m.get('models') instanceof List<Object>) {
                items = (List<Object>) m.get('models');
            }
        } else if (data instanceof List<Object>) {
            items = (List<Object>) data;
        }
        List<ModelInfo> out = new List<ModelInfo>();
        for (Object item : items) {
            if (item instanceof String) {
                String s = (String) item;
                if (!String.isBlank(s)) {
                    out.add(new ModelInfo(s, null));
                }
            } else if (item instanceof Map<String, Object>) {
                Map<String, Object> mo = (Map<String, Object>) item;
                Object id = mo.get('id');
                if (id instanceof String && !String.isBlank((String) id)) {
                    String ownedBy = mo.get('owned_by') instanceof String
                        ? (String) mo.get('owned_by')
                        : null;
                    out.add(new ModelInfo((String) id, ownedBy));
                }
            }
        }
        return out;
    }

    /** Normalize a gateway `error` field (string or {message}) into a message. */
    private static String errorMessage(Object err) {
        if (err instanceof String) {
            return (String) err;
        }
        if (err instanceof Map<String, Object>) {
            Object msg = ((Map<String, Object>) err).get('message');
            if (msg instanceof String) {
                return (String) msg;
            }
        }
        return 'unknown error';
    }

    // ── Callouts (Named Credential injects the Bearer token) ───────────────

    /**
     * ask runs one non-streaming completion and returns the assistant text.
     * The Named Credential supplies the Authorization header — no key handling here.
     */
    public static String ask(String task, String context, Options opts) {
        Map<String, Object> body = requestBody(buildMessages(task, context), opts);
        HttpRequest req = new HttpRequest();
        req.setEndpoint(chatCompletionsUrl());
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(TIMEOUT_MS);
        req.setBody(JSON.serialize(body));

        HttpResponse resp = new Http().send(req);
        Integer code = resp.getStatusCode();
        Map<String, Object> parsed = safeParse(resp.getBody());
        if (parsed == null) {
            throw new HanzoException('Hanzo API ' + code + ': ' + snippet(resp.getBody()));
        }
        if (code < 200 || code >= 300) {
            // Prefer the gateway's structured error message when present.
            if (parsed.get('error') != null) {
                throw new HanzoException(
                    'Hanzo API ' + code + ': ' + errorMessage(parsed.get('error'))
                );
            }
            throw new HanzoException('Hanzo API ' + code + ': ' + snippet(resp.getBody()));
        }
        return extractContent(parsed);
    }

    /**
     * listModels returns the routable model ids from /v1/models. Org-scoped by the
     * bearer the Named Credential injects. Non-fatal for callers — returns [] on any
     * failure so the picker falls back to the default model.
     */
    public static List<ModelInfo> listModels() {
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint(modelsUrl());
            req.setMethod('GET');
            req.setTimeout(TIMEOUT_MS);
            HttpResponse resp = new Http().send(req);
            if (resp.getStatusCode() != 200) {
                return new List<ModelInfo>();
            }
            return parseModels(JSON.deserializeUntyped(resp.getBody()));
        } catch (Exception e) {
            return new List<ModelInfo>();
        }
    }

    /** Parse a JSON object body, returning null on any parse failure. */
    private static Map<String, Object> safeParse(String body) {
        if (String.isBlank(body)) {
            return null;
        }
        try {
            Object o = JSON.deserializeUntyped(body);
            return o instanceof Map<String, Object> ? (Map<String, Object>) o : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** First 200 chars of a body, for error surfacing. */
    private static String snippet(String body) {
        if (body == null) {
            return '';
        }
        return body.length() > 200 ? body.substring(0, 200) : body;
    }

    /** Thrown for any gateway or transport failure the caller should surface. */
    public class HanzoException extends Exception {}
}
