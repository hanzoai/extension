// Hanzo AI — Popup Script
// Uses background message passing for auth (not direct storage access).

import {
  DEFAULT_INSPECT_SHORTCUT,
  formatShortcut,
  loadInspectShortcut,
  saveInspectShortcut,
  shortcutFromEvent,
  type Shortcut,
} from './shared/shortcut.js';

declare const browser: typeof chrome & {
  sidebarAction?: {
    open(): Promise<void>;
    close(): Promise<void>;
    toggle(): Promise<void>;
  };
};

document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const mainSection = document.getElementById('main-section');
  const settingsSection = document.getElementById('settings-section');

  // Auth
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

  // Open panel
  const openPanel = document.getElementById('open-panel');
  const openPageOverlay = document.getElementById('open-page-overlay');

  // Status dots
  const zapStatus = document.getElementById('zap-status');
  const zapDetail = document.getElementById('zap-detail');
  const mcpStatus = document.getElementById('mcp-status');
  const mcpPort = document.getElementById('mcp-port');
  const cdpStatus = document.getElementById('cdp-status');
  const cdpDetail = document.getElementById('cdp-detail');
  const gpuStatus = document.getElementById('gpu-status');
  const gpuDetail = document.getElementById('gpu-detail');

  // Settings
  const openSettings = document.getElementById('open-settings');
  const backBtn = document.getElementById('back-btn');
  const saveSettings = document.getElementById('save-settings');
  const testConnection = document.getElementById('test-connection');

  const userInfoSection = document.getElementById('user-info-section');

  // --- Auth via background ---
  function checkAuth() {
    // Always show main section and status (tools work without login)
    mainSection.classList.remove('hidden');
    refreshStatus();

    chrome.runtime.sendMessage({ action: 'auth.status' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success && response.authenticated) {
        loginSection.classList.add('hidden');
        userInfoSection?.classList.remove('hidden');
        if (response.user) {
          const avatar = document.getElementById('user-avatar') as HTMLImageElement;
          const name = document.getElementById('user-name');
          const email = document.getElementById('user-email');
          avatar.src = response.user.picture || response.user.avatar || 'icon48.png';
          name.textContent = response.user.name || response.user.displayName || 'Hanzo User';
          email.textContent = response.user.email || '';
        }
      } else {
        loginSection.classList.remove('hidden');
        userInfoSection?.classList.add('hidden');
      }
    });
  }

  loginBtn?.addEventListener('click', () => {
    (loginBtn as HTMLButtonElement).disabled = true;
    loginBtn.textContent = 'Signing in...';
    chrome.runtime.sendMessage({ action: 'auth.login' }, (response) => {
      (loginBtn as HTMLButtonElement).disabled = false;
      loginBtn.textContent = 'Sign In';
      if (response?.success) {
        checkAuth();
      }
    });
  });

  // Signup button in login card
  const signupBtnPopup = document.getElementById('signup-btn-popup');
  signupBtnPopup?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'auth.signup' });
  });

  logoutBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'auth.logout' }, () => {
      loginSection.classList.remove('hidden');
      userInfoSection?.classList.add('hidden');
    });
  });

  // --- Open side panel ---
  openPanel?.addEventListener('click', () => {
    if (chrome.sidePanel) {
      // Chrome / Edge: use sidePanel API
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.sidePanel.open({ tabId: tabs[0].id });
          window.close();
        }
      });
    } else if (typeof browser !== 'undefined' && browser.sidebarAction) {
      // Firefox: use sidebarAction API
      browser.sidebarAction.open();
      window.close();
    } else {
      // Fallback: try opening sidebar.html as a new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('sidebar.html') });
      window.close();
    }
  });

  function isInjectableTab(tab: chrome.tabs.Tab | undefined): boolean {
    if (!tab || !tab.id) return false;
    const url = tab.url || '';
    if (!url) return false;
    if (url.startsWith('chrome://')) return false;
    if (url.startsWith('chrome-extension://')) return false;
    if (url.startsWith('devtools://')) return false;
    if (url.startsWith('edge://')) return false;
    if (url.startsWith('about:')) return false;
    if (url.startsWith('view-source:')) return false;
    if (url.startsWith('moz-extension://')) return false;
    return true;
  }

  openPageOverlay?.addEventListener('click', () => {
    openPageOverlay.textContent = 'Opening...';
    openPageOverlay.setAttribute('disabled', 'true');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      let targetTab = isInjectableTab(activeTab) ? activeTab : null;

      if (!targetTab) {
        chrome.tabs.query({ currentWindow: true }, (allTabs) => {
          targetTab = allTabs.find((tab) => isInjectableTab(tab)) || null;
          if (!targetTab?.id) {
            openPageOverlay.textContent = 'No valid page tab';
            setTimeout(() => {
              openPageOverlay.textContent = 'Toggle On-Page Overlay';
              openPageOverlay.removeAttribute('disabled');
            }, 1200);
            return;
          }

          chrome.runtime.sendMessage({ action: 'page.overlay.toggle', tabId: targetTab.id }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
              openPageOverlay.textContent = 'Unavailable on this page';
            } else {
              const opened = !!response?.open;
              openPageOverlay.textContent = opened ? 'Overlay Opened' : 'Overlay Hidden';
            }
            setTimeout(() => {
              openPageOverlay.textContent = 'Toggle On-Page Overlay';
              openPageOverlay.removeAttribute('disabled');
            }, 900);
          });
        });
        return;
      }

      if (!targetTab?.id) {
        openPageOverlay.textContent = 'No Active Tab';
        setTimeout(() => {
          openPageOverlay.textContent = 'Toggle On-Page Overlay';
          openPageOverlay.removeAttribute('disabled');
        }, 1200);
        return;
      }

      chrome.runtime.sendMessage({ action: 'page.overlay.toggle', tabId: targetTab.id }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          openPageOverlay.textContent = 'Unavailable on this page';
        } else {
          const opened = !!response?.open;
          openPageOverlay.textContent = opened ? 'Overlay Opened' : 'Overlay Hidden';
        }
        setTimeout(() => {
          openPageOverlay.textContent = 'Toggle On-Page Overlay';
          openPageOverlay.removeAttribute('disabled');
        }, 900);
      });
    });
  });

  // --- Status ---
  function setStatus(dot: HTMLElement, detail: HTMLElement, connected: boolean, text: string) {
    dot.classList.toggle('connected', connected);
    dot.classList.toggle('disconnected', !connected);
    detail.textContent = text;
  }

  function refreshStatus() {
    // ZAP Bridge
    chrome.runtime.sendMessage({ action: 'zap.status' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success) {
        const zap = response.zap;
        if (zap.connected) {
          const mcpCount = zap.mcps?.length || 0;
          const toolCount = zap.mcps?.reduce((sum: number, m: any) => sum + (m.tools?.length || 0), 0) || 0;
          setStatus(zapStatus, zapDetail, true, `${mcpCount} MCP, ${toolCount} tools`);
        } else {
          setStatus(zapStatus, zapDetail, false, 'Not connected');
        }
      }
    });

    // CDP Bridge
    chrome.runtime.sendMessage({ action: 'bridge.status' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success && response.connected) {
        const browsers = response.browsers || [];
        setStatus(cdpStatus, cdpDetail, true, browsers.length ? `Connected` : 'Connected');
      } else {
        setStatus(cdpStatus, cdpDetail, false, 'Not connected');
      }
    });

    // MCP Bridge — probe the configured port (default 9224 for hanzo-mcp HTTP).
    // Falls back to 9224 only if storage hasn't been written yet, but always
    // SHOWS the actual port that was probed so the user isn't lied to.
    chrome.storage.local.get(['mcpBridgePort'], (s) => {
      const probePort = Number(s.mcpBridgePort) || 9224;
      const url = `http://localhost:${probePort}`;
      const offline = () => setStatus(mcpStatus, mcpPort, false, `:${probePort} offline`);
      try {
        fetch(url, { signal: AbortSignal.timeout(2000) })
          .then(r => r.json())
          .then(data => {
            if (data?.service === 'hanzo.browser') {
              setStatus(mcpStatus, mcpPort, true, `:${probePort} OK`);
            } else {
              setStatus(mcpStatus, mcpPort, false, `:${probePort} N/A`);
            }
          })
          .catch(offline);
      } catch {
        offline();
      }
    });

    // WebGPU
    chrome.runtime.sendMessage({ action: 'runLocalAI', prompt: '' }, (response) => {
      if (chrome.runtime.lastError) return;
      setStatus(gpuStatus, gpuDetail, !!response?.success, response?.success ? 'Available' : 'Not available');
    });
  }

  // --- Settings ---
  openSettings?.addEventListener('click', () => {
    mainSection.classList.add('hidden');
    settingsSection.classList.remove('hidden');
    loadSettings();
  });

  backBtn?.addEventListener('click', () => {
    settingsSection.classList.add('hidden');
    mainSection.classList.remove('hidden');
  });

  function loadSettings() {
    chrome.storage.local.get(['mcpPort', 'cdpPort', 'zapPorts'], (result) => {
      const mcpPortInput = document.getElementById('mcp-port-setting') as HTMLInputElement | null;
      const cdpPortInput = document.getElementById('cdp-port-setting') as HTMLInputElement | null;
      const zapPortsInput = document.getElementById('zap-ports-setting') as HTMLInputElement | null;

      if (mcpPortInput) mcpPortInput.value = String(result.mcpPort || 3001);
      if (cdpPortInput) cdpPortInput.value = String(result.cdpPort || 9223);
      if (zapPortsInput) zapPortsInput.value = (result.zapPorts || [9999, 9998, 9997, 9996, 9995]).join(',');
    });

    // Inspect-modifier display + recorder.
    refreshShortcutDisplay();
  }

  // ── Inspect Shortcut Recorder ─────────────────────────────────────────
  // Shows the current chord; clicking "Record" captures a single keydown
  // and saves the resulting Shortcut to chrome.storage.local. Content
  // scripts watch storage for changes and update without page reload.
  let recordingShortcut = false;
  let recordingHandler: ((e: KeyboardEvent) => void) | null = null;

  async function refreshShortcutDisplay() {
    const display = document.getElementById('inspect-shortcut-display');
    const settingsDisplay = document.getElementById('inspect-shortcut-current');
    const s = await loadInspectShortcut(chrome.storage.local as any);
    const text = formatShortcut(s);
    if (display) display.textContent = text;
    if (settingsDisplay) settingsDisplay.textContent = text;
  }
  // Initial render before settings panel is opened (header chip).
  refreshShortcutDisplay();

  function startRecording(label: HTMLElement) {
    if (recordingShortcut) return;
    recordingShortcut = true;
    label.textContent = 'Press a key…';
    recordingHandler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const next = shortcutFromEvent(e);
      if (!next) {
        // Tab/Esc pressed — bail out without saving.
        stopRecording();
        return;
      }
      await saveInspectShortcut(chrome.storage.local as any, next);
      stopRecording();
      refreshShortcutDisplay();
    };
    document.addEventListener('keydown', recordingHandler, { capture: true });
    // Safety: cancel recording after 10s in case the user wanders off.
    setTimeout(() => { if (recordingShortcut) stopRecording(); }, 10000);
  }

  function stopRecording() {
    if (recordingHandler) document.removeEventListener('keydown', recordingHandler, { capture: true });
    recordingHandler = null;
    recordingShortcut = false;
    refreshShortcutDisplay();
  }

  document.getElementById('record-inspect-shortcut')?.addEventListener('click', (e) => {
    e.preventDefault();
    const display = document.getElementById('inspect-shortcut-display');
    if (display) startRecording(display);
  });
  document.getElementById('inspect-shortcut-record')?.addEventListener('click', (e) => {
    e.preventDefault();
    const display = document.getElementById('inspect-shortcut-current');
    if (display) startRecording(display);
  });
  document.getElementById('inspect-shortcut-reset')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await saveInspectShortcut(chrome.storage.local as any, { ...DEFAULT_INSPECT_SHORTCUT });
    refreshShortcutDisplay();
  });

  saveSettings?.addEventListener('click', () => {
    const mcpPortVal = parseInt(document.getElementById('mcp-port-setting')?.value) || 3001;
    const cdpPortVal = parseInt(document.getElementById('cdp-port-setting')?.value) || 9223;
    const zapPortsVal = (document.getElementById('zap-ports-setting')?.value || '')
      .split(',').map(p => parseInt(p.trim())).filter(p => p > 0 && p < 65536);

    chrome.storage.local.set({
      mcpPort: mcpPortVal,
      cdpPort: cdpPortVal,
      zapPorts: zapPortsVal.length ? zapPortsVal : [9999, 9998, 9997, 9996, 9995],
    }, () => {
      saveSettings.textContent = 'Saved!';
      setTimeout(() => { saveSettings.textContent = 'Save Settings'; }, 1500);
    });
  });

  // --- Test Connection ---
  testConnection?.addEventListener('click', () => {
    testConnection.textContent = 'Testing...';
    testConnection.disabled = true;

    chrome.runtime.sendMessage({ action: 'zap.discover' }, () => {
      refreshStatus();
      testConnection.textContent = 'Test Connection';
      testConnection.disabled = false;
    });
  });

  // Feature toggles
  ['source-maps', 'webgpu-ai', 'browser-control', 'tab-filesystem'].forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      chrome.storage.local.get([id], (result) => {
        checkbox.checked = result[id] !== false; // default on
      });
      checkbox.addEventListener('change', () => {
        chrome.storage.local.set({ [id]: checkbox.checked });
      });
    }
  });

  // --- Browser Backend Picker ---
  const backendSelect = document.getElementById('browser-backend') as HTMLSelectElement | null;
  const bridgeStatus = document.getElementById('bridge-status');
  const bridgeDetail = document.getElementById('bridge-detail');

  function loadBackendPreference() {
    chrome.storage.sync.get(['browserBackend'], (result) => {
      if (backendSelect && result.browserBackend) {
        backendSelect.value = result.browserBackend;
      }
    });
  }

  function refreshBridgeStatus() {
    chrome.runtime.sendMessage({ action: 'bridge.status' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success && response.connected) {
        bridgeStatus?.classList.add('connected');
        bridgeStatus?.classList.remove('disconnected');
        const browsers = response.browsers || [];
        bridgeDetail.textContent = browsers.length
          ? `Connected: ${browsers.join(', ')}`
          : 'Connected';
      } else {
        bridgeStatus?.classList.remove('connected');
        bridgeStatus?.classList.add('disconnected');
        bridgeDetail.textContent = 'Not connected';
      }
    });
  }

  backendSelect?.addEventListener('change', () => {
    const value = backendSelect.value;

    // Save to chrome.storage.sync (cross-device)
    chrome.storage.sync.set({ browserBackend: value });

    // Forward to background to persist via CDP bridge + sync to IAM
    chrome.runtime.sendMessage({
      action: 'config.save',
      key: 'browserBackend',
      value,
    });
  });

  loadBackendPreference();
  refreshBridgeStatus();

  // --- Tools ---

  function showToolFeedback(btn: HTMLElement, text: string, duration = 1200) {
    const fb = document.createElement('div');
    fb.className = 'tool-feedback';
    fb.textContent = text;
    btn.style.position = 'relative';
    btn.appendChild(fb);
    setTimeout(() => fb.remove(), duration);
  }

  function getActiveTab(): Promise<chrome.tabs.Tab | null> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] && isInjectableTab(tabs[0]) ? tabs[0] : null);
      });
    });
  }

  // Element Picker / Selector tool
  const toolPicker = document.getElementById('tool-picker');
  toolPicker?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      showToolFeedback(toolPicker, 'No page');
      return;
    }
    // Send message to content script to start picker mode
    chrome.tabs.sendMessage(tab.id, { action: 'tool.picker.start' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        showToolFeedback(toolPicker, 'N/A');
        return;
      }
      showToolFeedback(toolPicker, 'Pick...');
      // Close popup so user can interact with the page
      setTimeout(() => window.close(), 400);
    });
  });

  // Screenshot tool
  const toolScreenshot = document.getElementById('tool-screenshot');
  toolScreenshot?.addEventListener('click', async () => {
    toolScreenshot.setAttribute('disabled', 'true');
    try {
      chrome.tabs.captureVisibleTab(null as any, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          showToolFeedback(toolScreenshot, 'Failed');
          toolScreenshot.removeAttribute('disabled');
          return;
        }
        // Copy to clipboard as image
        fetch(dataUrl)
          .then(r => r.blob())
          .then(blob => {
            const item = new ClipboardItem({ 'image/png': blob });
            return navigator.clipboard.write([item]);
          })
          .then(() => {
            showToolFeedback(toolScreenshot, 'Copied!');
          })
          .catch(() => {
            // Fallback: open in new tab
            chrome.tabs.create({ url: dataUrl });
            showToolFeedback(toolScreenshot, 'Opened');
          })
          .finally(() => {
            toolScreenshot.removeAttribute('disabled');
          });
      });
    } catch {
      showToolFeedback(toolScreenshot, 'Error');
      toolScreenshot.removeAttribute('disabled');
    }
  });

  // Page Info tool
  const toolPageInfo = document.getElementById('tool-pageinfo');
  toolPageInfo?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      showToolFeedback(toolPageInfo, 'No page');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'tool.pageinfo' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        // Fallback: basic info from tab object
        const info = `Title: ${tab.title}\nURL: ${tab.url}`;
        navigator.clipboard.writeText(info).then(() => {
          showToolFeedback(toolPageInfo, 'Copied!');
        });
        return;
      }
      navigator.clipboard.writeText(response.info).then(() => {
        showToolFeedback(toolPageInfo, 'Copied!');
      }).catch(() => {
        showToolFeedback(toolPageInfo, 'Failed');
      });
    });
  });

  // Accessibility Audit tool
  const toolA11y = document.getElementById('tool-accessibility');
  toolA11y?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      showToolFeedback(toolA11y, 'No page');
      return;
    }
    toolA11y.setAttribute('disabled', 'true');
    showToolFeedback(toolA11y, 'Running...');
    chrome.runtime.sendMessage({ action: 'audit.accessibility', tabId: tab.id }, (response) => {
      toolA11y.removeAttribute('disabled');
      if (chrome.runtime.lastError || !response?.success) {
        showToolFeedback(toolA11y, 'Failed');
        return;
      }
      const count = response.issues?.length || 0;
      showToolFeedback(toolA11y, count ? `${count} issues` : 'Clean!');
    });
  });

  // Performance Audit tool
  const toolPerf = document.getElementById('tool-performance');
  toolPerf?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      showToolFeedback(toolPerf, 'No page');
      return;
    }
    toolPerf.setAttribute('disabled', 'true');
    showToolFeedback(toolPerf, 'Running...');
    chrome.runtime.sendMessage({ action: 'audit.performance', tabId: tab.id }, (response) => {
      toolPerf.removeAttribute('disabled');
      if (chrome.runtime.lastError || !response?.success) {
        showToolFeedback(toolPerf, 'Failed');
        return;
      }
      showToolFeedback(toolPerf, 'Done');
    });
  });

  // Console tool — evaluate JS
  const toolConsole = document.getElementById('tool-console');
  toolConsole?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) {
      showToolFeedback(toolConsole, 'No page');
      return;
    }
    // Send to content script to start an inline eval prompt
    chrome.tabs.sendMessage(tab.id, { action: 'tool.console.start' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        showToolFeedback(toolConsole, 'N/A');
        return;
      }
      showToolFeedback(toolConsole, 'Open');
      setTimeout(() => window.close(), 400);
    });
  });

  // Init
  checkAuth();
});
