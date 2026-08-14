import { describe, it, expect } from "vitest";
import {
  HANZO_API_BASE_URL,
  DEFAULT_MODEL,
  STORE_KEY,
  chatCompletionsURL,
  modelsURL,
  isHanzoKey,
} from "../src/config";

describe("gateway constants", () => {
  it("points at api.hanzo.ai with no /api/ prefix", () => {
    expect(HANZO_API_BASE_URL).toBe("https://api.hanzo.ai");
    expect(chatCompletionsURL()).toBe("https://api.hanzo.ai/v1/chat/completions");
    expect(modelsURL()).toBe("https://api.hanzo.ai/v1/models");
    expect(chatCompletionsURL()).not.toContain("/api/");
  });

  it("defaults to a Zen model", () => {
    expect(DEFAULT_MODEL).toBe("zen5");
  });

  it("names the local store key", () => {
    expect(STORE_KEY).toBe("hanzo.desktop.settings");
  });
});

describe("isHanzoKey", () => {
  it("accepts a well-formed sk- key", () => {
    expect(isHanzoKey("sk-" + "a".repeat(16))).toBe(true);
    expect(isHanzoKey("sk-Abc123._-Abc123._-")).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(isHanzoKey("  sk-" + "b".repeat(20) + "  ")).toBe(true);
  });

  it("rejects the wrong prefix, too-short, or non-string", () => {
    expect(isHanzoKey("hk-" + "a".repeat(20))).toBe(false); // the retired prefix
    expect(isHanzoKey("sk-short")).toBe(false); // < 16 body chars
    expect(isHanzoKey("eyJhbGciOiJI.jwt.token")).toBe(false); // an IAM JWT
    expect(isHanzoKey("")).toBe(false);
    expect(isHanzoKey(undefined)).toBe(false);
    expect(isHanzoKey(null)).toBe(false);
  });
});
