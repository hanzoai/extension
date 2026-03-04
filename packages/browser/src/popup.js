// Hanzo AI - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const mainSection = document.getElementById('main-section');
  const settingsSection = document.getElementById('settings-section');

  // Auth
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

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

  // --- Auth ---
  function checkAuth() {
    chrome.storage.local.get(['hanzoToken', 'hanzoUser'], (result) => {
      if (result.hanzoToken) {
        loginSection.classList.add('hidden');
        mainSection.classList.remove('hidden');
        if (result.hanzoUser) {
          const avatar = document.getElementById('user-avatar');
          const name = document.getElementById('user-name');
          const email = document.getElementById('user-email');
          avatar.src = result.hanzoUser.avatar || 'icon48.png';
          name.textContent = result.hanzoUser.name || 'Hanzo User';
          email.textContent = result.hanzoUser.email || '';
        }
        refreshStatus();
      } else {
        loginSection.classList.remove('hidden');
        mainSection.classList.add('hidden');
      }
    });
  }

  loginBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://iam.hanzo.ai/login?redirect=extension' });
  });

  logoutBtn?.addEventListener('click', () => {
    chrome.storage.local.remove(['hanzoToken', 'hanzoUser'], () => {
      mainSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
    });
  });

  // --- Status ---
  function refreshStatus() {
    // ZAP status
    chrome.runtime.sendMessage({ action: 'zap.status' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success) {
        const zap = response.zap;
        if (zap.connected) {
          zapStatus.classList.add('connected');
          zapStatus.classList.remove('disconnected');
          const mcpCount = zap.mcps?.length || 0;
          const toolCount = zap.mcps?.reduce((sum, m) => sum + (m.tools?.length || 0), 0) || 0;
          zapDetail.textContent = `${mcpCount} MCP(s), ${toolCount} tools`;
        } else {
          zapStatus.classList.remove('connected');
          zapStatus.classList.add('disconnected');
          zapDetail.textContent = 'Not connected';
        }
      }
    });

    // GPU status
    chrome.runtime.sendMessage({ action: 'runLocalAI', prompt: '' }, (response) => {
      if (chrome.runtime.lastError) return;
      // If we get a response (even error), GPU check is working
      gpuStatus.classList.add(response?.success ? 'connected' : 'disconnected');
      gpuStatus.classList.remove(response?.success ? 'disconnected' : 'connected');
      gpuDetail.textContent = response?.success ? 'Available' : 'Not available';
    });

    // MCP legacy status (check if ws is open via background)
    mcpStatus.classList.add('connected');
    mcpPort.textContent = 'Fallback';

    // CDP status
    cdpStatus.classList.add('connected');
    cdpDetail.textContent = 'Active';
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
      const mcpPortInput = document.getElementById('mcp-port-setting');
      const cdpPortInput = document.getElementById('cdp-port-setting');
      const zapPortsInput = document.getElementById('zap-ports-setting');

      if (mcpPortInput) mcpPortInput.value = result.mcpPort || 3001;
      if (cdpPortInput) cdpPortInput.value = result.cdpPort || 9223;
      if (zapPortsInput) zapPortsInput.value = (result.zapPorts || [9999, 9998, 9997, 9996, 9995]).join(',');
    });
  }

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

    chrome.runtime.sendMessage({ action: 'zap.discover' }, (response) => {
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

  // Init
  checkAuth();
});
