// The frontend controller: wires the pure modules (actions.ts prompts/parse,
// store.ts settings) and the I/O boundaries (hanzo.ts @hanzo/ai, clipboard.ts
// Tauri) to the assistant panel DOM. It owns only glue: render the model picker
// and the action row from the catalog, run the ask/quick-action flows, stream the
// reply into the output, and toggle the settings pane. No prompt string, no
// request shape, no parsing lives here — those are in the tested pure modules.

import { listen } from "@tauri-apps/api/event";
import {
  actionList,
  buildActionMessages,
  parseResult,
  isActionId,
  ACTIONS,
  type ActionId,
} from "./actions.js";
import { streamChat, listModels } from "./hanzo.js";
import { captureSubject, copyResult, pasteBack } from "./clipboard.js";
import { loadSettings, saveSettings, mergeSettings, type Settings } from "./store.js";
import { isHanzoKey } from "./config.js";

// $ is the single typed DOM lookup — throws on a missing id (a build/markup bug,
// surfaced loudly) so the rest of the controller can trust the element exists.
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const el = {
  model: $<HTMLSelectElement>("model"),
  promptForm: $<HTMLFormElement>("prompt-form"),
  prompt: $<HTMLTextAreaElement>("prompt"),
  send: $<HTMLButtonElement>("send"),
  actions: $<HTMLElement>("actions"),
  outputWrap: $<HTMLElement>("output-wrap"),
  output: $<HTMLElement>("output"),
  status: $<HTMLElement>("status"),
  copy: $<HTMLButtonElement>("copy"),
  settings: $<HTMLElement>("settings"),
  settingsToggle: $<HTMLButtonElement>("settings-toggle"),
  apikey: $<HTMLInputElement>("apikey"),
  saveSettings: $<HTMLButtonElement>("save-settings"),
  settingsStatus: $<HTMLElement>("settings-status"),
};

// Session state: the persisted settings and the in-flight request's aborter (so a
// new send / action cancels the previous stream). Kept minimal — the app is a
// stateless funnel from an action to a streamed reply.
let settings: Settings = loadSettings();
let inflight: AbortController | null = null;

// ---- Rendering ------------------------------------------------------------

// renderModelOption ensures the settings model is selectable even before the
// gateway list loads, so the picker is never empty.
function renderModelOptions(ids: string[]): void {
  const seen = new Set(ids);
  if (settings.model && !seen.has(settings.model)) ids = [settings.model, ...ids];
  el.model.innerHTML = "";
  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    if (id === settings.model) opt.selected = true;
    el.model.appendChild(opt);
  }
}

// renderActions builds the quick-action chips from the catalog (minus `ask`, which
// is the prompt box's send button). Clicking a chip runs that action over the
// clipboard.
function renderActions(): void {
  el.actions.innerHTML = "";
  for (const a of actionList()) {
    if (a.id === "ask") continue;
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = a.label;
    chip.addEventListener("click", () => runAction(a.id));
    el.actions.appendChild(chip);
  }
}

// ---- Status helpers -------------------------------------------------------

function setStatus(text: string, kind: "" | "err" | "ok" = ""): void {
  el.status.textContent = text;
  el.status.className = kind ? `status ${kind}` : "status";
}

function showOutput(): void {
  el.outputWrap.hidden = false;
  el.output.textContent = "";
  el.copy.hidden = true;
}

// busy toggles the controls while a request is in flight so the user can't fire
// two overlapping streams.
function busy(on: boolean): void {
  el.send.disabled = on;
  for (const chip of el.actions.querySelectorAll("button")) {
    (chip as HTMLButtonElement).disabled = on;
  }
}

// ---- The one run path -----------------------------------------------------
//
// Every action — the ask box and every quick-action chip — funnels through run():
// gate on a key, capture the clipboard, build the request from the catalog, stream
// the reply into the output, parse it, and offer copy/paste. One code path so the
// key gate, error handling, and streaming are identical everywhere.

async function run(
  id: ActionId,
  inputs: { instruction?: string; language?: string },
  outcome: "copy" | "paste",
): Promise<void> {
  if (!isHanzoKey(settings.apiKey)) {
    openSettings("Paste your sk- key from hanzo.id to start.");
    return;
  }

  // Cancel any in-flight stream before starting a new one.
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;

  const spec = ACTIONS[id];
  const ctx = spec.needsText ? await captureSubject() : {};
  if (spec.needsText && !ctx.text) {
    showOutput();
    setStatus("Nothing on the clipboard — copy some text first.", "err");
    return;
  }

  const messages = buildActionMessages(id, inputs, ctx);
  const model = el.model.value || settings.model;

  showOutput();
  setStatus("Thinking…");
  busy(true);
  try {
    const full = await streamChat(
      messages,
      (delta) => {
        el.output.textContent += delta;
        el.output.scrollTop = el.output.scrollHeight;
      },
      { token: settings.apiKey, model, signal: controller.signal },
    );
    const result = parseResult(full);
    el.output.textContent = result;

    if (outcome === "paste") {
      await pasteBack(result);
      setStatus("Pasted.", "ok");
    } else {
      await copyResult(result);
      setStatus("Copied to clipboard.", "ok");
      offerCopy(result);
    }
  } catch (e) {
    if (controller.signal.aborted) return; // superseded by a newer request
    setStatus(errorMessage(e), "err");
  } finally {
    if (inflight === controller) inflight = null;
    busy(false);
  }
}

