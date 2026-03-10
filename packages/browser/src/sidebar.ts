import {
  CHAT_BUDGETS,
  debugLog,
  debounce,
  estimateTextTokens,
  loadDebugFlagFromStorage,
  makeChatRequestKey,
  pickModelForTokenBudget,
  recordUsageDelta,
  trimMessagesToBudget,
} from './runtime-guard';

// Hanzo AI Browser Extension Sidebar — Chat + Tools + Settings

class HanzoSidebar {
  constructor() {
    this.agents = new Map();
    this.currentTab = 'chat';
    this.messages = [];
    this.streaming = false;
    this.streamController = null;
    this.authenticated = false;
    this.ragContext = null;
    this.chatWidgetMounted = false;
    this.chatWidgetMountPromise = null;
    this.toolsInitialized = false;
    this.monitoringStarted = false;
    this.lastRequestKey = null;
    this.lastRequestAt = 0;
    this.requestEpoch = 0;
    this.lastInputTokens = 0;
    this.lastOutputTokens = 0;
    this.authInFlight = false;
    this.refreshTabFilesystemDebounced = debounce(() => {
      if (this.currentTab === 'tools') {
        void this.refreshTabFilesystem();
      }
    }, 500);
    this.persistConversationDebounced = debounce(() => {
      const toStore = this.messages.slice(-50);
      chrome.storage.local.set({ hanzo_chat_messages: toStore });
    }, 400);

    void loadDebugFlagFromStorage();
    this.initializeUI();
    this.setupEventListeners();
    this.checkAuth();
  }

  initializeUI() {
    this.el = {
      // Auth
      authSection: document.getElementById('auth-section'),
      authBtn: document.getElementById('auth-btn'),
      tabBar: document.getElementById('tab-bar'),

      // Chat
      tabChat: document.getElementById('tab-chat'),
      chatMessages: document.getElementById('chat-messages'),
      chatInput: document.getElementById('chat-input'),
      sendBtn: document.getElementById('send-btn'),
      modelSelect: document.getElementById('model-select'),
      ragEnabled: document.getElementById('rag-enabled'),
      tabContextEnabled: document.getElementById('tab-context-enabled'),
      ragStatus: document.getElementById('rag-status'),

      // Tools
      tabTools: document.getElementById('tab-tools'),
      mcpStatus: document.getElementById('mcp-status'),
      mcpTools: document.getElementById('mcp-tools'),
      mcpToolList: document.getElementById('mcp-tool-list'),
      builtinToolList: document.getElementById('builtin-tool-list'),
      toolCountBadge: document.getElementById('tool-count-badge'),
      mcpServerList: document.getElementById('mcp-server-list'),
      mcpServerCount: document.getElementById('mcp-server-count'),
      agentCount: document.getElementById('agent-count'),
      agentList: document.getElementById('agent-list'),
      tabFs: document.getElementById('tab-fs'),
      refreshTabs: document.getElementById('refresh-tabs'),
      launchAgent: document.getElementById('launch-agent'),
      // Inspector
      pickElement: document.getElementById('pick-element'),
      takeScreenshot: document.getElementById('take-screenshot'),
      runAudit: document.getElementById('run-audit'),
      inspectorResult: document.getElementById('inspector-result'),
      hanzoNodeStatus: document.getElementById('hanzo-node-status'),
      hanzoMcpStatus: document.getElementById('hanzo-mcp-status'),
      startHanzoNode: document.getElementById('start-hanzo-node'),
      startHanzoMcp: document.getElementById('start-hanzo-mcp'),
      usageChatRequests: document.getElementById('usage-chat-requests'),
      usageInputTokens: document.getElementById('usage-input-tokens'),
      usageOutputTokens: document.getElementById('usage-output-tokens'),
      usageDedupe: document.getElementById('usage-dedupe'),
      usageCanceled: document.getElementById('usage-canceled'),

      // Settings
      tabSettings: document.getElementById('tab-settings'),
      accountPanel: document.getElementById('account-panel'),
      userAvatar: document.getElementById('user-avatar'),
      userName: document.getElementById('user-name'),
      userEmail: document.getElementById('user-email'),
      logoutBtn: document.getElementById('logout-btn'),
      saveSettings: document.getElementById('save-settings'),
      defaultModel: document.getElementById('default-model'),
      ragUseZap: document.getElementById('rag-use-zap'),
      ragIncludeTabContext: document.getElementById('rag-include-tab-context'),
      ragTopK: document.getElementById('rag-top-k'),
      ragKb: document.getElementById('rag-kb'),
      ragEndpoint: document.getElementById('rag-endpoint'),
      ragApiKey: document.getElementById('rag-api-key'),

      // Build info
      buildExtVersion: document.getElementById('build-ext-version'),
      buildBrowser: document.getElementById('build-browser'),
      buildManifest: document.getElementById('build-manifest'),
      buildCdpStatus: document.getElementById('build-cdp-status'),
      buildMcpStatus: document.getElementById('build-mcp-status'),
      footerVersion: document.getElementById('footer-version'),
    };
  }

  setupEventListeners() {
    // Auth (delegated so lazy-mounted React login card keeps working)
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('#auth-btn')) {
        event.preventDefault();
        void this.login();
        return;
      }
      if (target.closest('#signup-btn')) {
        event.preventDefault();
        void this.signup();
      }
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Chat
    this.el.sendBtn.addEventListener('click', () => this.sendMessage());
    this.el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.el.chatInput.addEventListener('input', () => this.scheduleAutoResize());
    this.el.ragEnabled?.addEventListener('change', () => {
      this.setRagStatus(this.el.ragEnabled.checked ? 'RAG enabled' : 'RAG disabled');
    });
    this.el.tabContextEnabled?.addEventListener('change', () => {
      if (!this.el.ragEnabled?.checked) return;
      this.setRagStatus(this.el.tabContextEnabled.checked ? 'Tab context on' : 'Tab context off');
    });

    // Tools
    this.el.refreshTabs.addEventListener('click', () => this.refreshTabFilesystem());
    this.el.launchAgent.addEventListener('click', () => this.showAgentLauncher());
    this.el.startHanzoNode?.addEventListener('click', () => this.startHanzoService('node'));
    this.el.startHanzoMcp?.addEventListener('click', () => this.startHanzoService('bot'));

    // Inspector
    this.el.pickElement?.addEventListener('click', () => this.pickElement());
    this.el.takeScreenshot?.addEventListener('click', () => this.takeScreenshot());
    this.el.runAudit?.addEventListener('click', () => this.runAudit());

    // Model Hub
    const searchModelsBtn = document.getElementById('search-models-btn');
    const refreshModelsBtn = document.getElementById('refresh-models');
    const modelSearchInput = document.getElementById('model-search') as HTMLInputElement | null;

