import { describe, it, expect } from "vitest";
import {
  ACTIONS,
  SYSTEM_PROMPT,
  actionList,
  actionTask,
  isActionId,
  chooseSubject,
  buildContext,
  buildMessages,
  buildActionMessages,
  parseResult,
  type ActionContext,
} from "../src/actions";

// ---- chooseSubject (capture policy) ---------------------------------------

describe("chooseSubject", () => {
  it("returns the clipboard trimmed when non-empty", () => {
    expect(chooseSubject("  hello  ")).toEqual({ text: "hello" });
  });

  it("returns an empty context for null / empty / whitespace clipboard", () => {
    expect(chooseSubject(null)).toEqual({});
    expect(chooseSubject("")).toEqual({});
    expect(chooseSubject("   \n\t ")).toEqual({});
  });
});

// ---- buildContext (truncation) --------------------------------------------

describe("buildContext", () => {
  it("passes short text through untruncated", () => {
    const r = buildContext({ text: "abc" });
    expect(r).toEqual({ text: "abc", truncated: false });
  });

  it("trims the raw text before measuring", () => {
    const r = buildContext({ text: "  padded  " });
    expect(r.text).toBe("padded");
    expect(r.truncated).toBe(false);
  });

  it("truncates to the budget and marks it", () => {
    const long = "x".repeat(100);
    const r = buildContext({ text: long }, 10);
    expect(r.text).toBe("x".repeat(10));
    expect(r.text.length).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it("does not truncate at exactly the budget", () => {
    const r = buildContext({ text: "x".repeat(10) }, 10);
    expect(r.truncated).toBe(false);
  });

  it("returns an empty render for no text", () => {
    expect(buildContext({})).toEqual({ text: "", truncated: false });
  });
});

// ---- buildMessages (prompt shaping) ---------------------------------------

describe("buildMessages", () => {
  it("emits a system + user pair with the system prompt first", () => {
    const msgs = buildMessages("do the task", { text: "SUBJECT", truncated: false });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe("user");
  });

  it("fences the clipboard text as data and puts the task last", () => {
    const msgs = buildMessages("TASK", { text: "SUBJECT", truncated: false });
    const user = msgs[1].content;
    expect(user).toContain("---- clipboard ----\nSUBJECT\n---- end clipboard ----");
    expect(user).toContain("---- task ----\nTASK");
    // fence comes before the task.
    expect(user.indexOf("clipboard")).toBeLessThan(user.indexOf("task"));
  });

  it("prepends the honest truncation note only when truncated", () => {
    const cut = buildMessages("T", { text: "S", truncated: true })[1].content;
    expect(cut).toContain("truncated to fit");
    const whole = buildMessages("T", { text: "S", truncated: false })[1].content;
    expect(whole).not.toContain("truncated to fit");
  });

  it("omits the fence entirely when there is no context", () => {
    const user = buildMessages("just ask", { text: "", truncated: false })[1].content;
    expect(user).not.toContain("clipboard");
    expect(user).toContain("---- task ----\njust ask");
  });
});

// ---- The catalog -----------------------------------------------------------

describe("action catalog", () => {
  it("has the six expected actions with ask first", () => {
    const ids = actionList().map((a) => a.id);
    expect(ids).toEqual(["ask", "summarize", "rewrite", "explain", "translate", "fixGrammar"]);
  });

  it("marks only ask as not needing text, and only ask as needing an instruction", () => {
    const byId = Object.fromEntries(actionList().map((a) => [a.id, a]));
    expect(byId.ask.needsText).toBe(false);
    expect(byId.ask.needsInstruction).toBe(true);
    for (const id of ["summarize", "rewrite", "explain", "translate", "fixGrammar"] as const) {
      expect(byId[id].needsText).toBe(true);
      expect(byId[id].needsInstruction).toBe(false);
    }
  });

  it("isActionId narrows known ids and rejects unknown ones", () => {
    expect(isActionId("summarize")).toBe(true);
    expect(isActionId("fixGrammar")).toBe(true);
    expect(isActionId("settings")).toBe(false);
    expect(isActionId("")).toBe(false);
    expect(isActionId("__proto__")).toBe(false);
  });

  it("actionList is derived from ACTIONS so labels never drift", () => {
    for (const a of actionList()) {
      expect(a.label).toBe(ACTIONS[a.id].label);
    }
  });
});

// ---- actionTask (prompt builders) -----------------------------------------

describe("actionTask", () => {
  it("throws on an unknown id", () => {
    expect(() => actionTask("nope")).toThrow(/Unknown action/);
  });

  it("summarize uses the default framing without a focus, and honors a focus", () => {
    expect(actionTask("summarize")).toContain("key points");
    expect(actionTask("summarize", { instruction: "the risks" })).toContain(
      "Focus the summary on: the risks",
    );
  });

  it("rewrite defaults to clearer/tighter and honors an explicit tweak", () => {
    expect(actionTask("rewrite")).toContain("clearer, tighter");
    expect(actionTask("rewrite", { instruction: "make it formal" })).toContain(
      "Rewrite it as follows: make it formal",
    );
  });

  it("explain defaults to a smart-newcomer audience and honors a focus", () => {
    expect(actionTask("explain")).toContain("smart reader new to this topic");
    expect(actionTask("explain", { instruction: "a lawyer" })).toContain(
      "Tailor the explanation to: a lawyer",
    );
  });

  it("translate defaults to English and honors a target language", () => {
    expect(actionTask("translate")).toContain("into English");
    expect(actionTask("translate", { language: "Japanese" })).toContain("into Japanese");
  });

  it("translate treats a blank language as English", () => {
    expect(actionTask("translate", { language: "   " })).toContain("into English");
  });

  it("fixGrammar corrects without changing meaning", () => {
    const t = actionTask("fixGrammar");
    expect(t).toContain("Correct the grammar");
    expect(t).toContain("Do NOT change its meaning");
  });

  it("ask embeds the question and the fallback instruction", () => {
    const t = actionTask("ask", { instruction: "what is quasar?" });
    expect(t).toContain('Answer this: "what is quasar?"');
    expect(t).toContain("answer from general knowledge");
  });

  it("every builder forbids inventing facts (except ask which allows general knowledge)", () => {
    for (const id of ["summarize", "rewrite"] as const) {
      expect(actionTask(id)).toContain("Do NOT add any fact not present");
    }
  });
});

// ---- buildActionMessages (end-to-end request) -----------------------------

describe("buildActionMessages", () => {
  const ctx: ActionContext = { text: "The quarter closed up 12%." };

  it("produces a system+user pair with the fenced subject and the resolved task", () => {
    const msgs = buildActionMessages("summarize", {}, ctx);
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    expect(msgs[1].content).toContain("The quarter closed up 12%.");
    expect(msgs[1].content).toContain("Summarize the clipboard text above");
  });

  it("threads the truncation budget so a long subject is cut and noted", () => {
    const msgs = buildActionMessages("summarize", {}, { text: "y".repeat(50) }, 10);
    expect(msgs[1].content).toContain("truncated to fit");
    expect(msgs[1].content).toContain("y".repeat(10));
    expect(msgs[1].content).not.toContain("y".repeat(11));
  });

  it("threads action inputs into the task", () => {
    const msgs = buildActionMessages("translate", { language: "German" }, ctx);
    expect(msgs[1].content).toContain("into German");
  });

  it("an ask with no clipboard has no fence, only the question", () => {
    const msgs = buildActionMessages("ask", { instruction: "define entropy" }, {});
    // The fence markers must be absent (the task prose may mention "clipboard").
    expect(msgs[1].content).not.toContain("---- clipboard ----");
    expect(msgs[1].content).not.toContain("---- end clipboard ----");
    expect(msgs[1].content).toContain('Answer this: "define entropy"');
  });

  it("throws on an unknown action id at the boundary", () => {
    expect(() => buildActionMessages("bogus", {}, ctx)).toThrow(/Unknown action/);
  });
});

// ---- parseResult (reply cleanup) ------------------------------------------

describe("parseResult", () => {
  it("trims surrounding whitespace", () => {
    expect(parseResult("  hello  ")).toBe("hello");
  });

  it("strips a whole-reply code fence", () => {
    expect(parseResult("```\ncode here\n```")).toBe("code here");
    expect(parseResult("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("leaves an internal fence untouched", () => {
    const md = "Here is code:\n```js\nfoo()\n```\ndone";
    expect(parseResult(md)).toBe(md);
  });

  it("strips one matched pair of surrounding straight or curly quotes", () => {
    expect(parseResult('"quoted line"')).toBe("quoted line");
    expect(parseResult("“smart quoted”")).toBe("smart quoted");
    expect(parseResult("'single'")).toBe("single");
  });

  it("does NOT strip quotes that are part of the content", () => {
    expect(parseResult('He said "hi" to me')).toBe('He said "hi" to me');
    expect(parseResult('"unterminated')).toBe('"unterminated');
  });

  it("strips a fence then wrapping quotes together", () => {
    expect(parseResult('```\n"wrapped"\n```')).toBe("wrapped");
  });

  it("is idempotent on already-clean text", () => {
    const clean = "Just a clean sentence.";
    expect(parseResult(parseResult(clean))).toBe(clean);
  });
});
