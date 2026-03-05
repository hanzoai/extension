// Hanzo Browser Extension - Content Script
// Connects clicked elements to source code via source-maps

interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

interface ElementSelectedEvent {
  event: 'elementSelected';
  framework: string | null;
  domPath: string;
  source?: SourceLocation;
  fallbackId?: string;
}

class HanzoContentScript {
  constructor() {
    this.setupClickHandler();
    this.injectHelpers();
    this.setupMessageHandlers();
  }

  private setupClickHandler() {
    document.addEventListener('click', (e) => {
      if (!e.altKey) return;

      e.preventDefault();
      e.stopPropagation();

      const element = e.target as HTMLElement;
      const source = this.extractSourceLocation(element);
      const domPath = this.getDOMPath(element);

      const event: ElementSelectedEvent = {
        event: 'elementSelected',
        framework: this.detectFramework(),
        domPath,
        source,
        fallbackId: element.getAttribute('data-hanzo-id') || undefined,
      };

      // Route through background script (works with both ZAP and legacy MCP)
      chrome.runtime.sendMessage({ action: 'elementSelected', data: event });
    });
  }

  private setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      switch (request.action) {
        case 'ai.control.start':
          aiOverlay.show(request.task || 'AI is controlling this page');
          sendResponse({ success: true });
          return true;
        case 'ai.control.stop':
          aiOverlay.hide();
          sendResponse({ success: true });
          return true;
        case 'ai.control.cursor':
          aiOverlay.moveCursor(request.x, request.y);
          sendResponse({ success: true });
          return true;
        case 'ai.control.highlight':
          aiOverlay.highlight(request.selector);
          sendResponse({ success: true });
          return true;
        case 'ai.control.status':
          aiOverlay.updateStatus(request.text);
          sendResponse({ success: true });
          return true;
      }

      // Tab filesystem support
      if (request.action === 'getContent') {
        sendResponse({ content: document.documentElement?.outerHTML || '' });
        return true;
      }

      if (request.action === 'setContent') {
        if (typeof request.content === 'string') {
          document.open();
          document.write(request.content);
          document.close();
        }
        sendResponse({ success: true });
        return true;
      }