    searchModelsBtn?.addEventListener('click', () => {
      const q = modelSearchInput?.value?.trim();
      if (q) void this.searchModels(q);
    });
    refreshModelsBtn?.addEventListener('click', () => void this.refreshModelHub());
    modelSearchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = modelSearchInput.value?.trim();
        if (q) void this.searchModels(q);
        else void this.refreshModelHub();
      }
    });

    // Settings
    this.el.logoutBtn.addEventListener('click', () => this.logout());
    this.el.saveSettings.addEventListener('click', () => this.saveSettings());

    // Background messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request);
      return true;
    });

    chrome.tabs.onUpdated.addListener(() => this.refreshTabFilesystemDebounced());
    chrome.tabs.onRemoved.addListener(() => this.refreshTabFilesystemDebounced());
  }

  // ===========================================================================
  // Auth
  // ===========================================================================

  async checkAuth() {
    // Always show tabs and initialize tools — auth only gates chat
    this.el.tabBar.classList.remove('hidden');
    this.el.authSection.classList.add('hidden');
    this.switchTab('tools'); // Default to tools (always works)

    this.loadSettings();
    this.startMonitoring();

    try {
      const response = await chrome.runtime.sendMessage({ action: 'auth.status' });
      if (response?.success && response.authenticated) {
        this.setUser(response.user);
        this.switchTab('chat');
      } else {
        this.showChatLoginPrompt();
      }
    } catch (error) {
      debugLog('Auth check failed:', error);
      this.showChatLoginPrompt();
    }
  }

  async login() {
    if (this.authInFlight) return;
    this.authInFlight = true;

    const authBtn = document.getElementById('auth-btn') as HTMLButtonElement | null;
    if (authBtn) {
      authBtn.disabled = true;
      authBtn.textContent = 'Signing in...';
    }

    try {
      const response = await chrome.runtime.sendMessage({ action: 'auth.login' });
      if (response?.success) {
        this.setUser(response.user);
        this.hideChatLoginPrompt();
      } else {
        this.showError(response?.error || 'Sign in failed');
      }
    } catch (error) {
      this.showError('Sign in failed');
    } finally {
      this.authInFlight = false;
      const latestAuthBtn = document.getElementById('auth-btn') as HTMLButtonElement | null;
      if (latestAuthBtn) {
        latestAuthBtn.disabled = false;
        latestAuthBtn.textContent = 'Sign in with Hanzo';
      }
    }
  }

  async signup() {
    const response = await chrome.runtime.sendMessage({ action: 'auth.signup' });
    if (!response?.success) {
      this.showError(response?.error || 'Unable to open signup');
    } else {
      this.showNotification('Signup opened in a new tab');
    }
  }

  async logout() {
    await chrome.runtime.sendMessage({ action: 'auth.logout' });
    if (this.el.userName) this.el.userName.textContent = '';
    if (this.el.userEmail) this.el.userEmail.textContent = '';
    if (this.el.userAvatar) this.el.userAvatar.src = '';
    if (this.el.accountPanel) this.el.accountPanel.classList.add('hidden');
    this.showChatLoginPrompt();
    this.switchTab('tools');
  }

  setUser(user) {
    this.authenticated = true;
    if (user) {
      const avatar = user.picture || user.avatar || '';
      if (avatar && this.el.userAvatar) {
        this.el.userAvatar.src = avatar;
        this.el.userAvatar.style.display = '';
      }
      if (this.el.userName) {
        this.el.userName.textContent = user.name || user.displayName || user.sub || 'User';
      }
      if (this.el.userEmail) {
        this.el.userEmail.textContent = user.email || '';
      }
      // Show the account panel
      if (this.el.accountPanel) {
        this.el.accountPanel.classList.remove('hidden');
      }
    }
    this.loadModels();
    this.loadConversation();
    void this.refreshBalance();
    void this.refreshModelHub();
  }

  showChatLoginPrompt() {
    this.authenticated = false;
    // Show login prompt in chat area instead of blocking entire sidebar
    const chatLogin = document.getElementById('chat-login-prompt');
    if (chatLogin) chatLogin.classList.remove('hidden');
    const chatComposer = document.getElementById('chat-composer');
    if (chatComposer) chatComposer.classList.add('hidden');
    // Hide chat messages / welcome when not authenticated
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) chatMessages.classList.add('hidden');
    // Hide account panel when not authenticated
    if (this.el.accountPanel) this.el.accountPanel.classList.add('hidden');
  }

  hideChatLoginPrompt() {
    this.authenticated = true;
    const chatLogin = document.getElementById('chat-login-prompt');
    if (chatLogin) chatLogin.classList.add('hidden');
    const chatComposer = document.getElementById('chat-composer');
    if (chatComposer) chatComposer.classList.remove('hidden');
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) chatMessages.classList.remove('hidden');
  }

  // ===========================================================================
  // Tab Navigation
  // ===========================================================================

  switchTab(name) {
    this.currentTab = name;
    if (name === 'chat') {
      void this.ensureChatWidgetMounted();
    }
    if (name === 'tools') {
      this.ensureToolsInitialized();
      void this.refreshUsageMetrics();
    }

    // Update tab buttons
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });

    // Show/hide content
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    const target = document.getElementById(`tab-${name}`);
    if (target) target.classList.remove('hidden');
  }

  async ensureChatWidgetMounted() {
    if (this.chatWidgetMounted) return;
    if (this.chatWidgetMountPromise) {
      await this.chatWidgetMountPromise;
      return;
    }

    this.chatWidgetMountPromise = import('./chat-widget')
      .then((mod) => {
        mod.mountModernChatWidget();
        this.chatWidgetMounted = true;
      })
      .catch((error) => {
        debugLog('Failed to mount chat widget:', error);
      })
      .finally(() => {
        this.chatWidgetMountPromise = null;
      });

    await this.chatWidgetMountPromise;
  }

  ensureToolsInitialized() {
    if (this.toolsInitialized) return;
    this.toolsInitialized = true;
    this.renderBuiltinTools();
    void this.connectToMCP();
    void this.refreshTabFilesystem();
    void this.checkHanzoServices();
    void this.refreshUsageMetrics();
    void this.refreshBalance();
    void this.refreshModelHub();
  }

  // ===========================================================================
  // Chat
  // ===========================================================================

  async loadModels() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'chat.listModels' });
      if (response?.success && response.models?.length) {
        const select = this.el.modelSelect;
        select.innerHTML = '';
        const autoOpt = document.createElement('option');
        autoOpt.value = 'auto';
        autoOpt.textContent = 'Auto (cost-aware)';
        select.appendChild(autoOpt);

        for (const model of response.models) {
          const opt = document.createElement('option');
          opt.value = model.id;
          opt.textContent = model.name || model.id;
          select.appendChild(opt);
        }
        select.value = 'auto';
        // Also populate settings default model
        this.el.defaultModel.innerHTML = select.innerHTML;
      }
    } catch (error) {
      debugLog('Failed to load models:', error);
      // Keep default options
    }
  }

  async sendMessage() {
    const text = this.el.chatInput?.value?.trim();
    if (!text) return;
    if (!this.authenticated) {
      // Double-check auth status in case it was set externally
      try {
        const status = await chrome.runtime.sendMessage({ action: 'auth.status' });
        if (status?.success && status.authenticated) {
          this.authenticated = true;
          if (status.user) this.setUser(status.user);
        }
      } catch {}
      if (!this.authenticated) {
        this.showError('Please sign in to use chat');
        return;
      }
    }

    if (this.streaming && this.streamController) {
      this.streamController.abort();
      await chrome.runtime.sendMessage({ action: 'chat.cancel' }).catch(() => {});
      await recordUsageDelta({ canceledRequests: 1 });
      this.streaming = false;
      this.streamController = null;
      this.el.sendBtn.disabled = false;
    }

    const requestId = ++this.requestEpoch;

    // Get token
    const tokenResp = await chrome.runtime.sendMessage({ action: 'auth.getToken' });
    if (!tokenResp?.success || !tokenResp.token) {
      this.showError('Please sign in again');
      return;
    }

    const userMessage = { role: 'user', content: text };
    const selectedModel = this.el.modelSelect.value || 'auto';
    let requestMessages = [...this.messages, userMessage];

    this.ragContext = null;
    if (this.el.ragEnabled?.checked) {
      this.setRagStatus('Retrieving context...');
      const ragResp = await this.requestRagContext(text);
      if (ragResp?.success && Array.isArray(ragResp.snippets) && ragResp.snippets.length) {
        this.ragContext = ragResp;
        requestMessages = [
          { role: 'system', content: this.buildRagSystemPrompt(ragResp) },
          ...requestMessages,
        ];
        this.setRagStatus(`RAG: ${ragResp.snippets.length} snippet(s) from ${ragResp.source || 'context'}`);
      } else if (ragResp?.error) {
        this.setRagStatus(`RAG unavailable (${ragResp.error})`);
      } else {
        this.setRagStatus('No context found');
      }
    } else {
      this.setRagStatus('RAG disabled');
    }

    const budgeted = trimMessagesToBudget(requestMessages, {
      maxMessages: CHAT_BUDGETS.maxMessages,
      maxInputTokens: CHAT_BUDGETS.maxInputTokens,
    });

    if (!budgeted.messages.length) {
      this.showError('Message budget exhausted, please shorten your prompt');
      return;
    }

    const availableModelIds = Array.from(this.el.modelSelect?.options || [])
      .map((option) => option.value)
      .filter((value) => value && value !== 'auto');
    const resolvedModel = pickModelForTokenBudget(selectedModel, availableModelIds, budgeted.inputTokens);
    const maxTokens = Math.min(
      CHAT_BUDGETS.maxOutputTokens,
      Math.max(200, Math.ceil(estimateTextTokens(text) * 1.8)),
    );
    const requestKey = makeChatRequestKey(resolvedModel, budgeted.messages, undefined, maxTokens);

    if (
      this.lastRequestKey === requestKey &&
      Date.now() - this.lastRequestAt < CHAT_BUDGETS.duplicateWindowMs
    ) {
      this.showNotification('Duplicate request skipped');
      await recordUsageDelta({ dedupeHits: 1 });
      return;
    }
    this.lastRequestKey = requestKey;
    this.lastRequestAt = Date.now();

    if (budgeted.droppedMessages > 0) {
      this.setRagStatus(
        `Trimmed ${budgeted.droppedMessages} older message(s) for token budget`,
      );
    }

    // Add user message to transcript
    this.messages.push(userMessage);
    this.appendMessage('user', text);

    // Clear input
    this.el.chatInput.value = '';
    this.scheduleAutoResize();

    // Show typing
    this.streaming = true;
    this.el.sendBtn.disabled = true;
    const typingEl = this.showTyping();

    // Create assistant message element
    const assistantEl = this.appendMessage('assistant', '');
    let fullContent = '';

    try {
      // Stream via direct fetch (sidebar has access via CSP)
      const response = await fetch('https://api.hanzo.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenResp.token}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: budgeted.messages,
          stream: true,
          max_tokens: maxTokens,
        }),
        signal: (this.streamController = new AbortController()).signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      typingEl.remove();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (requestId !== this.requestEpoch) {
          throw new DOMException('Superseded by a newer request', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                assistantEl.innerHTML = this.renderMarkdown(fullContent);
                this.scrollToBottom();
              }
            } catch {}
          }
        }
      }

      if (this.ragContext?.snippets?.length) {
        fullContent += this.buildRagCitationBlock(this.ragContext);
        assistantEl.innerHTML = this.renderMarkdown(fullContent);
      }

      this.messages.push({ role: 'assistant', content: fullContent });
      this.lastInputTokens = budgeted.inputTokens;
      this.lastOutputTokens = estimateTextTokens(fullContent);
      await recordUsageDelta({
        chatRequests: 1,
        inputTokens: this.lastInputTokens,
        outputTokens: this.lastOutputTokens,
      });
      this.saveConversation();
      if (this.currentTab === 'tools') {
        void this.refreshUsageMetrics();
      }
    } catch (error) {
      typingEl.remove();
      if (error?.name !== 'AbortError') {
        assistantEl.remove();
        this.appendError(error?.message || 'Chat failed');
        await recordUsageDelta({ errors: 1 });
      }
    } finally {
      if (requestId === this.requestEpoch) {
        this.streaming = false;
        this.streamController = null;
        this.el.sendBtn.disabled = false;
      }
    }
  }

  async getActiveTabContext() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) return null;
      return {
        url: activeTab.url || '',
        title: activeTab.title || '',
      };
    } catch {
      return null;
    }
  }

  async requestRagContext(query) {
    try {
      const pageContext = this.el.tabContextEnabled?.checked ? await this.getActiveTabContext() : null;
      const topK = Math.max(1, Math.min(parseInt(this.el.ragTopK?.value || '5', 10) || 5, 20));

      return await chrome.runtime.sendMessage({
        action: 'rag.query',
        query,
        topK,
        includeTabContext: !!this.el.tabContextEnabled?.checked,
        useZapMemory: !!this.el.ragUseZap?.checked,
        knowledgeBase: this.el.ragKb?.value || '',
        endpoint: this.el.ragEndpoint?.value || '',
        apiKey: this.el.ragApiKey?.value || '',
        pageContext: pageContext || undefined,
      });
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to query RAG' };
    }
  }

  buildRagSystemPrompt(ragResponse) {
    const snippets = (ragResponse?.snippets || []).slice(0, 8);
    const lines = snippets.map((snippet, index) => {
      const title = snippet.title || snippet.source || `Snippet ${index + 1}`;
      const score = typeof snippet.score === 'number' ? ` (score ${snippet.score.toFixed(3)})` : '';
      const sourceLine = snippet.url ? `${title}${score} — ${snippet.url}` : `${title}${score}`;
      return `[${index + 1}] ${sourceLine}\n${snippet.content}`;
    });

    return [
      'You are assisting inside Hanzo Browser Extension.',
      'Use the retrieved context below when relevant, and state uncertainty if context is insufficient.',
      'Retrieved Context:',
      ...lines,
    ].join('\n\n');
  }

  buildRagCitationBlock(ragResponse) {
    const snippets = (ragResponse?.snippets || []).slice(0, 5);
    if (!snippets.length) return '';

    const rows = snippets.map((snippet, index) => {
      const title = snippet.title || snippet.source || `Snippet ${index + 1}`;
      if (snippet.url) {
        return `- ${title}: ${snippet.url}`;
      }
      return `- ${title}`;
    });

    return `\n\n---\nContext Sources:\n${rows.join('\n')}`;
  }

  setRagStatus(text) {
    if (!this.el.ragStatus) return;
    this.el.ragStatus.textContent = text || 'Ready';
  }

  appendMessage(role, content) {
    // Remove welcome message
    const welcome = this.el.chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const div = document.createElement('div');
    div.className = `msg msg-${role}`;
    div.innerHTML = role === 'assistant' ? this.renderMarkdown(content) : this.escapeHtml(content);
    this.el.chatMessages.appendChild(div);
    this.scrollToBottom();
    return div;
  }

  appendError(message) {
    const div = document.createElement('div');
    div.className = 'msg-error';
    div.textContent = message;
    this.el.chatMessages.appendChild(div);
    this.scrollToBottom();
  }

  showTyping() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    this.el.chatMessages.appendChild(div);
    this.scrollToBottom();
    return div;
  }

  scrollToBottom() {
    this.el.chatMessages.scrollTop = this.el.chatMessages.scrollHeight;
  }

  scheduleAutoResize() {
    requestAnimationFrame(() => this.autoResize());
  }

  autoResize() {
    const el = this.el.chatInput;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // Minimal markdown: code blocks, inline code, bold, italic, line breaks
  renderMarkdown(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);

    // Code blocks: ```lang\n...\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code: `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **...**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *...*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async loadConversation() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['hanzo_chat_messages'], (result) => {
        if (result.hanzo_chat_messages?.length) {
          this.messages = result.hanzo_chat_messages;
          // Render stored messages
          const welcome = this.el.chatMessages.querySelector('.chat-welcome');
          if (welcome) welcome.remove();
          for (const msg of this.messages) {
            this.appendMessage(msg.role, msg.content);
          }
        }
        resolve();
      });
    });
  }

  saveConversation() {
    this.persistConversationDebounced();
  }

  // ===========================================================================
  // Tools Tab
  // ===========================================================================

  async connectToMCP() {
    try {
      const zapResponse = await chrome.runtime.sendMessage({ action: 'zap.status' });
      if (zapResponse?.success) {
        const zap = zapResponse.zap;
        const toolCount = zap.mcps?.reduce((sum, m) => sum + (m.tools?.length || 0), 0) || 0;
        this.updateMCPStatus(zap.connected, toolCount, zap.mcps?.length || 0);
        if (zap.connected) {
          const toolsResp = await chrome.runtime.sendMessage({ action: 'zap.listTools' });
          this.updateMCPToolList(toolsResp?.success ? toolsResp.tools : []);
        } else {
          this.updateMCPToolList([]);
        }
      } else {
        this.updateMCPStatus(false);
        this.updateMCPToolList([]);
      }
    } catch {
      this.updateMCPStatus(false);
      this.updateMCPToolList([]);
    }
  }

  updateMCPStatus(connected, toolCount = 0, mcpCount = 0) {
    this.el.mcpStatus.innerHTML = connected ? `
      <span class="status-indicator connected"></span>
      ${mcpCount > 0 ? `ZAP: ${mcpCount} MCP(s)` : 'Connected'}
    ` : `
      <span class="status-indicator disconnected"></span>
      Disconnected
    `;
    this.el.mcpTools.textContent = toolCount;
  }

  // Built-in @hanzo/mcp tool categories (always available)
  static BUILTIN_TOOLS = [
    { category: 'Core', tools: ['read', 'write', 'list', 'info', 'tree', 'create', 'delete', 'move', 'edit', 'patch', 'grep', 'find', 'search', 'bash', 'bg', 'ps', 'logs', 'kill'] },
    { category: 'Intelligence', tools: ['ai', 'ast', 'vector'] },
    { category: 'Workflow', tools: ['todo', 'plan', 'memory', 'mode'] },
    { category: 'Dev', tools: ['vcs', 'refactor'] },
    { category: 'Cloud', tools: ['iam', 'kms', 'paas', 'commerce', 'storage', 'auth', 'api'] },
  ];

  renderBuiltinTools() {
    if (!this.el.builtinToolList) return;

    const totalBuiltin = HanzoSidebar.BUILTIN_TOOLS.reduce((sum, c) => sum + c.tools.length, 0);

    this.el.builtinToolList.innerHTML = HanzoSidebar.BUILTIN_TOOLS.map(cat =>
      `<div class="tool-category">` +
      `<span class="tool-category-name">${this.escapeHtml(cat.category)}</span> ` +
      `<span class="tool-category-tools">${cat.tools.join(', ')}</span>` +
      `</div>`
    ).join('');

    this.updateToolCount(totalBuiltin);
  }

  updateToolCount(builtinCount: number) {
    const zapCount = parseInt(this.el.mcpTools?.textContent || '0') || 0;
    const total = builtinCount + zapCount;
    if (this.el.toolCountBadge) this.el.toolCountBadge.textContent = String(total);
  }

  updateMCPToolList(tools) {
    if (!this.el.mcpToolList) return;
    if (!tools || !tools.length) {
      this.el.mcpToolList.textContent = '';
      return;
    }

    const names = Array.from(new Set(tools.map((tool) => tool.name))).sort();
    const preview = names.slice(0, 20);
    const suffix = names.length > preview.length ? `\n... +${names.length - preview.length} more` : '';
    this.el.mcpToolList.textContent = `ZAP: ${preview.join(', ')}${suffix}`;

    // Update total count
    const builtinCount = HanzoSidebar.BUILTIN_TOOLS.reduce((sum, c) => sum + c.tools.length, 0);
    this.updateToolCount(builtinCount);
  }

  updateMCPServerList(mcps) {
    if (!this.el.mcpServerList) return;
    if (this.el.mcpServerCount) this.el.mcpServerCount.textContent = String(mcps?.length || 0);

    if (!mcps || !mcps.length) {
      this.el.mcpServerList.innerHTML = '<div class="empty-state">No MCP servers connected</div>';
      return;
    }

    this.el.mcpServerList.innerHTML = mcps.map(mcp => `
      <div class="mcp-server-item">
        <div class="mcp-server-info">
          <span class="status-indicator connected"></span>
          <span class="mcp-server-name">${this.escapeHtml(mcp.name || mcp.id)}</span>
        </div>
        <span class="mcp-server-tools">${(mcp.tools?.length || 0)} tools</span>
      </div>
    `).join('');
  }

  // ===========================================================================
  // Element Inspector
  // ===========================================================================

  async pickElement() {
    const btn = this.el.pickElement;
    if (!btn) return;
    btn.classList.toggle('active');

    if (btn.classList.contains('active')) {
      // Inject picker script into active tab
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Remove any existing picker
            document.getElementById('__hanzo_picker_overlay')?.remove();

            const overlay = document.createElement('div');
            overlay.id = '__hanzo_picker_overlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';

            const highlight = document.createElement('div');
            highlight.style.cssText = 'position:fixed;border:2px solid #4CAF50;background:rgba(76,175,80,0.1);pointer-events:none;transition:all 0.1s;z-index:2147483647;border-radius:2px;';
            overlay.appendChild(highlight);

            const label = document.createElement('div');
            label.style.cssText = 'position:fixed;background:#222;color:#fff;font:11px/1.4 monospace;padding:4px 8px;border-radius:4px;z-index:2147483647;pointer-events:none;max-width:300px;word-break:break-all;';
            overlay.appendChild(label);

            let lastTarget: Element | null = null;

            overlay.addEventListener('mousemove', (e) => {
              overlay.style.pointerEvents = 'none';
              const el = document.elementFromPoint(e.clientX, e.clientY);
              overlay.style.pointerEvents = '';
              if (!el || el === overlay) return;
              lastTarget = el;
              const rect = el.getBoundingClientRect();
              highlight.style.left = rect.left + 'px';
              highlight.style.top = rect.top + 'px';
              highlight.style.width = rect.width + 'px';
              highlight.style.height = rect.height + 'px';

              const tag = el.tagName.toLowerCase();
              const id = el.id ? `#${el.id}` : '';
              const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
              const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
              label.textContent = `<${tag}${id}${cls}> ${size}`;
              label.style.left = Math.min(e.clientX + 12, window.innerWidth - 310) + 'px';
              label.style.top = Math.min(e.clientY + 12, window.innerHeight - 30) + 'px';
            });

            overlay.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              overlay.remove();

              if (!lastTarget) return;
              const el = lastTarget;
              const rect = el.getBoundingClientRect();
              const computed = getComputedStyle(el);
              const info = {
                tag: el.tagName.toLowerCase(),
                id: el.id || null,
                classes: el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [],
                text: (el.textContent || '').trim().substring(0, 100),
                href: (el as HTMLAnchorElement).href || null,
                src: (el as HTMLImageElement).src || null,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                styles: {
                  color: computed.color,
                  backgroundColor: computed.backgroundColor,
                  fontSize: computed.fontSize,
                  fontWeight: computed.fontWeight,
                  display: computed.display,
                  position: computed.position,
                },
                selector: (() => {
                  if (el.id) return `#${el.id}`;
                  let s = el.tagName.toLowerCase();
                  if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).join('.');
                  return s;
                })(),
              };

              // Send back to extension
              window.postMessage({ type: '__hanzo_pick_result', info }, '*');
            });

            document.body.appendChild(overlay);

            // ESC to cancel
            const escHandler = (e: KeyboardEvent) => {
              if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); window.postMessage({ type: '__hanzo_pick_result', info: null }, '*'); }
            };
            document.addEventListener('keydown', escHandler);
          },
        });

        // Listen for result from content script
        const resultHandler = (message: any) => {
          if (message.action === 'inspector.pickResult') {
            chrome.runtime.onMessage.removeListener(resultHandler);
            btn.classList.remove('active');
            this.showInspectorResult(message.info);
          }
        };
        chrome.runtime.onMessage.addListener(resultHandler);

        // Also inject a message relay
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.addEventListener('message', (e) => {
              if (e.data?.type === '__hanzo_pick_result') {
                chrome.runtime.sendMessage({ action: 'inspector.pickResult', info: e.data.info });
              }
            }, { once: true });
          },
        });

      } catch (error) {
        debugLog('Pick element failed:', error);
        btn.classList.remove('active');
        this.showNotification('Cannot inspect this page');
      }
    } else {
      // Cancel picker — remove overlay from active tab
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.getElementById('__hanzo_picker_overlay')?.remove(),
          });
        }
      } catch {}
    }
  }

  showInspectorResult(info: any) {
    const el = this.el.inspectorResult;
    if (!el) return;

    if (!info) {
      el.classList.add('hidden');
      return;
    }

    // Build clickable lines — each line copies its value on click
    const copyLine = (label: string, value: string, cssClass?: string) => {
      const escaped = this.escapeHtml(value);
      const cls = cssClass ? ` class="${cssClass}"` : '';
      return `<span${cls} class="copy-line${cssClass ? ' ' + cssClass : ''}" data-copy="${this.escapeHtml(value)}" title="Click to copy">${label ? '<span class="info-label">' + label + '</span>' : ''}${escaped}</span>`;
    };

    const tagStr = `<${info.tag}>`;
    const fullSelector = (info.tag || '') +
      (info.id ? '#' + info.id : '') +
      (info.classes?.length ? '.' + info.classes.join('.') : '');

    const lines: string[] = [];

    // Element tag + id + classes (copies full selector)
    const tagHtml = `<span class="element-tag">&lt;${this.escapeHtml(info.tag)}&gt;</span>`;
    const idHtml = info.id ? `<span class="element-id">#${this.escapeHtml(info.id)}</span>` : '';
    const clsHtml = info.classes?.length ? `<span class="element-class">.${info.classes.map((c: string) => this.escapeHtml(c)).join('.')}</span>` : '';
    lines.push(`<span class="copy-line" data-copy="${this.escapeHtml(fullSelector)}" title="Click to copy selector">${tagHtml}${idHtml}${clsHtml}</span>`);

    // Size
    if (info.rect) {
      lines.push(copyLine('', `${info.rect.w}x${info.rect.h} @ (${info.rect.x}, ${info.rect.y})`, 'element-size'));
    }

    // Selector
    if (info.selector) {
      lines.push(copyLine('Selector: ', info.selector));
    }

    // Text
    if (info.text) {
      lines.push(copyLine('Text: ', `"${info.text.substring(0, 60)}"`));
    }

    // Styles
    if (info.styles) {
      lines.push(copyLine('Font: ', `${info.styles.fontSize} ${info.styles.fontWeight}`));
      lines.push(copyLine('Color: ', info.styles.color));
      lines.push(copyLine('Bg: ', info.styles.backgroundColor));
    }

    el.innerHTML = lines.join('\n');
    el.classList.remove('hidden');

    // Attach click-to-copy handlers
    el.querySelectorAll('.copy-line').forEach((line: Element) => {
      line.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = (line as HTMLElement).dataset.copy || line.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          const original = line.classList.contains('copied');
          line.classList.add('copied');
          setTimeout(() => line.classList.remove('copied'), 800);
          this.showNotification(`Copied: ${text.slice(0, 50)}`);
        }).catch(() => {});
      });
    });
  }

  async takeScreenshot() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const el = this.el.inspectorResult;
      if (el) {
        el.innerHTML = `<img src="${dataUrl}" alt="Screenshot" />\n<span class="element-size">Captured ${new Date().toLocaleTimeString()}</span>`;
        el.classList.remove('hidden');
      }

      // Also copy to clipboard
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.showNotification('Screenshot copied to clipboard');
      } catch {
        this.showNotification('Screenshot captured');
      }
    } catch (error) {
      debugLog('Screenshot failed:', error);
      this.showNotification('Cannot capture this page');
    }
  }

  async runAudit() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const el = this.el.inspectorResult;
      if (el) {
        el.textContent = 'Running audit...';
        el.classList.remove('hidden');
      }

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const audit: any = {};

          // Images without alt
          const imgs = document.querySelectorAll('img:not([alt])');
          audit.missingAlt = imgs.length;

          // Buttons without labels
          const btns = document.querySelectorAll('button:not([aria-label]):not([title])');
          const unlabeledBtns = Array.from(btns).filter(b => !(b.textContent || '').trim());
          audit.unlabeledButtons = unlabeledBtns.length;

          // Links without href
          const emptyLinks = document.querySelectorAll('a:not([href]), a[href=""], a[href="#"]');
          audit.emptyLinks = emptyLinks.length;

          // Form inputs without labels
          const inputs = document.querySelectorAll('input:not([type=hidden]):not([aria-label]):not([title])');
          const unlabeled = Array.from(inputs).filter(i => !document.querySelector(`label[for="${i.id}"]`));
          audit.unlabeledInputs = unlabeled.length;

          // Contrast — check text readability
          audit.totalElements = document.querySelectorAll('*').length;
          audit.headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
          audit.forms = document.querySelectorAll('form').length;

          // Performance hints
          audit.scripts = document.querySelectorAll('script').length;
          audit.stylesheets = document.querySelectorAll('link[rel=stylesheet]').length;
          audit.inlineStyles = document.querySelectorAll('[style]').length;

          return audit;
        },
      });

      if (el && result?.result) {
        const a = result.result;
        const issues: string[] = [];
        if (a.missingAlt) issues.push(`${a.missingAlt} images missing alt text`);
        if (a.unlabeledButtons) issues.push(`${a.unlabeledButtons} buttons without labels`);
        if (a.emptyLinks) issues.push(`${a.emptyLinks} empty/hash links`);
        if (a.unlabeledInputs) issues.push(`${a.unlabeledInputs} inputs without labels`);

        el.innerHTML =
          `<b>Page Audit</b>\n` +
          `Elements: ${a.totalElements} | Headings: ${a.headings} | Forms: ${a.forms}\n` +
          `Scripts: ${a.scripts} | Stylesheets: ${a.stylesheets} | Inline styles: ${a.inlineStyles}\n\n` +
          (issues.length ? `<b>Issues (${issues.length})</b>\n` + issues.map(i => `  - ${i}`).join('\n') : '<span style="color:var(--success)">No accessibility issues found</span>');
      }
    } catch (error) {
      debugLog('Audit failed:', error);
      this.showNotification('Cannot audit this page');
    }
  }

  async refreshUsageMetrics() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'usage.metrics' });
      if (!response?.success || !response.metrics) return;
      const m = response.metrics;
      const requests = m.chatRequests || 0;
      const inputTok = m.inputTokens || 0;
      const outputTok = m.outputTokens || 0;

      // Update counters
      const setText = (id: string, val: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setText('usage-chat-requests', String(requests));
      setText('usage-input-tokens', this.formatTokens(inputTok));
      setText('usage-output-tokens', this.formatTokens(outputTok));
      setText('usage-dedupe', `${m.dedupeHits || 0} dedup`);
      setText('usage-canceled', `${m.canceledRequests || 0} canceled`);

      // Estimate cost (rough: $3/MTok input, $12/MTok output avg)
      const estCost = (inputTok / 1_000_000) * 3 + (outputTok / 1_000_000) * 12;
      setText('usage-est-cost', `$${estCost.toFixed(4)}`);

      // Update progress bars (scale to reasonable session maxes)
      const setBar = (id: string, pct: number) => {
        const el = document.getElementById(id);
        if (el) el.style.width = `${Math.min(pct, 100)}%`;
      };
      setBar('bar-requests', Math.min(requests / 50 * 100, 100));
      setBar('bar-input', Math.min(inputTok / 500_000 * 100, 100));
      setBar('bar-output', Math.min(outputTok / 200_000 * 100, 100));
      setBar('bar-cost', Math.min(estCost / 5 * 100, 100));
    } catch (error) {
      debugLog('Failed to fetch usage metrics:', error);
    }
  }

  formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  async refreshBalance() {
    try {
      const { hanzo_iam_token } = await chrome.storage.local.get('hanzo_iam_token');
      if (!hanzo_iam_token) return;

      const card = document.getElementById('balance-card');
      const amountEl = document.getElementById('balance-amount');
      const tierEl = document.getElementById('balance-tier');
      const tierName = document.getElementById('tier-name');
      const bar = document.getElementById('balance-bar');
      const usedLabel = document.getElementById('balance-used-label');
      const pctLabel = document.getElementById('balance-pct-label');

      // Try fetching from Hanzo Cloud balance API
      const resp = await fetch('https://api.hanzo.ai/v1/balance', {
        headers: { Authorization: `Bearer ${hanzo_iam_token}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      if (resp?.ok) {
        const data = await resp.json();
        const credits = data.tokenCredits || 0;
        const usd = credits / 1_000_000;
        const tier = data.tierId || 'free';
        const startBalance = data.startBalance || credits || 5_000_000;
        const startUsd = startBalance / 1_000_000;
        const usedUsd = Math.max(0, startUsd - usd);
        const pct = startUsd > 0 ? Math.min((usedUsd / startUsd) * 100, 100) : 0;

        if (card) card.classList.remove('hidden');
        if (amountEl) amountEl.textContent = `$${usd.toFixed(2)}`;
        if (tierEl && tier && tier !== 'unknown') {
          tierEl.classList.remove('hidden');
          if (tierName) tierName.textContent = tier;
        }
        if (bar) bar.style.width = `${pct}%`;
        if (usedLabel) usedLabel.textContent = `$${usedUsd.toFixed(2)} used`;
        if (pctLabel) pctLabel.textContent = `${Math.round(pct)}%`;

        // Color the bar based on usage
        if (bar) {
          bar.className = `usage-bar-fill ${pct >= 90 ? 'bar-red' : pct >= 70 ? 'bar-amber' : 'bar-blue'}`;
        }
      }
    } catch (error) {
      debugLog('Failed to fetch balance:', error);
    }
  }

  async refreshModelHub() {
    try {
      const listEl = document.getElementById('model-hub-list');
      if (!listEl) return;

      const response = await chrome.runtime.sendMessage({ action: 'hub.allModels' });
      if (!response?.success) return;

      const items: string[] = [];

      // Cloud models
      for (const m of (response.cloud || []).slice(0, 10)) {
        items.push(`
          <div class="model-hub-item" data-model-id="${this.escapeHtml(m.id)}" data-provider="cloud">
            <div class="model-hub-item-info">
              <div class="model-hub-item-name">${this.escapeHtml(m.name || m.id)}</div>
              <div class="model-hub-item-meta">
                <span>${this.escapeHtml(m.owned_by || 'hanzo')}</span>
              </div>
            </div>
            <span class="model-hub-item-badge badge-cloud">Cloud</span>
          </div>
        `);
      }

      // Local models
      for (const m of (response.local || [])) {
        const size = m.size ? ` · ${this.formatBytes(m.size)}` : '';
        items.push(`
          <div class="model-hub-item" data-model-id="${this.escapeHtml(m.id)}" data-provider="local">
            <div class="model-hub-item-info">
              <div class="model-hub-item-name">${this.escapeHtml(m.name || m.id)}</div>
              <div class="model-hub-item-meta">
                <span>${this.escapeHtml(m.provider || 'ollama')}${size}</span>
              </div>
            </div>
            <span class="model-hub-item-badge badge-local">Local</span>
          </div>
        `);
      }

      // Recommended (HF)
      for (const m of (response.recommended || []).slice(0, 4)) {
        items.push(`
          <div class="model-hub-item" data-model-id="${this.escapeHtml(m.id)}" data-provider="hub">
            <div class="model-hub-item-info">
              <div class="model-hub-item-name">${this.escapeHtml(m.name)}</div>
              <div class="model-hub-item-meta">
                <span>${this.escapeHtml(m.author)}</span>
              </div>
            </div>
            <span class="model-hub-item-badge badge-hub">HF</span>
          </div>
        `);
      }

      listEl.innerHTML = items.length > 0
        ? items.join('')
        : '<div class="empty-state">No models found</div>';

      // Also update the model-select dropdown dynamically
      this.updateModelSelect(response.cloud || [], response.local || []);
    } catch (error) {
      debugLog('Failed to refresh model hub:', error);
    }
  }

  updateModelSelect(cloud: any[], local: any[]) {
    const select = this.el.modelSelect as HTMLSelectElement;
    if (!select) return;

    // Save current selection
    const currentVal = select.value;

    // Clear except "Auto"
    while (select.options.length > 1) select.remove(1);

    // Add cloud models
    if (cloud.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Cloud';
      for (const m of cloud.slice(0, 20)) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }

    // Add local models
    if (local.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Local';
      for (const m of local) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }

    // Restore selection
    if (currentVal) select.value = currentVal;
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(0)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }

  async searchModels(query: string) {
    const listEl = document.getElementById('model-hub-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state">Searching...</div>';

    try {
      const [hfResp, ollamaResp] = await Promise.all([
        chrome.runtime.sendMessage({ action: 'hub.searchGGUF', query, limit: 8 }),
        chrome.runtime.sendMessage({ action: 'hub.searchOllama', query }),
      ]);

      const items: string[] = [];
      for (const m of (hfResp?.models || [])) {
        items.push(`
          <div class="model-hub-item" data-model-id="${this.escapeHtml(m.id)}" data-provider="hub">
            <div class="model-hub-item-info">
              <div class="model-hub-item-name">${this.escapeHtml(m.name)}</div>
              <div class="model-hub-item-meta">
                <span>${this.escapeHtml(m.author)}</span>
                <span>↓ ${m.downloads || 0}</span>
              </div>
            </div>
            <span class="model-hub-item-badge badge-hub">HF</span>
          </div>
        `);
      }
      for (const m of (ollamaResp?.models || [])) {
        items.push(`
          <div class="model-hub-item" data-model-id="${this.escapeHtml(m.id)}" data-provider="ollama">
            <div class="model-hub-item-info">
              <div class="model-hub-item-name">${this.escapeHtml(m.name)}</div>
              <div class="model-hub-item-meta">
                <span>${this.escapeHtml(m.description || '')}</span>
              </div>
            </div>
            <span class="model-hub-item-badge badge-local">Ollama</span>
          </div>
        `);
      }

      listEl.innerHTML = items.length > 0
        ? items.join('')
        : '<div class="empty-state">No models found</div>';
    } catch (error) {
      listEl.innerHTML = '<div class="empty-state">Search failed</div>';
    }
  }

  async refreshTabFilesystem() {
    try {
      const tabs = await chrome.tabs.query({});
      this.el.tabFs.innerHTML = tabs.map((tab, i) => `
        <div class="tab-item ${tab.active ? 'active' : ''}" data-tab-id="${tab.id}">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2v12h12V2H2zm1 1h10v10H3V3z"/>
          </svg>
          <span title="${this.escapeHtml(tab.url || '')}">/tabs/${i}/${this.sanitizePath(tab.title || 'untitled')}</span>
        </div>
      `).join('');

      this.el.tabFs.querySelectorAll('.tab-item').forEach(item => {
        item.addEventListener('click', () => {
          chrome.tabs.update(parseInt(item.dataset.tabId), { active: true });
        });
      });
    } catch {}
  }

  sanitizePath(title) {
    return title.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase().substring(0, 30);
  }

  async checkHanzoServices() {
    // Check hanzo node (default port 52415)
    const nodePort = parseInt(document.getElementById('node-port-setting')?.value || '52415') || 52415;
    try {
      const resp = await fetch(`http://localhost:${nodePort}/health`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        if (this.el.hanzoNodeStatus) this.el.hanzoNodeStatus.innerHTML = `<span class="status-indicator connected"></span> Running`;
        if (this.el.startHanzoNode) { this.el.startHanzoNode.textContent = 'Running'; this.el.startHanzoNode.disabled = true; }
      } else {
        if (this.el.hanzoNodeStatus) this.el.hanzoNodeStatus.innerHTML = `<span class="status-indicator disconnected"></span> Stopped`;
        if (this.el.startHanzoNode) this.el.startHanzoNode.disabled = false;
      }
    } catch {
      if (this.el.hanzoNodeStatus) this.el.hanzoNodeStatus.innerHTML = `<span class="status-indicator disconnected"></span> Stopped`;
      if (this.el.startHanzoNode) this.el.startHanzoNode.disabled = false;
    }

    // Check hanzo bot/MCP via ZAP status
    const mcpServers: Array<{ id: string; name: string; tools: string[] }> = [];

    try {
      const zapResp = await chrome.runtime.sendMessage({ action: 'zap.status' });
      const hasTools = zapResp?.success && zapResp.zap?.connected;
      if (this.el.hanzoMcpStatus) {
        this.el.hanzoMcpStatus.innerHTML = hasTools
          ? `<span class="status-indicator connected"></span> Running`
          : `<span class="status-indicator disconnected"></span> Stopped`;
      }
      if (this.el.startHanzoMcp) {
        this.el.startHanzoMcp.disabled = !!hasTools;
        if (hasTools) this.el.startHanzoMcp.textContent = 'Running';
      }

      // Collect ZAP-discovered MCP servers
      if (zapResp?.success && zapResp.zap?.mcps?.length) {
        mcpServers.push(...zapResp.zap.mcps);
      }
    } catch {
      if (this.el.hanzoMcpStatus) {
        this.el.hanzoMcpStatus.innerHTML = `<span class="status-indicator disconnected"></span> Stopped`;
      }
    }

    // Check CDP bridge (hanzo-mcp browser tools connection)
    try {
      const bridgeResp = await chrome.runtime.sendMessage({ action: 'bridge.status' });
      if (bridgeResp?.success && bridgeResp.connected) {
        mcpServers.push({
          id: 'cdp-bridge',
          name: 'Hanzo MCP (CDP Bridge)',
          tools: ['browser', 'navigate', 'screenshot', 'click', 'evaluate', 'fill', 'url', 'title'],
        });
      }
    } catch {}

    // Also probe hanzo-mcp HTTP bridge directly (port 9224)
    try {
      const bridgeHttp = await fetch('http://localhost:9224', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
        signal: AbortSignal.timeout(2000),
      });
      if (bridgeHttp.ok) {
        const data = await bridgeHttp.json();
        if (data.success && !mcpServers.find(m => m.id === 'cdp-bridge')) {
          mcpServers.push({
            id: 'hanzo-mcp-http',
            name: 'Hanzo MCP (HTTP :9224)',
            tools: ['browser', 'navigate', 'screenshot', 'evaluate', 'click'],
          });
        }
      }
    } catch {}

    this.updateMCPServerList(mcpServers);
  }

  async startHanzoService(service: string) {
    const commands = {
      node: 'hanzo node --port 52415',
      bot: 'npx @hanzo/mcp serve',
    };
    const labels = { node: 'Hanzo Node', bot: 'Hanzo Bot' };
    const cmd = commands[service] || commands.node;
    const label = labels[service] || service;

    // Try native messaging or CDP bridge first
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'cdp.exec',
        command: cmd,
      });
      if (response?.success) {
        this.showNotification(`Starting ${label}...`);
        setTimeout(() => this.checkHanzoServices(), 3000);
        return;
      }
    } catch {}

    // Fallback: show the command to run with a copy-friendly notification
    this.showNotification(`Run in terminal: ${cmd}`);

    // Also try to open docs
    const docsSection = service === 'bot' ? 'mcp' : service;
    chrome.tabs.create({ url: `https://docs.hanzo.ai/cli#${docsSection}` });
  }

  updateAgentList() {
    const arr = Array.from(this.agents.values());
    this.el.agentCount.textContent = arr.length;
    if (arr.length === 0) {
      this.el.agentList.innerHTML = '<div class="empty-state">No active agents</div>';
      return;
    }
    this.el.agentList.innerHTML = arr.map(a => `
      <div class="agent-item">
        <div class="agent-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" stroke-width="2"/>
            <path d="M12 6v6l4 2" stroke-width="2"/>
          </svg>
        </div>
        <div class="agent-info">
          <div class="agent-name">${this.escapeHtml(a.name)}</div>
          <div class="agent-status">${a.status} • Tab ${a.tabId}</div>
        </div>
        <div class="agent-actions">
          <button class="icon-btn small" data-stop="${a.id}" title="Stop">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="4" width="8" height="8" stroke-width="2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    this.el.agentList.querySelectorAll('[data-stop]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.stop;
        chrome.runtime.sendMessage({ action: 'stopAgent', agentId: id });
        this.agents.delete(id);
        this.updateAgentList();
      });
    });
  }

  showAgentLauncher() {
    // Create agent launcher modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Launch Agent</h3>
          <button class="icon-btn close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <label class="setting-item">
            <span>Target Tab</span>
            <select id="agent-tab-select">
              <option value="active">Active Tab</option>
            </select>
          </label>
          <label class="setting-item">
            <span>Agent Type</span>
            <select id="agent-type-select">
              <option value="browser-control">Browser Automation</option>
              <option value="page-analyzer">Page Analyzer</option>
              <option value="form-filler">Form Filler</option>
              <option value="data-extractor">Data Extractor</option>
            </select>
          </label>
          <label class="setting-item">
            <span>Instructions</span>
            <textarea id="agent-instructions" rows="3" placeholder="Describe what the agent should do..."></textarea>
          </label>
        </div>
        <div class="modal-footer">
          <button class="secondary-btn cancel-modal">Cancel</button>
          <button class="primary-btn launch-modal">Launch</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Populate tabs
    chrome.tabs.query({}, (tabs) => {
      const select = overlay.querySelector('#agent-tab-select');
      tabs.forEach(tab => {
        if (tab.id) {
          const opt = document.createElement('option');
          opt.value = tab.id;
          opt.textContent = `${tab.title?.substring(0, 40) || 'Untitled'} ${tab.active ? '(active)' : ''}`;
          select.appendChild(opt);
        }
      });
    });

    // Close handlers
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-modal').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Launch handler
    overlay.querySelector('.launch-modal').addEventListener('click', async () => {
      const tabSelect = overlay.querySelector('#agent-tab-select');
      const typeSelect = overlay.querySelector('#agent-type-select');
      const instructions = overlay.querySelector('#agent-instructions');

      let tabId;
      if (tabSelect.value === 'active') {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      } else {
        tabId = parseInt(tabSelect.value);
      }

      if (!tabId) {
        this.showError('No tab selected');
        return;
      }

      const agentType = typeSelect.value;
      const agentInstructions = instructions.value?.trim() || '';
      overlay.remove();

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'launchAIWorker',
          tabId,
          model: agentType,
          instructions: agentInstructions,
        });

        if (response?.success) {
          const agentId = response.agentId || `agent-${Date.now().toString(36)}`;
          this.agents.set(agentId, {
            id: agentId,
            name: agentType,
            tabId,
            status: 'running',
          });
          this.updateAgentList();
          this.showNotification(`Agent launched on tab ${tabId}`);
        } else {
          this.showError(response?.error || 'Failed to launch agent');
        }
      } catch (error) {
        this.showError('Failed to launch agent: ' + error.message);
      }
    });
  }

  // ===========================================================================
  // Settings Tab
  // ===========================================================================

  loadSettings() {
    chrome.storage.local.get([
      'mcpPort',
      'cdpPort',
      'zapPorts',
      'nodePort',
      'hanzo_default_model',
      'hanzo_rag_endpoint',
      'hanzo_rag_api_key',
      'hanzo_rag_kb',
      'hanzo_rag_top_k',
      'hanzo_rag_include_tab_context',
      'hanzo_rag_use_zap',
      'hanzo_chat_rag_enabled',
      'hanzo_chat_tab_context_enabled',
    ], (result) => {
      const mcpPort = document.getElementById('mcp-port-setting');
      const cdpPort = document.getElementById('cdp-port-setting');
      const zapPorts = document.getElementById('zap-ports-setting');
      const nodePort = document.getElementById('node-port-setting');

      if (mcpPort) mcpPort.value = result.mcpPort || 3001;
      if (cdpPort) cdpPort.value = result.cdpPort || 9223;
      if (zapPorts) zapPorts.value = (result.zapPorts || [9999,9998,9997,9996,9995]).join(',');
      if (nodePort) nodePort.value = result.nodePort || 52415;
      if (result.hanzo_default_model && this.el.defaultModel) {
        this.el.defaultModel.value = result.hanzo_default_model;
      }

      if (this.el.ragEndpoint) this.el.ragEndpoint.value = result.hanzo_rag_endpoint || '';
      if (this.el.ragApiKey) this.el.ragApiKey.value = result.hanzo_rag_api_key || '';
      if (this.el.ragKb) this.el.ragKb.value = result.hanzo_rag_kb || '';
      if (this.el.ragTopK) this.el.ragTopK.value = String(result.hanzo_rag_top_k || 5);
      if (this.el.ragIncludeTabContext) this.el.ragIncludeTabContext.checked = result.hanzo_rag_include_tab_context !== false;
      if (this.el.ragUseZap) this.el.ragUseZap.checked = result.hanzo_rag_use_zap !== false;
      if (this.el.ragEnabled) this.el.ragEnabled.checked = result.hanzo_chat_rag_enabled !== false;
      if (this.el.tabContextEnabled) this.el.tabContextEnabled.checked = result.hanzo_chat_tab_context_enabled !== false;
      this.setRagStatus(this.el.ragEnabled?.checked ? 'Ready' : 'RAG disabled');
    });

    this.populateBuildInfo();
  }

  async populateBuildInfo() {
    // Extension version from manifest
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version || 'unknown';
    const manifestVersion = `MV${manifest.manifest_version}`;

    if (this.el.buildExtVersion) this.el.buildExtVersion.textContent = `v${version}`;
    if (this.el.buildManifest) this.el.buildManifest.textContent = manifestVersion;

    // Browser detection
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Firefox/')) {
      const match = ua.match(/Firefox\/([\d.]+)/);
      browser = `Firefox ${match?.[1] || ''}`;
    } else if (ua.includes('Edg/')) {
      const match = ua.match(/Edg\/([\d.]+)/);
      browser = `Edge ${match?.[1] || ''}`;
    } else if (ua.includes('Chrome/')) {
      const match = ua.match(/Chrome\/([\d.]+)/);
      browser = `Chrome ${match?.[1] || ''}`;
    } else if (ua.includes('Safari/')) {
      const match = ua.match(/Version\/([\d.]+)/);
      browser = `Safari ${match?.[1] || ''}`;
    }
    if (this.el.buildBrowser) this.el.buildBrowser.textContent = browser;

    // Footer version
    if (this.el.footerVersion) this.el.footerVersion.textContent = `hanzo.ai v${version}`;

    // CDP bridge status
    try {
      const bridgeResp = await chrome.runtime.sendMessage({ action: 'bridge.status' });
      if (this.el.buildCdpStatus) {
        this.el.buildCdpStatus.innerHTML = bridgeResp?.connected
          ? `<span class="status-indicator connected"></span> Connected`
          : `<span class="status-indicator disconnected"></span> Disconnected`;
      }
    } catch {
      if (this.el.buildCdpStatus) this.el.buildCdpStatus.innerHTML = `<span class="status-indicator disconnected"></span> Unavailable`;
    }

    // MCP HTTP bridge (port 9224)
    try {
      const resp = await fetch('http://localhost:9224', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (this.el.buildMcpStatus) {
          this.el.buildMcpStatus.innerHTML = `<span class="status-indicator connected"></span> :9224 OK`;
        }
      } else {
        if (this.el.buildMcpStatus) this.el.buildMcpStatus.innerHTML = `<span class="status-indicator disconnected"></span> :9224 Error`;
      }
    } catch {
      if (this.el.buildMcpStatus) this.el.buildMcpStatus.innerHTML = `<span class="status-indicator disconnected"></span> :9224 Offline`;
    }
  }

  async saveSettings() {
    const mcpPort = parseInt(document.getElementById('mcp-port-setting')?.value) || 3001;
    const cdpPort = parseInt(document.getElementById('cdp-port-setting')?.value) || 9223;
    const zapPorts = (document.getElementById('zap-ports-setting')?.value || '')
      .split(',').map(p => parseInt(p.trim())).filter(p => p > 0 && p < 65536);

    const nodePort = parseInt(document.getElementById('node-port-setting')?.value) || 52415;

    await chrome.storage.local.set({
      mcpPort,
      cdpPort,
      nodePort,
      zapPorts: zapPorts.length ? zapPorts : [9999,9998,9997,9996,9995],
      hanzo_default_model: this.el.defaultModel?.value || 'auto',
      'safe-mode': document.getElementById('safe-mode')?.checked,
      'enable-webgpu': document.getElementById('enable-webgpu')?.checked,
      maxAgents: parseInt(document.getElementById('max-agents')?.value) || 3,
      hanzo_rag_endpoint: this.el.ragEndpoint?.value?.trim() || '',
      hanzo_rag_api_key: this.el.ragApiKey?.value?.trim() || '',
      hanzo_rag_kb: this.el.ragKb?.value?.trim() || '',
      hanzo_rag_top_k: Math.max(1, Math.min(parseInt(this.el.ragTopK?.value || '5', 10) || 5, 20)),
      hanzo_rag_include_tab_context: !!this.el.ragIncludeTabContext?.checked,
      hanzo_rag_use_zap: !!this.el.ragUseZap?.checked,
      hanzo_chat_rag_enabled: !!this.el.ragEnabled?.checked,
      hanzo_chat_tab_context_enabled: !!this.el.tabContextEnabled?.checked,
    });

    // Sync settings to ~/.hanzo/extension/config.json via CDP bridge
    chrome.runtime.sendMessage({
      action: 'settings.sync',
      settings: {
        mcpPort,
        cdpPort,
        nodePort,
        zapPorts: zapPorts.length ? zapPorts : [9999,9998,9997,9996,9995],
        defaultModel: this.el.defaultModel?.value || 'auto',
        safeMode: !!document.getElementById('safe-mode')?.checked,
        maxAgents: parseInt(document.getElementById('max-agents')?.value) || 3,
        enableWebGPU: !!document.getElementById('enable-webgpu')?.checked,
      },
    }).catch(() => {});

    this.showNotification('Settings saved');
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  startMonitoring() {
    if (this.monitoringStarted) return;
    this.monitoringStarted = true;

    setInterval(() => {
      if (this.currentTab !== 'tools') return;
      void this.connectToMCP();
      void this.checkHanzoServices();
      void this.refreshUsageMetrics();
    }, 15000);
  }

  handleMessage(request) {
    switch (request.action) {
      case 'agentUpdate':
        if (request.agentId && this.agents.has(request.agentId)) {
          this.agents.get(request.agentId).status = request.status;
          this.updateAgentList();
        }
        break;
    }
  }

  showNotification(message) {
    const el = document.createElement('div');
    el.className = 'notification';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  showError(message) {
    const el = document.createElement('div');
    el.className = 'notification error';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
}

// Initialize
const hanzoSidebar = new HanzoSidebar();