// runAction runs a quick-action chip: summarize/explain/ask copy the answer;
// rewrite/translate/fix-grammar paste it back over the frontmost app. The outcome
// is derived from the action, not configured, so there is one obvious behavior.
function runAction(id: ActionId): void {
  const paste: Record<ActionId, boolean> = {
    ask: false,
    summarize: false,
    explain: false,
    rewrite: true,
    translate: true,
    fixGrammar: true,
  };
  const lang =
    id === "translate"
      ? (window.prompt("Translate to which language?", "English") ?? "").trim()
      : undefined;
  if (id === "translate" && !lang) return;
  void run(id, { language: lang }, paste[id] ? "paste" : "copy");
}

// offerCopy shows the copy button for a copy-outcome result so the user can
// re-copy after reading (the first copy already landed on the clipboard).
function offerCopy(result: string): void {
  el.copy.hidden = false;
  el.copy.onclick = () => {
    void copyResult(result);
    setStatus("Copied to clipboard.", "ok");
  };
}

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg || "Something went wrong.";
}

// ---- Settings pane --------------------------------------------------------

function openSettings(hint = ""): void {
  el.settings.hidden = false;
  el.apikey.value = settings.apiKey;
  el.settingsStatus.textContent = hint;
  el.settingsStatus.className = hint ? "status err" : "status";
  el.apikey.focus();
}

function toggleSettings(): void {
  if (el.settings.hidden) openSettings();
  else el.settings.hidden = true;
}

async function saveSettingsFromForm(): Promise<void> {
  const { settings: next, error } = mergeSettings(settings, {
    apiKey: el.apikey.value,
    model: el.model.value,
  });
  if (error) {
    el.settingsStatus.textContent = error;
    el.settingsStatus.className = "status err";
    return;
  }
  settings = next;
  saveSettings(settings);
  el.settingsStatus.textContent = "Saved.";
  el.settingsStatus.className = "status ok";
  el.settings.hidden = true;
  void refreshModels();
}

// ---- Bootstrap ------------------------------------------------------------

// refreshModels loads the gateway model list (org-scoped by the key) into the
// picker. Best-effort — a network/key failure leaves the picker on the stored
// model so the app still works.
async function refreshModels(): Promise<void> {
  renderModelOptions(settings.model ? [settings.model] : []);
  if (!isHanzoKey(settings.apiKey)) return;
  try {
    const ids = await listModels({ token: settings.apiKey });
    if (ids.length) renderModelOptions(ids);
  } catch {
    // Keep the stored model; the picker is already seeded with it.
  }
}

function wireEvents(): void {
  // Ask box: Enter sends, Shift+Enter inserts a newline.
  el.prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.promptForm.requestSubmit();
    }
  });
  el.promptForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = el.prompt.value.trim();
    if (!q) return;
    void run("ask", { instruction: q }, "copy");
  });

  el.model.addEventListener("change", () => {
    settings = { ...settings, model: el.model.value };
    saveSettings(settings);
  });

  el.settingsToggle.addEventListener("click", toggleSettings);
  el.saveSettings.addEventListener("click", () => void saveSettingsFromForm());

  // Esc hides the settings pane if open, else asks the shell to hide the window.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.settings.hidden) el.settings.hidden = true;
  });
}

// wireTauri listens for the tray/hotkey-driven action: the Rust shell emits
// `run-action` with an action id when the user picks a quick action from the tray
// menu, so the same run path serves the tray and the panel. Guarded so a bad
// payload can't crash the panel.
async function wireTauri(): Promise<void> {
  await listen<string>("run-action", (event) => {
    const id = event.payload;
    if (isActionId(id)) runAction(id);
  });
  // When the window is shown (hotkey/tray), focus the prompt for typing.
  await listen("focus-prompt", () => el.prompt.focus());
}

function boot(): void {
  renderActions();
  wireEvents();
  void refreshModels();
  void wireTauri();
  if (!isHanzoKey(settings.apiKey)) openSettings("Paste your sk- key from hanzo.id to start.");
}

boot();