      return false;
    });
  }

  private extractSourceLocation(element: HTMLElement): SourceLocation | undefined {
    const framework = this.detectFramework();

    switch (framework) {
      case 'react':
        return this.extractReactSource(element);
      case 'vue':
        return this.extractVueSource(element);
      case 'svelte':
        return this.extractSvelteSource(element);
      default:
        return undefined;
    }
  }

  private extractReactSource(element: HTMLElement): SourceLocation | undefined {
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return undefined;

    const fiber = this.findReactFiber(element);
    if (!fiber) return undefined;

    const source = fiber._debugSource || fiber.pendingProps?.__source || fiber.memoizedProps?.__source;

    if (source && source.fileName) {
      return {
        file: source.fileName,
        line: source.lineNumber,
        column: source.columnNumber,
      };
    }

    return undefined;
  }

  private findReactFiber(element: HTMLElement): any {
    const key = Object.keys(element).find(
      (candidate) => candidate.startsWith('__reactInternalInstance$') || candidate.startsWith('__reactFiber$'),
    );
    return key ? (element as any)[key] : null;
  }

  private extractVueSource(element: HTMLElement): SourceLocation | undefined {
    const hook = (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return undefined;

    let instance = (element as any).__vueParentComponent;
    if (!instance) {
      instance = (element as any).__vue__;
    }

    if (instance?.type?.__file) {
      const location: SourceLocation = {
        file: instance.type.__file,
        line: 1,
      };

      if (instance.vnode?.loc) {
        location.line = instance.vnode.loc.start.line;
        location.column = instance.vnode.loc.start.column;
      }

      return location;
    }

    return undefined;
  }

  private extractSvelteSource(element: HTMLElement): SourceLocation | undefined {
    const component = (element as any).__svelte_component;
    if (component?.$$?.ctx?.$$_location) {
      return component.$$.ctx.$$_location;
    }
    return undefined;
  }

  private detectFramework(): string | null {
    if ((window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__) return 'react';
    if ((window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__) return 'vue';
    if ((window as any).__svelte) return 'svelte';
    return null;
  }

  private getDOMPath(element: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
      } else if (current.className) {
        selector += `.${current.className.split(' ').join('.')}`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  private injectHelpers() {
    const style = document.createElement('style');
    style.textContent = `
      [data-hanzo-hover] {
        outline: 2px dashed #ff6b6b !important;
        outline-offset: 2px !important;
      }
    `;
    document.head.appendChild(style);

    document.addEventListener('mousemove', (e) => {
      document.querySelectorAll('[data-hanzo-hover]').forEach((el) => {
        el.removeAttribute('data-hanzo-hover');
      });

      if (e.altKey && e.target instanceof HTMLElement) {
        e.target.setAttribute('data-hanzo-hover', 'true');
      }
    });
  }
}

// =============================================================================
// AI Control Overlay — visual feedback + user interaction lock while active
// =============================================================================

const aiOverlay = (() => {
  let overlay: HTMLDivElement | null = null;
  let cursor: HTMLDivElement | null = null;
  let statusEl: HTMLDivElement | null = null;
  let highlightEl: HTMLDivElement | null = null;
  let trailNodes: HTMLDivElement[] = [];
  let interactionBlockActive = false;

  const OVERLAY_ID = 'hanzo-ai-overlay';
  const BLOCKED_EVENTS = [
    'click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu',
    'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel',
    'keydown', 'keyup', 'keypress',
  ];

  function injectStyles() {
    if (document.getElementById('hanzo-ai-overlay-styles')) return;

    const style = document.createElement('style');
    style.id = 'hanzo-ai-overlay-styles';
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: all;
        background: rgba(8, 10, 15, 0.14);
        backdrop-filter: blur(1px);
      }

      .hanzo-ai-cursor {
        position: fixed;
        width: 20px;
        height: 20px;
        z-index: 2147483647;
        pointer-events: none;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.95);
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.2);
        transition: left 0.2s ease-out, top 0.2s ease-out;
      }

      .hanzo-cursor-trail {
        position: fixed;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.85);
        z-index: 2147483646;
        pointer-events: none;
        animation: hanzo-trail-fade 0.35s ease-out forwards;
      }
      @keyframes hanzo-trail-fade {
        from { opacity: 0.8; transform: scale(1); }
        to { opacity: 0; transform: scale(0.2); }
      }

      .hanzo-ai-status {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 90vw;
        padding: 8px 12px;
        border-radius: 10px;
        background: rgba(15, 18, 24, 0.92);
        color: #f3f4f6;
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      }

      .hanzo-ai-status .hanzo-dot {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: #16a34a;
      }

      .hanzo-ai-status .hanzo-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hanzo-ai-status .hanzo-stop-btn {
        border: 1px solid rgba(255, 255, 255, 0.24);
        background: transparent;
        color: #f3f4f6;
        border-radius: 6px;
        padding: 3px 8px;
        cursor: pointer;
      }

      .hanzo-ai-status .hanzo-stop-btn:hover {
        background: rgba(220, 38, 38, 0.28);
      }

      .hanzo-ai-highlight {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        border: 2px solid rgba(255, 255, 255, 0.92);
        border-radius: 6px;
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.16);
      }
    `;
    document.head.appendChild(style);
  }

  function isOverlayElement(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return !!(
      overlay?.contains(target) ||
      statusEl?.contains(target) ||
      cursor?.contains(target) ||
      highlightEl?.contains(target)
    );
  }

  function blockInteraction(event: Event): void {
    if (!interactionBlockActive) return;

    if (event instanceof KeyboardEvent && event.key === 'Escape') {
      chrome.runtime.sendMessage({ action: 'ai.control.cancel' });
      hide();
      return;
    }

    if (isOverlayElement(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function setInteractionBlock(active: boolean): void {
    if (interactionBlockActive === active) return;

    interactionBlockActive = active;
    for (const eventName of BLOCKED_EVENTS) {
      if (active) {
        document.addEventListener(eventName, blockInteraction, true);
      } else {
        document.removeEventListener(eventName, blockInteraction, true);
      }
    }
  }

  function show(task: string) {
    if (overlay) hide();

    injectStyles();
    setInteractionBlock(true);

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);

    cursor = document.createElement('div');
    cursor.className = 'hanzo-ai-cursor';
    cursor.style.left = `${window.innerWidth / 2}px`;
    cursor.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(cursor);

    statusEl = document.createElement('div');
    statusEl.className = 'hanzo-ai-status';
    statusEl.innerHTML = `
      <div class="hanzo-dot"></div>
      <span class="hanzo-label">${escapeHtml(task)}</span>
      <button class="hanzo-stop-btn">Stop</button>
    `;
    document.body.appendChild(statusEl);

    statusEl.querySelector('.hanzo-stop-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'ai.control.cancel' });
      hide();
    });
  }

  function hide() {
    setInteractionBlock(false);

    overlay?.remove();
    cursor?.remove();
    statusEl?.remove();
    highlightEl?.remove();
    for (const node of trailNodes) {
      node.remove();
    }

    overlay = null;
    cursor = null;
    statusEl = null;
    highlightEl = null;
    trailNodes = [];
  }

  function moveCursor(x: number, y: number) {
    if (!cursor) return;

    const clampedX = Math.max(0, Math.min(window.innerWidth, Number.isFinite(x) ? x : 0));
    const clampedY = Math.max(0, Math.min(window.innerHeight, Number.isFinite(y) ? y : 0));

    const trail = document.createElement('div');
    trail.className = 'hanzo-cursor-trail';
    trail.style.left = `${clampedX}px`;
    trail.style.top = `${clampedY}px`;
    document.body.appendChild(trail);
    trailNodes.push(trail);

    setTimeout(() => {
      trail.remove();
      trailNodes = trailNodes.filter((node) => node !== trail);
    }, 350);

    while (trailNodes.length > 8) {
      trailNodes.shift()?.remove();
    }

    cursor.style.left = `${clampedX}px`;
    cursor.style.top = `${clampedY}px`;
  }

  function highlight(selector: string) {
    highlightEl?.remove();
    highlightEl = null;

    if (!selector || typeof selector !== 'string') return;

    try {
      const target = document.querySelector(selector);
      if (!target) return;

      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      highlightEl = document.createElement('div');
      highlightEl.className = 'hanzo-ai-highlight';
      highlightEl.style.left = `${Math.max(0, rect.left - 4)}px`;
      highlightEl.style.top = `${Math.max(0, rect.top - 4)}px`;
      highlightEl.style.width = `${rect.width + 8}px`;
      highlightEl.style.height = `${rect.height + 8}px`;
      document.body.appendChild(highlightEl);
    } catch {
      // Ignore invalid selectors.
    }
  }

  function updateStatus(text: string) {
    if (!statusEl) return;

    const label = statusEl.querySelector('.hanzo-label');
    if (label) {
      label.textContent = text || 'AI is controlling this page';
    }
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return { show, hide, moveCursor, highlight, updateStatus };
})();

// Initialize
new HanzoContentScript();
