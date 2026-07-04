import { describe, it, expect } from "vitest";
import type { AiClient } from "@hanzo/ai";
import { runChat, streamChat, listModels } from "../src/hanzo";
import type { ChatMessage } from "../src/actions";

// A fake AiClient capturing the params passed to chat.completions.create and
// models.list. This is how we assert request shaping over @hanzo/ai without a
// network. The `create` fake honors the stream flag: stream:false returns a
// completion object; stream:true returns an async generator of chunks.
function fakeClient(opts: {
  reply?: string;
  chunks?: string[];
  models?: string[];
}): { client: AiClient; calls: { params: any; options: any }[] } {
  const { reply = "", chunks = [], models = ["zen5", "zen5-mini"] } = opts;
  const calls: { params: any; options: any }[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: any, options: any) => {
          calls.push({ params, options });
          if (params.stream) {
            return (async function* () {
              for (const c of chunks) {
                yield {
                  id: "x",
                  object: "chat.completion.chunk",
                  created: 0,
                  model: params.model,
                  choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
                };
              }
            })();
          }
          return {
            id: "x",
            object: "chat.completion",
            created: 0,
            model: params.model,
            choices: [
              { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
            ],
          };
        },
      },
    },
    models: {
      list: async () => models.map((id) => ({ id, object: "model" })),
    },
  } as unknown as AiClient;
  return { client, calls };
}

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
];

describe("runChat (non-streaming request shaping)", () => {
  it("sends model + messages, stream:false, temperature, and returns the content", async () => {
    const f = fakeClient({ reply: "Summary." });
    const out = await runChat(MESSAGES, { client: f.client, model: "zen5-mini", temperature: 0.3 });
    expect(out).toBe("Summary.");
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].params.model).toBe("zen5-mini");
    expect(f.calls[0].params.stream).toBe(false);
    expect(f.calls[0].params.temperature).toBe(0.3);
    expect(f.calls[0].params.messages).toEqual(MESSAGES);
  });

  it("defaults the model to zen5 when none is given", async () => {
    const f = fakeClient({ reply: "x" });
    await runChat(MESSAGES, { client: f.client });
    expect(f.calls[0].params.model).toBe("zen5");
  });

  it("throws when the model returns empty content", async () => {
    const f = fakeClient({ reply: "" });
    await expect(runChat(MESSAGES, { client: f.client })).rejects.toThrow(/no content/);
  });

  it("forwards the abort signal in options", async () => {
    const f = fakeClient({ reply: "x" });
    const controller = new AbortController();
    await runChat(MESSAGES, { client: f.client, signal: controller.signal });
    expect(f.calls[0].options.signal).toBe(controller.signal);
  });
});

describe("streamChat (streaming request shaping)", () => {
  it("sends stream:true, calls onDelta per chunk, and returns the full text", async () => {
    const f = fakeClient({ chunks: ["Hel", "lo ", "world"] });
    const seen: string[] = [];
    const out = await streamChat(MESSAGES, (d) => seen.push(d), { client: f.client, model: "zen5" });
    expect(f.calls[0].params.stream).toBe(true);
    expect(seen).toEqual(["Hel", "lo ", "world"]);
    expect(out).toBe("Hello world");
  });

  it("skips empty deltas but keeps the concatenation correct", async () => {
    const f = fakeClient({ chunks: ["A", "", "B"] });
    const seen: string[] = [];
    const out = await streamChat(MESSAGES, (d) => seen.push(d), { client: f.client });
    expect(seen).toEqual(["A", "B"]);
    expect(out).toBe("AB");
  });

  it("throws when the stream yields no content", async () => {
    const f = fakeClient({ chunks: [] });
    await expect(streamChat(MESSAGES, () => {}, { client: f.client })).rejects.toThrow(/no content/);
  });

  it("forwards the abort signal in options", async () => {
    const f = fakeClient({ chunks: ["x"] });
    const controller = new AbortController();
    await streamChat(MESSAGES, () => {}, { client: f.client, signal: controller.signal });
    expect(f.calls[0].options.signal).toBe(controller.signal);
  });
});

describe("listModels", () => {
  it("returns the model ids from the client", async () => {
    const f = fakeClient({ models: ["zen5", "zen5-mini", "zen5-coder"] });
    expect(await listModels({ client: f.client })).toEqual(["zen5", "zen5-mini", "zen5-coder"]);
  });
});
