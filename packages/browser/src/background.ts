// Background Service Worker for Browser Extension
//
// First import: webextension-polyfill. On Chrome/Edge this is a side-effect
// import that defines `globalThis.browser` as the unified Promise-returning
// WebExtension API. On Firefox/Safari `browser.*` is already native and the
// polyfill is a no-op. The shared modules (auth.ts, tab-id.ts, etc.) read
// this global so importing it once at the entrypoint is enough.
import 'webextension-polyfill';

import type { ControlSession, RagSnippet, RagQueryParams } from './shared/types.js';
import { startZap } from './shared/zap.js';
import {
  getRagConfig as getSharedRagConfig,
  normalizeRagSnippets,
  queryRagFromEndpoint,
} from './shared/rag.js';
import {
  IAM_API_URL, IAM_LOGIN_URL, IAM_API_PATH, API_BASE_URL,
  DEFAULT_MCP_PORT as CFG_MCP_PORT,
  DEFAULT_CDP_PORT as CFG_CDP_PORT,
  DEFAULT_RAG_TOP_K as CFG_RAG_TOP_K,
  MODEL_CACHE_TTL_MS as CFG_MODEL_CACHE_TTL,
  LOCAL_PROVIDER_DEFAULTS,
  loadRuntimeConfig,
} from './shared/config.js';

// Hanzo convention: /v1/<service>/<endpoint>. Never `/api/`.
const IAM_V1 = `${IAM_API_URL}${IAM_API_PATH}`;
import { BrowserControl } from './browser-control';
import { WebGPUAI } from './webgpu-ai';
import { getCDPBridge, CDPBridge } from './browser-dispatch';
import { driveMessage } from './shared/drive.js';
import { unwrapEvaluateResult } from './shared/tab-id.js';
import * as auth from './auth';
import { fetchAllUsage } from './shared/usage.js';
import { listModels, chatCompletion, ChatMessage } from './chat-client';
import { PageMonitor } from './page-monitor';
import {
  runAccessibilityAudit,
  runPerformanceAudit,
  runSEOAudit,
  runBestPracticesAudit,
  runFullAudit,
  runNextJSAudit,
  runDebuggerMode,
} from './audit-runner';
import { ollamaClient } from './ollama-client';
import {
  searchHuggingFace,
  getHuggingFaceModel,
  searchGGUF,
  searchMLX,
  getModelCard,
  getModelStats,
  getRecommendedModels,
  searchOllamaLibrary,
  downloadToOllama,
  downloadFromHuggingFace,
  formatSize,
  type HubModel,
  type DownloadProgress,
} from './model-hub';
import {
  ActionRateLimiter,
  CHAT_BUDGETS,
  InFlightRequestDeduper,
  debugLog,
  estimateTextTokens,
  loadDebugFlagFromStorage,
  makeChatRequestKey,
  pickModelForTokenBudget,
  readUsageMetrics,
  recordUsageDelta,
  trimMessagesToBudget,
} from './runtime-guard';

// Initialize browser control
const browserControl = new BrowserControl();
const webgpuAI = new WebGPUAI();
const pageMonitor = new PageMonitor();

// Initialize CDP bridge for hanzo-mcp integration
const cdpBridge: CDPBridge = getCDPBridge();

// DOM verbs (getText, type, hover, …) forward from the CDP bridge to
// BrowserControl, which runs them via chrome.scripting.executeScript. Both live
// in this one service worker, so the bridge must call BrowserControl directly —
// chrome.runtime.sendMessage never delivers to a same-worker listener.
cdpBridge.setDomDispatch((request) => browserControl.dispatchAction(request));

// Route CDP events to PageMonitor
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId) {
    pageMonitor.handleCDPEvent(source.tabId, method, params);
  }
});

// Clean up monitoring on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (pageMonitor.isMonitoring(tabId)) {
    pageMonitor.stopMonitoring(tabId);
  }
});

// Wipe logs on navigation (like browser-tools-mcp)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && pageMonitor.isMonitoring(details.tabId)) {
    pageMonitor.wipeLogs(details.tabId);
  }
});

const controlSession: ControlSession = {
  active: false,
  tabId: null,
  task: null,
  startedAt: null,
};

// Default ports (overridable via chrome.storage.local settings).
const DEFAULT_MCP_PORT = CFG_MCP_PORT;
const DEFAULT_CDP_PORT = CFG_CDP_PORT;
const DEFAULT_RAG_TOP_K = CFG_RAG_TOP_K;
const MODEL_CACHE_TTL_MS = CFG_MODEL_CACHE_TTL;

let cachedModels: { at: number; models: Array<{ id: string; name?: string; description?: string; owned_by?: string }> } = {
  at: 0,
  models: [],
};

const inFlightChatRequests = new InFlightRequestDeduper<string>();
const senderRequestGeneration = new Map<string, number>();
const controlMessageLimiter = new ActionRateLimiter();
const controlMessageSignatures = new Map<string, string>();

/** Load port configuration from storage */
async function getPortConfig(): Promise<{ mcpPort: number; cdpPort: number }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['mcpPort', 'cdpPort'], (result) => {
      resolve({
        mcpPort: result.mcpPort || DEFAULT_MCP_PORT,
        cdpPort: result.cdpPort || DEFAULT_CDP_PORT,
      });
    });
  });
}

function getRagConfig() {
  return getSharedRagConfig(chrome.storage.local);
}

function getSenderKey(sender: chrome.runtime.MessageSender): string {
  const tabPart = sender.tab?.id !== undefined ? String(sender.tab.id) : 'sidepanel';
  const urlPart = sender.url || sender.origin || 'unknown';
  return `${sender.id || 'local'}:${tabPart}:${urlPart}`;
}

function bumpSenderGeneration(key: string): number {
  const next = (senderRequestGeneration.get(key) || 0) + 1;
  senderRequestGeneration.set(key, next);
  return next;
}

function isSenderGenerationCurrent(key: string, generation: number): boolean {
  return senderRequestGeneration.get(key) === generation;
}

