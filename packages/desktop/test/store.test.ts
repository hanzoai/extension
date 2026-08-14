import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  mergeSettings,
  serializeSettings,
  type Settings,
} from "../src/store";

const KEY = "sk-" + "a".repeat(20);
const KEY2 = "sk-" + "b".repeat(20);

describe("parseSettings", () => {
  it("returns defaults for null / empty", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for invalid JSON", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for a non-object payload", () => {
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"a string"')).toEqual(DEFAULT_SETTINGS);
  });

  it("reads a valid stored key + model", () => {
    const raw = JSON.stringify({ apiKey: KEY, model: "zen5-coder" });
    expect(parseSettings(raw)).toEqual({ apiKey: KEY, model: "zen5-coder" });
  });

  it("drops a stored key that no longer matches the sk- shape", () => {
    const raw = JSON.stringify({ apiKey: "hk-" + "a".repeat(20), model: "zen5" });
    expect(parseSettings(raw)).toEqual({ apiKey: "", model: "zen5" });
  });

  it("trims the stored key and falls back to the default model when missing/blank", () => {
    const raw = JSON.stringify({ apiKey: `  ${KEY}  `, model: "  " });
    expect(parseSettings(raw)).toEqual({ apiKey: KEY, model: DEFAULT_SETTINGS.model });
  });

  it("fills defaults for wrong-typed fields", () => {
    const raw = JSON.stringify({ apiKey: 123, model: [] });
    expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("mergeSettings", () => {
  const base: Settings = { apiKey: "", model: "zen5" };

  it("accepts a valid key patch", () => {
    const { settings, error } = mergeSettings(base, { apiKey: KEY });
    expect(error).toBeUndefined();
    expect(settings.apiKey).toBe(KEY);
  });

  it("trims the key before validating and storing", () => {
    const { settings } = mergeSettings(base, { apiKey: `  ${KEY2}  ` });
    expect(settings.apiKey).toBe(KEY2);
  });

  it("clears the key on an empty patch (explicit removal)", () => {
    const withKey: Settings = { apiKey: KEY, model: "zen5" };
    const { settings, error } = mergeSettings(withKey, { apiKey: "  " });
    expect(error).toBeUndefined();
    expect(settings.apiKey).toBe("");
  });

  it("rejects a malformed key WITHOUT mutating current settings", () => {
    const { settings, error } = mergeSettings(base, { apiKey: "hk-" + "a".repeat(20) });
    expect(error).toMatch(/Not a Hanzo key/);
    expect(settings).toBe(base); // returns the untouched original
  });

  it("normalizes a blank model back to the default", () => {
    const { settings } = mergeSettings(base, { model: "   " });
    expect(settings.model).toBe(DEFAULT_SETTINGS.model);
  });

  it("applies a model patch and leaves the key untouched", () => {
    const withKey: Settings = { apiKey: KEY, model: "zen5" };
    const { settings } = mergeSettings(withKey, { model: "zen5-mini" });
    expect(settings).toEqual({ apiKey: KEY, model: "zen5-mini" });
  });

  it("applies key + model together", () => {
    const { settings, error } = mergeSettings(base, { apiKey: KEY, model: "zen5-coder" });
    expect(error).toBeUndefined();
    expect(settings).toEqual({ apiKey: KEY, model: "zen5-coder" });
  });
});

describe("serializeSettings <-> parseSettings round-trip", () => {
  it("round-trips a valid settings object", () => {
    const s: Settings = { apiKey: KEY, model: "zen5-coder" };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });
});
