// Background Service Worker for Browser Extension
import { BrowserControl } from './browser-control';
import { WebGPUAI } from './webgpu-ai';

// Initialize browser control
const browserControl = new BrowserControl();
const webgpuAI = new WebGPUAI();

// Initialize WebGPU on startup
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Hanzo] Extension installed, initializing WebGPU...');
  
  const gpuAvailable = await webgpuAI.initialize();
  if (gpuAvailable) {
    console.log('[Hanzo] WebGPU available, loading local models...');
    
    // Load small local model for browser control
    try {
      await webgpuAI.loadModel({
        name: 'hanzo-browser-control',
        url: chrome.runtime.getURL('models/browser-control-4bit.bin'),
        quantization: '4bit',
        maxTokens: 512
      });
    } catch (error) {
      console.error('[Hanzo] Failed to load local model:', error);
    }
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(request: any, sender: chrome.runtime.MessageSender, sendResponse: Function) {
  switch (request.action) {
    case 'runLocalAI':
      try {
        const result = await webgpuAI.runInference(
          request.model || 'hanzo-browser-control',
          request.prompt
        );
        sendResponse({ success: true, result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;
      
    case 'launchAIWorker':
      if (sender.tab?.id) {
        await browserControl.launchAIWorker(sender.tab.id, request.model);
        sendResponse({ success: true });
      }
      break;
      
    case 'readTabFS':
      try {
        const content = await browserControl.readTab(request.path);
        sendResponse({ success: true, content });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;
      
    case 'writeTabFS':
      try {
        await browserControl.writeTab(request.path, request.content);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;
      
    case 'listTabFS':
      const tabs = await browserControl.listTabs();
      sendResponse({ success: true, tabs });
      break;
  }
}

// Connect to WebSocket for MCP communication
let ws: WebSocket | null = null;

function connectToMCP() {
  ws = new WebSocket('ws://localhost:3001/browser-extension');
  
  ws.onopen = () => {
    console.log('[Hanzo] Connected to MCP server');
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMCPMessage(data);
  };
  
  ws.onerror = (error) => {
    console.error('[Hanzo] WebSocket error:', error);
  };
  
  ws.onclose = () => {
    console.log('[Hanzo] Disconnected from MCP server, reconnecting...');
    setTimeout(connectToMCP, 5000);
  };
}

function handleMCPMessage(data: any) {
  switch (data.type) {
    case 'browserControl':
      // Execute browser control commands from MCP
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          browserControl.launchAIWorker(tabs[0].id, data.model);
        }
      });
      break;
  }
}

// Connect on startup
connectToMCP();

// Export for testing
export { browserControl, webgpuAI };