async function listModelsCached(token?: string): Promise<Array<{ id: string; name?: string; description?: string; owned_by?: string }>> {
  if (Date.now() - cachedModels.at < MODEL_CACHE_TTL_MS && cachedModels.models.length) {
    return cachedModels.models;
  }

  const models = await listModels(token);
  cachedModels = {
    at: Date.now(),
    models: (models || [])
      .filter((model) => model && typeof model.id === 'string')
      .map((model) => ({
        id: String(model.id),
        name: model.name ? String(model.name) : undefined,
        description: model.description ? String(model.description) : undefined,
        owned_by: model.owned_by ? String(model.owned_by) : undefined,
      })),
  };
  return cachedModels.models;
}

function getCachedModelIds(): string[] {
  return cachedModels.models
    .map((model) => String(model?.id || '').trim())
    .filter((id) => !!id);
}

// Browser identity for ZAP handshake
const BROWSER_NAME = (typeof navigator !== 'undefined'
  ? (navigator.userAgent.includes('Edg/') ? 'edge' : navigator.userAgent.includes('Chrome') ? 'chrome' : navigator.userAgent.includes('Safari') ? 'safari' : 'unknown')
  : 'unknown');
const VERSION = chrome.runtime.getManifest().version;

function detectBrowser(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Chrome')) return 'chrome';
  if (ua.includes('Safari')) return 'safari';
  return 'unknown';
}

function sendControlMessageToTab(tabId: number, message: Record<string, unknown>): void {
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      // Content script may not be injected on privileged pages.
    }
  });
}

function sendMessageToTab(tabId: number, message: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Failed to contact page content script'));
        return;
      }
      resolve(response);
    });
  });
}

function getActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id ?? null);
    });
  });
}

async function resolveControlTabId(tabId?: number): Promise<number | null> {
  if (typeof tabId === 'number') return tabId;
  if (controlSession.active && controlSession.tabId !== null) return controlSession.tabId;
  return getActiveTabId();
}

async function startControlSession(tabId: number, task?: string): Promise<void> {
  if (controlSession.active && controlSession.tabId !== null && controlSession.tabId !== tabId) {
    sendControlMessageToTab(controlSession.tabId, { action: 'ai.control.stop' });
  }

  controlSession.active = true;
  controlSession.tabId = tabId;
  controlSession.task = task || 'AI is controlling this page';
  controlSession.startedAt = Date.now();

  sendControlMessageToTab(tabId, {
    action: 'ai.control.start',
    task: controlSession.task,
  });
}

async function stopControlSession(): Promise<void> {
  if (controlSession.active && controlSession.tabId !== null) {
    sendControlMessageToTab(controlSession.tabId, { action: 'ai.control.stop' });
  }
  controlSession.active = false;
  controlSession.tabId = null;
  controlSession.task = null;
  controlSession.startedAt = null;
}

// =============================================================================
// Extension Lifecycle
// =============================================================================

void loadDebugFlagFromStorage();

// Initialize WebGPU, Ollama, and CDP on install
chrome.runtime.onInstalled.addListener(async (details) => {
  debugLog('[Hanzo] Extension installed, initializing...');

  // First install → open the consent onboarding once (insights + opt-in training).
  if (details?.reason === 'install') {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    } catch {
      /* non-fatal — settings still reachable from the popup */
    }
  }

  // WebGPU init
  const gpuAvailable = await webgpuAI.initialize();
  if (gpuAvailable) {
    debugLog('[Hanzo] WebGPU available');
    try {
      // Model source resolution order (first hit wins):
      //   1. chrome.storage.local.hanzo_model_url  — explicit override
      //   2. chrome.storage.local.hanzo_model_hf   — { repo, file, revision? }
      //   3. The hanzo-browser-control HF default — cached after first load
      //   4. The bundled-with-extension fallback at models/browser-control-4bit.bin
      const stored = await chrome.storage.local.get([
        'hanzo_model_url', 'hanzo_model_hf', 'hanzo_model_quant', 'hanzo_model_max_tokens', 'hanzo_model_vocab_url',
      ]);
      let modelUrl: string;
      if (stored.hanzo_model_url) {
        modelUrl = stored.hanzo_model_url;
      } else if (stored.hanzo_model_hf && stored.hanzo_model_hf.repo && stored.hanzo_model_hf.file) {
        const { repo, file, revision } = stored.hanzo_model_hf;
        modelUrl = WebGPUAI.huggingFaceURL(repo, file, revision || 'main');
      } else {
        // Default to the HF-published browser-control artifact. If it 404s, the
        // catch below falls through to the bundled file, then to remote providers.
        modelUrl = WebGPUAI.huggingFaceURL('zenlm/hanzo-browser-control', 'browser-control-4bit.bin');
      }
      try {
        await webgpuAI.loadModel({
          name: 'hanzo-browser-control',
          url: modelUrl,
          quantization: stored.hanzo_model_quant || '4bit',
          maxTokens: stored.hanzo_model_max_tokens || 512,
          vocabUrl: stored.hanzo_model_vocab_url,
        });
        debugLog(`[Hanzo] WebGPU model loaded from ${modelUrl}`);
      } catch (hfErr) {
        debugLog(`[Hanzo] WebGPU model fetch failed for ${modelUrl}: ${hfErr}; trying bundled fallback…`);
        await webgpuAI.loadModel({
          name: 'hanzo-browser-control',
          url: chrome.runtime.getURL('models/browser-control-4bit.bin'),
          quantization: '4bit',
          maxTokens: 512,
        });
      }
    } catch (error) {
      // Neither HF nor bundled artifact available — fall back to remote providers.
      debugLog(`[Hanzo] No local WebGPU model available (${error}); using Ollama/LM Studio/cloud`);
    }
  }

  // Auto-discover local LLM providers (Ollama, LM Studio, Hanzo Desktop)
  ollamaClient.discover().then((found) => {
    if (found) debugLog('[Hanzo] Ollama discovered: ' + ollamaClient.getStatus().url);
  }).catch(() => {});

  // Restore custom Ollama URL from storage
  chrome.storage.local.get(['ollamaUrl'], (result) => {
    if (result.ollamaUrl) ollamaClient.setBaseUrl(result.ollamaUrl);
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(request: any, sender: chrome.runtime.MessageSender, sendResponse: Function) {
  // --- ZAP: status and pairing (shared/zap.ts) ---
  if (typeof request.action === 'string' && zap.handle(request.action, request, sendResponse as (r: any) => void)) return;

  switch (request.action) {

    // --- Snapshot → ref engine, for the extension's own pages ---
    case 'drive':
      sendResponse(await driveMessage(chrome, sender, request, (m, p) => cdpBridge.dispatchMethod(m, p)));
      break;

    // --- Local AI ---
    case 'runLocalAI':
      try {
        const result = await webgpuAI.runInference(request.model || 'hanzo-browser-control', request.prompt);
        sendResponse({ success: true, result });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'checkWebGPU': {
      try {
        if (!navigator.gpu) {
          sendResponse({ available: false });
          break;
        }
        const adapter = await navigator.gpu.requestAdapter();
        sendResponse({
          available: !!adapter,
          adapter: (adapter as any)?.name || 'Unknown GPU',
          models: webgpuAI.getStatus().models,
        });
      } catch {
        sendResponse({ available: false });
      }
      break;
    }

    case 'listAgents':
      sendResponse({ success: true, agents: browserControl.getAgents() });
      break;

    case 'stopAgent':
      sendResponse({ success: browserControl.stopAgent(request.agentId) });
      break;

    case 'launchAIWorker':
      try {
        const targetTabId = request.tabId || sender.tab?.id;
        if (!targetTabId) {
          sendResponse({ success: false, error: 'No target tab found' });
          break;
        }
        const agentId = await browserControl.launchAIWorker(targetTabId, request.model || 'browser-control');
        sendResponse({ success: true, agentId });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    // --- Tab Filesystem ---
    case 'readTabFS':
      try {
        const content = await browserControl.readTab(request.path);
        sendResponse({ success: true, content });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'writeTabFS':
      try {
        await browserControl.writeTab(request.path, request.content);
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'listTabFS':
      const tabs = await browserControl.listTabs();
      sendResponse({ success: true, tabs });
      break;

    // --- CDP bridge commands ---
    case 'cdp.attach':
      try {
        await cdpBridge.attach(request.tabId);
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.detach':
      try {
        await cdpBridge.detach(request.tabId);
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.send':
      try {
        const result = await cdpBridge.send(request.tabId, request.method, request.params);
        sendResponse({ success: true, result });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.screenshot':
      try {
        const screenshot = await cdpBridge.screenshot(request.tabId, request.options);
        sendResponse({ success: true, data: screenshot });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.click':
      try {
        const clicked = await cdpBridge.clickSelector(request.tabId, request.selector);
        sendResponse({ success: clicked });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.fill':
      try {
        const filled = await cdpBridge.fillSelector(request.tabId, request.selector, request.value);
        sendResponse({ success: filled });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.navigate':
      try {
        await cdpBridge.navigate(request.tabId, request.url);
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'cdp.evaluate':
      try {
        const evalResult = unwrapEvaluateResult(await cdpBridge.evaluate(request.tabId, { expression: request.expression }));
        sendResponse({ success: true, result: evalResult });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    // --- AI Control Overlay ---
    case 'ai.control.start': {
      const tabId = await resolveControlTabId(request.tabId);
      if (tabId === null) {
        sendResponse({ success: false, error: 'No target tab found' });
        break;
      }
      await startControlSession(tabId, request.task);
      sendResponse({
        success: true,
        session: {
          active: controlSession.active,
          tabId: controlSession.tabId,
          task: controlSession.task,
          startedAt: controlSession.startedAt,
        },
      });
      break;
    }

    case 'ai.control.stop': {
      await stopControlSession();
      sendResponse({ success: true });
      break;
    }

    case 'ai.control.cursor':
    case 'ai.control.highlight':
    case 'ai.control.status': {
      const tabId = await resolveControlTabId(request.tabId);
      if (tabId === null) {
        sendResponse({ success: false, error: 'No target tab found' });
        break;
      }
      if (controlSession.active && controlSession.tabId !== null && tabId !== controlSession.tabId) {
        sendResponse({
          success: false,
          error: `Control locked to tab ${controlSession.tabId}`,
        });
        break;
      }

      const key = `${tabId}:${request.action}`;
      const signature = JSON.stringify(request);
      const throttleMs = request.action === 'ai.control.cursor'
        ? 40
        : request.action === 'ai.control.status'
          ? 200
          : 90;
      if (!controlMessageLimiter.allow(key, throttleMs)) {
        sendResponse({ success: true, tabId, throttled: true });
        break;
      }
      if (controlMessageSignatures.get(key) === signature) {
        sendResponse({ success: true, tabId, deduped: true });
        break;
      }
      controlMessageSignatures.set(key, signature);

      sendControlMessageToTab(tabId, request);
      sendResponse({ success: true, tabId });
      break;
    }

    case 'ai.control.cancel':
      await stopControlSession();
      sendResponse({ success: true });
      break;

    // --- In-page overlay (content script) ---
    case 'page.overlay.toggle':
    case 'page.overlay.show':
    case 'page.overlay.hide':
    case 'page.overlay.status': {
      try {
        const tabId = typeof request.tabId === 'number'
          ? request.tabId
          : (sender.tab?.id ?? await getActiveTabId());
        if (tabId === null) {
          sendResponse({ success: false, error: 'No target tab found' });
          break;
        }

        const response = await sendMessageToTab(tabId, { action: request.action });
        sendResponse({ success: true, tabId, ...(response || {}) });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;
    }

    // --- Auth (Hanzo IAM OAuth2 + PKCE) ---
    case 'auth.login':
      try {
        const user = await auth.login();
        sendResponse({ success: true, user });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'auth.signup':
      try {
        await auth.signup();
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'auth.logout':
      try {
        await auth.logout();
        sendResponse({ success: true });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'auth.status':
      try {
        const status = await auth.getAuthStatus();
        sendResponse({ success: true, ...status });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'auth.getToken':
      try {
        const token = await auth.getValidAccessToken();
        sendResponse({ success: !!token, token });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'rag.query':
      try {
        const config = await getRagConfig();
        const topKInput = Number.parseInt(String(request.topK ?? config.topK), 10);
        const params: RagQueryParams = {
          query: String(request.query || '').trim(),
          topK: Number.isFinite(topKInput) ? Math.max(1, Math.min(topKInput, 20)) : DEFAULT_RAG_TOP_K,
          knowledgeBase: String(request.knowledgeBase ?? config.knowledgeBase ?? '').trim(),
          includeTabContext: request.includeTabContext !== undefined
            ? !!request.includeTabContext
            : config.includeTabContext,
          endpoint: String(request.endpoint ?? config.endpoint ?? '').trim(),
          apiKey: String(request.apiKey ?? config.apiKey ?? '').trim(),
          pageContext: request.pageContext && typeof request.pageContext === 'object'
            ? {
                url: request.pageContext.url ? String(request.pageContext.url) : undefined,
                title: request.pageContext.title ? String(request.pageContext.title) : undefined,
              }
            : undefined,
        };

        if (!params.query) {
          sendResponse({ success: false, error: 'Query is required' });
          break;
        }

        const snippets = params.endpoint ? await queryRagFromEndpoint(params) : [];
        const source = snippets.length ? 'rag-endpoint' : 'none';

        sendResponse({
          success: true,
          source,
          snippets: snippets.slice(0, params.topK),
        });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    // --- Cloud Chat ---
    case 'chat.listModels':
      try {
        // Models endpoint is public — pass token if available for user-specific access
        const token = await auth.getValidAccessToken().catch(() => undefined);
        const models = await listModelsCached(token || undefined);
        sendResponse({ success: true, models });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'chat.cancel': {
      const senderKey = getSenderKey(sender);
      bumpSenderGeneration(senderKey);
      await recordUsageDelta({ canceledRequests: 1 });
      sendResponse({ success: true });
      break;
    }

    case 'chat.complete':
      try {
        const token = await auth.getValidAccessToken();
        if (!token) {
          sendResponse({ success: false, error: 'Not authenticated' });
          break;
        }

        const senderKey = getSenderKey(sender);
        const requestedModel = String(request.model || 'auto');
        const messagesInput = Array.isArray(request.messages) ? request.messages : [];
        const rawMessages: ChatMessage[] = messagesInput
          .filter((msg: any) => msg && typeof msg.content === 'string' && typeof msg.role === 'string')
          .map((msg: any) => ({
            role: (msg.role === 'system' || msg.role === 'assistant') ? msg.role : 'user',
            content: String(msg.content),
          }));

        const budgeted = trimMessagesToBudget(rawMessages, {
          maxMessages: CHAT_BUDGETS.maxMessages,
          maxInputTokens: CHAT_BUDGETS.maxInputTokens,
        });

        if (!budgeted.messages.length) {
          sendResponse({ success: false, error: 'messages are required' });
          break;
        }

        let availableModelIds = getCachedModelIds();
        if (!availableModelIds.length) {
          availableModelIds = (await listModelsCached(token)).map((model) => model.id);
        }
        const model = pickModelForTokenBudget(requestedModel, availableModelIds, budgeted.inputTokens);
        const temperature = typeof request.temperature === 'number' ? request.temperature : undefined;
        const maxTokens = typeof request.max_tokens === 'number'
          ? Math.max(64, Math.min(request.max_tokens, CHAT_BUDGETS.maxOutputTokens))
          : CHAT_BUDGETS.maxOutputTokens;

        const requestKey = makeChatRequestKey(model, budgeted.messages, temperature, maxTokens);
        const { promise, deduped } = inFlightChatRequests.getOrCreate(requestKey, async () => chatCompletion(token, {
          model,
          messages: budgeted.messages,
          temperature,
          max_tokens: maxTokens,
        }));
        const generation = deduped
          ? (senderRequestGeneration.get(senderKey) || 0)
          : bumpSenderGeneration(senderKey);

        if (deduped) {
          await recordUsageDelta({ dedupeHits: 1 });
          debugLog('[Hanzo] Deduped in-flight chat request');
        }

        const content = await promise;

        if (!isSenderGenerationCurrent(senderKey, generation)) {
          await recordUsageDelta({ canceledRequests: 1 });
          sendResponse({ success: false, error: 'Chat request superseded by a newer request' });
          break;
        }

        await recordUsageDelta({
          chatRequests: 1,
          inputTokens: budgeted.inputTokens,
          outputTokens: estimateTextTokens(content),
        });

        sendResponse({
          success: true,
          content,
          model,
          budget: {
            inputTokens: budgeted.inputTokens,
            droppedMessages: budgeted.droppedMessages,
          },
        });
      } catch (error: any) {
        await recordUsageDelta({ errors: 1 });
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'usage.metrics':
      try {
        const metrics = await readUsageMetrics();
        sendResponse({ success: true, metrics });
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    // --- Bridge status ---
    case 'bridge.status': {
      const bridgeConnected = cdpBridge.isBridgeConnected();
      sendResponse({
        success: true,
        connected: bridgeConnected,
        browsers: bridgeConnected ? [detectBrowser()] : [],
      });
      break;
    }

    // --- Config persistence ---
    case 'config.save': {
      const { key, value } = request;
      // Forward to CDP bridge server so it can save to ~/.hanzo/extension/config.json
      cdpBridge.sendConfig(key, value);
      sendResponse({ success: true });
      break;
    }

    case 'settings.sync': {
      // Sync all settings to ~/.hanzo/extension/config.json via CDP bridge
      if (request.settings && typeof request.settings === 'object') {
        for (const [key, value] of Object.entries(request.settings)) {
          cdpBridge.sendConfig(key, value);
        }
      }
      sendResponse({ success: true });
      break;
    }

    // --- Takeover messages (forwarded from CDP bridge to content script) ---
    case 'hanzo.takeover.start': {
      const takeoverTabId = await resolveControlTabId(request.tabId);
      if (takeoverTabId === null) {
        sendResponse({ success: false, error: 'No target tab found' });
        break;
      }
      await startControlSession(takeoverTabId, request.task);
      sendResponse({ success: true });
      break;
    }

    case 'hanzo.takeover.end': {
      await stopControlSession();
      sendResponse({ success: true });
      break;
    }

    case 'hanzo.takeover.cursor': {
      const cursorTabId = await resolveControlTabId(request.tabId);
      if (cursorTabId !== null) {
        sendControlMessageToTab(cursorTabId, {
          action: 'ai.control.cursor',
          x: request.x,
          y: request.y,
        });
      }
      sendResponse({ success: true });
      break;
    }

    // --- Content script element selection (routed from content script) ---
    case 'elementSelected':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(request.data));
      }
      sendResponse({ success: true });
      break;

    // --- Page Monitor: Console & Network Capture ---
    case 'monitor.start': {
      const monTabId = request.tabId || sender.tab?.id;
      if (!monTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        await pageMonitor.startMonitoring(monTabId);
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'monitor.stop': {
      const monTabId = request.tabId || sender.tab?.id;
      if (monTabId) pageMonitor.stopMonitoring(monTabId);
      sendResponse({ success: true });
      break;
    }

    case 'monitor.consoleLogs':
      sendResponse({ success: true, logs: pageMonitor.getConsoleLogs(request.tabId) });
      break;

    case 'monitor.consoleErrors':
      sendResponse({ success: true, logs: pageMonitor.getConsoleErrors(request.tabId) });
      break;

    case 'monitor.networkLogs':
      sendResponse({ success: true, logs: pageMonitor.getNetworkLogs(request.tabId) });
      break;

    case 'monitor.networkErrors':
      sendResponse({ success: true, logs: pageMonitor.getNetworkErrors(request.tabId) });
      break;

    case 'monitor.networkSuccess':
      sendResponse({ success: true, logs: pageMonitor.getNetworkSuccesses(request.tabId) });
      break;

    case 'monitor.allNetwork':
      sendResponse({ success: true, logs: pageMonitor.getNetworkLogs(request.tabId) });
      break;

    case 'monitor.wipeLogs':
      pageMonitor.wipeLogs(request.tabId);
      sendResponse({ success: true });
      break;

    case 'monitor.config':
      if (request.config) pageMonitor.updateConfig(request.config);
      sendResponse({ success: true });
      break;

    case 'monitor.status':
      sendResponse({ success: true, tabs: pageMonitor.getMonitoredTabs() });
      break;

    // --- Page Audits ---
    case 'audit.accessibility': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runAccessibilityAudit(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'audit.performance': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runPerformanceAudit(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'audit.seo': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runSEOAudit(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'audit.bestPractices': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runBestPracticesAudit(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'audit.full': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runFullAudit(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'audit.nextjs': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runNextJSAudit(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'audit.debugger':
    case 'debugger.mode': {
      const auditTabId = request.tabId || sender.tab?.id;
      if (!auditTabId) { sendResponse({ success: false, error: 'No tab' }); break; }
      try {
        const result = await runDebuggerMode(auditTabId);
        sendResponse({ success: true, result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    // --- Ollama / Local LLM ---
    case 'ollama.discover':
      try {
        const found = await ollamaClient.discover();
        sendResponse({ success: true, discovered: found, ...ollamaClient.getStatus() });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.health':
      try {
        const health = await ollamaClient.healthCheck();
        sendResponse({ success: true, ...health });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.models':
      try {
        const models = await ollamaClient.listModels();
        sendResponse({ success: true, models });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.pull':
      try {
        // Pull is long-running — we track progress via storage
        ollamaClient.pullModel(request.model, (status, completed, total) => {
          chrome.storage.local.set({
            'ollama.pull.progress': { model: request.model, status, completed, total, timestamp: Date.now() },
          });
        }).then(() => {
          chrome.storage.local.set({ 'ollama.pull.progress': { model: request.model, status: 'done', timestamp: Date.now() } });
        }).catch((e) => {
          chrome.storage.local.set({ 'ollama.pull.progress': { model: request.model, status: 'error', error: e.message, timestamp: Date.now() } });
        });
        sendResponse({ success: true, started: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.delete':
      try {
        await ollamaClient.deleteModel(request.model);
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.chat':
      try {
        const result = await ollamaClient.chat(
          request.model,
          request.messages,
          request.options
        );
        sendResponse({ success: true, content: result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.generate':
      try {
        const result = await ollamaClient.generate(
          request.model,
          request.prompt,
          request.options
        );
        sendResponse({ success: true, content: result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.embed':
      try {
        const embedding = await ollamaClient.embed(request.model, request.input);
        sendResponse({ success: true, embedding });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;

    case 'ollama.status':
      sendResponse({ success: true, ...ollamaClient.getStatus() });
      break;

    case 'ollama.setUrl':
      ollamaClient.setBaseUrl(request.url);
      sendResponse({ success: true });
      break;

    // --- Local LLM Provider (Ollama / LM Studio / Hanzo Desktop / Custom) ---
    case 'local.chat': {
      // Unified local LLM chat — routes to the configured local provider
      try {
        const provider = request.provider || 'ollama';
        const endpoint = request.endpoint;
        const model = request.model;
        const messages = request.messages;
        const options = request.options || {};

        let result: string;

        if (provider === 'ollama' && !endpoint) {
          result = await ollamaClient.chat(model, messages, options);
        } else {
          if (provider === 'anthropic') {
            // Anthropic Messages API
            const baseUrl = endpoint || 'https://api.anthropic.com';
            const systemMsg = messages.find((m: any) => m.role === 'system');
            const chatMsgs = messages.filter((m: any) => m.role !== 'system');
            const body: any = { model, max_tokens: options.num_predict || 4096, messages: chatMsgs, stream: false };
            if (systemMsg) body.system = systemMsg.content;
            if (options.temperature !== undefined) body.temperature = options.temperature;

            const resp = await fetch(`${baseUrl}/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': request.apiKey || '',
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(120000),
            });
            if (!resp.ok) { const text = await resp.text(); throw new Error(`Anthropic: ${resp.status} ${text}`); }
            const data = await resp.json();
            result = data.content?.[0]?.text || '';
          } else {
            // OpenAI-compatible: LM Studio, Hanzo Desktop, Hanzo Node, custom
            const providerConfig = LOCAL_PROVIDER_DEFAULTS[provider as keyof typeof LOCAL_PROVIDER_DEFAULTS];
            const baseUrl = endpoint || (providerConfig ? `${providerConfig.url}/v1` : 'http://localhost:8080/v1');
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (request.apiKey) headers['Authorization'] = `Bearer ${request.apiKey}`;

            const body: any = { model, messages, stream: false };
            if (options.temperature !== undefined) body.temperature = options.temperature;
            if (options.top_p !== undefined) body.top_p = options.top_p;
            if (options.num_predict !== undefined) body.max_tokens = options.num_predict;

            const resp = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(120000),
            });
            if (!resp.ok) {
              const text = await resp.text();
              throw new Error(`${provider} error: ${resp.status} ${text}`);
            }
            const data = await resp.json();
            result = data.choices?.[0]?.message?.content || '';
          }
        }

        sendResponse({ success: true, content: result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'local.models': {
      // List models from any OpenAI-compatible local provider
      try {
        const providerCfg = LOCAL_PROVIDER_DEFAULTS[request.provider as keyof typeof LOCAL_PROVIDER_DEFAULTS];
        const endpoint = request.endpoint || (
          request.provider === 'ollama' ? null :
          providerCfg ? `${providerCfg.url}/v1` :
          request.endpoint || 'http://localhost:8080/v1'
        );

        if (!endpoint) {
          // Use Ollama native
          const models = await ollamaClient.listModels();
          sendResponse({ success: true, models: models.map(m => ({ id: m.name, name: m.name, size: m.size, details: m.details })) });
          break;
        }

        const headers: Record<string, string> = {};
        if (request.apiKey) headers['Authorization'] = `Bearer ${request.apiKey}`;

        const resp = await fetch(`${endpoint}/models`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        sendResponse({ success: true, models: data.data || data.models || [] });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'local.discover': {
      // Auto-discover all local LLM providers
      const providers: { name: string; url: string; available: boolean; models?: string[] }[] = [];

      // Ollama
      const ollamaDefaults = LOCAL_PROVIDER_DEFAULTS.ollama;
      const ollamaFound = await ollamaClient.discover();
      if (ollamaFound) {
        const models = await ollamaClient.listModels();
        providers.push({ name: 'ollama', url: ollamaClient.getStatus().url, available: true, models: models.map(m => m.name) });
      } else {
        providers.push({ name: 'ollama', url: ollamaDefaults.url, available: false });
      }

      // LM Studio (OpenAI-compatible)
      const lmsDefaults = LOCAL_PROVIDER_DEFAULTS.lmstudio;
      try {
        const resp = await fetch(`${lmsDefaults.url}/models`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const data = await resp.json();
          providers.push({ name: 'lmstudio', url: lmsDefaults.url, available: true, models: (data.data || []).map((m: any) => m.id) });
        } else {
          providers.push({ name: 'lmstudio', url: lmsDefaults.url, available: false });
        }
      } catch {
        providers.push({ name: 'lmstudio', url: lmsDefaults.url, available: false });
      }

      // Hanzo Desktop (Ollama embedded, configurable probe ports)
      const hdDefaults = LOCAL_PROVIDER_DEFAULTS['hanzo-desktop'];
      for (const port of hdDefaults.probePorts) {
        try {
          const resp = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(2000) });
          if (resp.ok) {
            const data = await resp.json();
            providers.push({ name: 'hanzo-desktop', url: `http://localhost:${port}`, available: true, models: (data.models || []).map((m: any) => m.name) });
            break;
          }
        } catch { /* next */ }
      }
      if (!providers.find(p => p.name === 'hanzo-desktop')) {
        providers.push({ name: 'hanzo-desktop', url: hdDefaults.url, available: false });
      }

      // Hanzo Node (standalone Rust node, configurable probe ports)
      const hnDefaults = LOCAL_PROVIDER_DEFAULTS['hanzo-node'];
      let hanzoNodeFound = false;
      for (const port of hnDefaults.probePorts) {
        try {
          const endpoint = port === hnDefaults.probePorts[0] ? `http://localhost:${port}/v2/health` : `http://localhost:${port}/health`;
          const resp = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
          if (resp.ok) {
            providers.push({ name: 'hanzo-node', url: `http://localhost:${port}`, available: true });
            hanzoNodeFound = true;
            break;
          }
        } catch { /* next */ }
      }
      if (!hanzoNodeFound) {
        providers.push({ name: 'hanzo-node', url: hnDefaults.url, available: false });
      }

      // Check for custom endpoints saved in storage
      const stored = await chrome.storage.local.get(['customLLMEndpoints']);
      const customs: { name: string; url: string; apiKey?: string }[] = stored.customLLMEndpoints || [];
      for (const c of customs) {
        try {
          const headers: Record<string, string> = {};
          if (c.apiKey) headers['Authorization'] = `Bearer ${c.apiKey}`;
          const resp = await fetch(`${c.url}/models`, { headers, signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            const data = await resp.json();
            providers.push({ name: c.name || 'custom', url: c.url, available: true, models: (data.data || data.models || []).map((m: any) => m.id || m.name) });
          } else {
            providers.push({ name: c.name || 'custom', url: c.url, available: false });
          }
        } catch {
          providers.push({ name: c.name || 'custom', url: c.url, available: false });
        }
      }

      sendResponse({ success: true, providers });
      break;
    }

    // --- Hanzo Cloud Models ---
    case 'models.list': {
      // List all available models from Hanzo Cloud
      try {
        const token = await auth.getValidAccessToken();
        if (!token) {
          // Not authenticated — try fetching public model list from API
          try {
            const publicModels = await listModels();
            sendResponse({ success: true, models: publicModels || [], authenticated: false });
          } catch {
            sendResponse({ success: true, models: [], authenticated: false });
          }
          break;
        }
        const cloudModels = await listModels(token);
        sendResponse({ success: true, models: cloudModels, authenticated: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'provider.save': {
      // Save a custom LLM endpoint
      try {
        const stored = await chrome.storage.local.get(['customLLMEndpoints']);
        const endpoints: any[] = stored.customLLMEndpoints || [];
        const existing = endpoints.findIndex(e => e.name === request.name || e.url === request.url);
        const entry = { name: request.name, url: request.url, apiKey: request.apiKey };
        if (existing >= 0) {
          endpoints[existing] = entry;
        } else {
          endpoints.push(entry);
        }
        await chrome.storage.local.set({ customLLMEndpoints: endpoints });
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'provider.remove': {
      try {
        const stored = await chrome.storage.local.get(['customLLMEndpoints']);
        const endpoints: any[] = (stored.customLLMEndpoints || []).filter(
          (e: any) => e.name !== request.name && e.url !== request.url
        );
        await chrome.storage.local.set({ customLLMEndpoints: endpoints });
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'provider.test': {
      // Test connection to any OpenAI-compatible endpoint
      try {
        const headers: Record<string, string> = {};
        if (request.apiKey) headers['Authorization'] = `Bearer ${request.apiKey}`;
        const resp = await fetch(`${request.url}/models`, { headers, signal: AbortSignal.timeout(5000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        sendResponse({ success: true, models: (data.data || data.models || []).map((m: any) => m.id || m.name) });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    // --- Settings Sync (unified chrome.storage + ~/.hanzo via CDP bridge) ---
    case 'settings.get': {
      try {
        const keys = request.keys || [
          'selectedProvider', 'selectedModel', 'customLLMEndpoints', 'ollamaUrl',
          'anthropicApiKey', 'openaiApiKey', 'hanzoApiKey',
          'mcpPort', 'cdpPort',
          'source-maps', 'webgpu-ai', 'browser-control', 'tab-filesystem',
          'activeOrgId', 'browserBackend',
        ];
        const result = await chrome.storage.local.get(keys);
        sendResponse({ success: true, settings: result });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'settings.set': {
      try {
        await chrome.storage.local.set(request.settings);
        // Also persist to ~/.hanzo/extension/config.json via CDP bridge if connected
        try {
          const bridge = getCDPBridge();
          if (bridge.isBridgeConnected()) {
            for (const [key, value] of Object.entries(request.settings)) {
              bridge.sendConfig(key, value);
            }
          }
        } catch { /* bridge not connected, local-only save is fine */ }
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'settings.export': {
      // Export all settings as JSON
      try {
        const all = await chrome.storage.local.get(null);
        // Filter out tokens and sensitive data
        const safe: Record<string, any> = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith('hanzo_iam_')) continue; // skip tokens
          safe[k] = v;
        }
        sendResponse({ success: true, settings: safe });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'settings.import': {
      try {
        const settings = request.settings || {};
        // Don't import token data
        delete settings.hanzo_iam_access_token;
        delete settings.hanzo_iam_refresh_token;
        delete settings.hanzo_iam_id_token;
        await chrome.storage.local.set(settings);
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    // --- Organization Switcher ---
    case 'org.list': {
      // Fetch user's organizations from Hanzo IAM
      try {
        const token = await auth.getValidAccessToken();
        if (!token) { sendResponse({ success: false, error: 'Not authenticated' }); break; }

        const resp = await fetch(`${IAM_V1}/account`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) throw new Error(`IAM: ${resp.status}`);
        const data = await resp.json();
        const user = data.data || data;

        // Hanzo IAM stores org memberships in user.groups or via org API
        const orgs: { id: string; name: string; displayName?: string }[] = [];

        // Primary org from user's owner field
        if (user.owner) {
          orgs.push({ id: user.owner, name: user.owner, displayName: user.owner });
        }

        // Fetch orgs the user belongs to
        try {
          const orgsResp = await fetch(`${IAM_V1}/organizations`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          });
          if (orgsResp.ok) {
            const orgsData = await orgsResp.json();
            for (const org of (orgsData.organizations || [])) {
              if (!orgs.find(o => o.id === org.name)) {
                orgs.push({ id: org.name, name: org.name, displayName: org.displayName || org.name });
              }
            }
          }
        } catch { /* user may not have permission to list all orgs */ }

        // Get active org from storage
        const stored = await chrome.storage.local.get(['activeOrgId']);
        sendResponse({
          success: true,
          orgs,
          activeOrgId: stored.activeOrgId || orgs[0]?.id || null,
          user: { name: user.displayName || user.name, email: user.email, avatar: user.avatar },
        });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'org.switch': {
      try {
        await chrome.storage.local.set({ activeOrgId: request.orgId });
        sendResponse({ success: true, activeOrgId: request.orgId });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    // --- API Key Management ---
    case 'apikey.save': {
      try {
        const keyMap: Record<string, string> = {};
        keyMap[`apikey_${request.provider}`] = request.apiKey;
        await chrome.storage.local.set(keyMap);
        sendResponse({ success: true });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'apikey.get': {
      try {
        const key = `apikey_${request.provider}`;
        const stored = await chrome.storage.local.get([key]);
        sendResponse({ success: true, apiKey: stored[key] || null });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    case 'apikey.list': {
      try {
        const all = await chrome.storage.local.get(null);
        const keys: { provider: string; hasKey: boolean }[] = [];
        for (const [k] of Object.entries(all)) {
          if (k.startsWith('apikey_')) {
            keys.push({ provider: k.replace('apikey_', ''), hasKey: true });
          }
        }
        sendResponse({ success: true, keys });
      } catch (e: any) {
        sendResponse({ success: false, error: e.message });
      }
      break;
    }

    // =========================================================================
    // Model Hub — Browse, search, download models
    // =========================================================================

    case 'hub.search': {
      (async () => {
        try {
          const models = await searchHuggingFace(request.query || '', {
            filter: request.filter,
            sort: request.sort,
            limit: request.limit,
            author: request.author,
          });
          sendResponse({ success: true, models });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.searchGGUF': {
      (async () => {
        try {
          const models = await searchGGUF(request.query || '', request.limit);
          sendResponse({ success: true, models });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.model': {
      (async () => {
        try {
          const model = await getHuggingFaceModel(request.modelId);
          sendResponse({ success: true, model });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.recommended': {
      sendResponse({ success: true, models: getRecommendedModels() });
      break;
    }

    case 'hub.searchOllama': {
      (async () => {
        try {
          const models = await searchOllamaLibrary(request.query || '');
          sendResponse({ success: true, models });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.downloadOllama': {
      (async () => {
        try {
          await downloadToOllama(
            request.modelName,
            request.ollamaUrl || undefined,
            (progress: DownloadProgress) => {
              // Broadcast progress to all extension views
              chrome.runtime.sendMessage({
                type: 'hub.downloadProgress',
                progress,
              }).catch(() => {});
            }
          );
          sendResponse({ success: true });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.downloadHF': {
      (async () => {
        try {
          const buffer = await downloadFromHuggingFace(
            request.downloadUrl,
            (progress: DownloadProgress) => {
              chrome.runtime.sendMessage({
                type: 'hub.downloadProgress',
                progress,
              }).catch(() => {});
            }
          );
          sendResponse({ success: true, size: buffer.byteLength });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.searchMLX': {
      (async () => {
        try {
          const models = await searchMLX(request.query || '', request.limit);
          sendResponse({ success: true, models });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.modelCard': {
      (async () => {
        try {
          const card = await getModelCard(request.modelId);
          sendResponse({ success: true, card });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    case 'hub.modelStats': {
      (async () => {
        try {
          const stats = await getModelStats(request.modelId);
          sendResponse({ success: true, stats });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    // Unified model listing: combine cloud + local + hub recommended
    case 'hub.allModels': {
      (async () => {
        try {
          const results: { cloud: any[]; local: any[]; recommended: HubModel[] } = {
            cloud: [],
            local: [],
            recommended: getRecommendedModels(),
          };

          // Cloud models from Hanzo
          try {
            const { hanzo_iam_token } = await chrome.storage.local.get('hanzo_iam_token');
            if (hanzo_iam_token) {
              const resp = await fetch(`${API_BASE_URL}/v1/models`, {
                headers: { Authorization: `Bearer ${hanzo_iam_token}` },
                signal: AbortSignal.timeout(5000),
              });
              if (resp.ok) {
                const data = await resp.json();
                results.cloud = (data.data || []).map((m: any) => ({
                  id: m.id,
                  name: m.id,
                  provider: 'hanzo-cloud',
                  owned_by: m.owned_by || 'hanzo',
                }));
              }
            }
          } catch { /* cloud unavailable */ }

          // Local models from Ollama
          try {
            const ollamaModels = await ollamaClient.listModels();
            results.local = ollamaModels.map((m: any) => ({
              id: m.name || m.model,
              name: m.name || m.model,
              provider: 'ollama',
              size: m.size,
              format: m.details?.format,
              quantization: m.details?.quantization_level,
            }));
          } catch { /* ollama unavailable */ }

          sendResponse({ success: true, ...results });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

    // --- AI provider usage (Claude + Codex, via @hanzo/usage) ---
    case 'usage.fetch': {
      (async () => {
        try {
          const providers = await fetchAllUsage();
          sendResponse({ success: true, providers });
        } catch (e: any) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      break;
    }

  }
}

// =============================================================================
// Startup
// =============================================================================

// 0. Side panel intentionally NOT registered. The user requirement is a
// right-anchored, in-page chat overlay across every browser; the native
// chrome.sidePanel surface gives an OS-managed panel which doesn't match
// that design and behaves differently from the Firefox path. Routing
// through the content-script overlay (page.overlay.* messages) is the
// single source of truth — see popup.ts.

// End active session when the controlled tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (controlSession.active && controlSession.tabId === tabId) {
    void stopControlSession();
  }
});

// 1. Join this machine's ZAP router over its loopback WebSocket, once paired,
//    and register as a browser node. Inbound ROUTE commands dispatch to the
//    browser. Exactly one transport (shared/socket.ts); the router is embedded
//    in hanzo-mcp and the other Hanzo processes, so there is nothing to install.
const BROWSER_CAPS = ['browser.tabs', 'browser.navigate', 'browser.dom', 'browser.screenshot', 'browser.input'];
const browserDispatch = (method: string, params: any) => cdpBridge.dispatchMethod(method, params);
const zap = startZap({
  brand: 'hanzo',
  caps: BROWSER_CAPS,
  engine: BROWSER_NAME,
  dispatch: browserDispatch,
  log: debugLog,
  storage: chrome.storage.local,
});

// Keep-alive — Layer 1: Port. Content scripts in every loaded http(s) tab
// hold a `zap-keepalive` port. As long as ANY tab has one, Chrome keeps
// the service worker alive without alarms.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'zap-keepalive') return;
  port.onMessage.addListener(() => { /* receipt is the keep-alive */ });
  // A tab entering the back/forward cache closes its port and Chrome reports
  // that close here, on this end; reading lastError marks it as expected.
  port.onDisconnect.addListener((p) => {
    void chrome.runtime.lastError;
    void p?.error;
    void (port as any)?.error;
  });
});

// Keep-alive — Layer 2: Alarms. While the socket is up its 20 s heartbeat keeps
// the worker alive; the alarm restarts the reconciler's clock after the worker
// was stopped anyway (no pairing yet, no router yet, browser suspend).
const KEEP_ALIVE_ALARM = 'hanzo-zap-keepalive';
try {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEP_ALIVE_ALARM) return;
    zap.tick();
  });
} catch (e) {
  console.warn('[Hanzo] alarms unavailable:', e);
}


// Export for testing
export { browserControl, webgpuAI, zap };

// omnibox keyword: type `hanzo <query>` in the address bar -> the Hanzo answer
// engine. This is the ONE search entry, and the manifest declares no
// chrome_settings_overrides.search_provider: Chrome honours that key only on
// Windows/macOS and only for Web Store installs (elsewhere it is a load-time
// "not allowed for specified platform" warning), and Brave ignores it outright.
// The omnibox is the extension handling its own keyword, which needs no browser
// cooperation and works unpacked, on every platform, in Brave and Chrome alike.
//
// Target is hanzo.chat/?q= — the plain query form, same as any search engine.
try {
  const omnibox = (chrome as any).omnibox;
  if (omnibox) {
    omnibox.setDefaultSuggestion({
      description: 'Search Hanzo AI — AI answers with sources and realtime news',
    });
    omnibox.onInputEntered.addListener((text: string, disposition: string) => {
      const url = 'https://hanzo.chat/?q=' + encodeURIComponent(text);
      if (disposition === 'newForegroundTab') {
        void chrome.tabs.create({ url });
      } else if (disposition === 'newBackgroundTab') {
        void chrome.tabs.create({ url, active: false });
      } else {
        void chrome.tabs.update({ url });
      }
    });
  }
} catch (e) {
  console.warn('[Hanzo] omnibox unavailable:', e);
}
