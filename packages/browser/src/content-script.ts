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
        fallbackId: element.getAttribute('data-hanzo-id') || undefined
      };

      // Route through background script (works with both ZAP and legacy MCP)
      chrome.runtime.sendMessage({ action: 'elementSelected', data: event });
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
    // Access React DevTools global hook
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return undefined;

    // Find React fiber
    const fiber = this.findReactFiber(element);
    if (!fiber) return undefined;

    // Look for __source in props or _debugSource
    const source = fiber._debugSource || fiber.pendingProps?.__source || fiber.memoizedProps?.__source;
    
    if (source && source.fileName) {
      return {
        file: source.fileName,
        line: source.lineNumber,
        column: source.columnNumber
      };
    }
    
    return undefined;
  }

  private findReactFiber(element: HTMLElement): any {
    const key = Object.keys(element).find(key => 
      key.startsWith('__reactInternalInstance$') || 
      key.startsWith('__reactFiber$')
    );
    return key ? (element as any)[key] : null;
  }

  private extractVueSource(element: HTMLElement): SourceLocation | undefined {
    const hook = (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) return undefined;

    // Vue 3
    let instance = (element as any).__vueParentComponent;
    
    // Vue 2 fallback
    if (!instance) {
      instance = (element as any).__vue__;
    }
    
    if (instance?.type?.__file) {
      const location: SourceLocation = {
        file: instance.type.__file,
        line: 1 // Vue doesn't expose line by default
      };
      
      // Try to get line from vnode loc
      if (instance.vnode?.loc) {
        location.line = instance.vnode.loc.start.line;
        location.column = instance.vnode.loc.start.column;
      }
      
      return location;
    }
    
    return undefined;
  }

  private extractSvelteSource(element: HTMLElement): SourceLocation | undefined {
    // Svelte stores source in $$_location
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
    // Inject CSS for visual feedback
    const style = document.createElement('style');
    style.textContent = `
      [data-hanzo-hover] {
        outline: 2px dashed #ff6b6b !important;
        outline-offset: 2px !important;
      }
    `;
    document.head.appendChild(style);

    // Add hover effect on Alt key
    document.addEventListener('mousemove', (e) => {
      document.querySelectorAll('[data-hanzo-hover]').forEach(el => {
        el.removeAttribute('data-hanzo-hover');
      });

      if (e.altKey && e.target instanceof HTMLElement) {
        e.target.setAttribute('data-hanzo-hover', 'true');
      }
    });

    // Listen for AI control messages from background
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      switch (request.action) {
        case 'ai.control.start':
          aiOverlay.show(request.task || 'AI is controlling this page');
          sendResponse({ success: true });
          break;
        case 'ai.control.stop':
          aiOverlay.hide();
          sendResponse({ success: true });
          break;
        case 'ai.control.cursor':
          aiOverlay.moveCursor(request.x, request.y);
          sendResponse({ success: true });
          break;
        case 'ai.control.highlight':
          aiOverlay.highlight(request.selector);
          sendResponse({ success: true });
          break;
        case 'ai.control.status':
          aiOverlay.updateStatus(request.text);
          sendResponse({ success: true });
          break;
      }
      return true;
    });
  }
}

// =============================================================================
// AI Control Overlay — visual feedback when AI drives the browser
// =============================================================================

const aiOverlay = (() => {
  let overlay: HTMLDivElement | null = null;
  let cursor: HTMLDivElement | null = null;
  let cursorGlow: HTMLDivElement | null = null;
  let statusEl: HTMLDivElement | null = null;
  let highlightEl: HTMLDivElement | null = null;
  let cursorTrail: HTMLDivElement[] = [];
  let sparkleInterval: ReturnType<typeof setInterval> | null = null;
  let interactionBlockActive = false;

  const OVERLAY_ID = 'hanzo-ai-overlay';
  const BLOCKED_EVENTS = [
    'click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu',
    'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel',
    'keydown', 'keyup', 'keypress'
  ];

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
    if (typeof (event as any).stopImmediatePropagation === 'function') {
      (event as any).stopImmediatePropagation();
    }
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

  function injectStyles() {
    if (document.getElementById('hanzo-ai-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'hanzo-ai-overlay-styles';
    style.textContent = `
      /* ---- Overlay base: dot matrix grid + tinted glass ---- */
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: all;
        background:
          radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px),
          rgba(0, 0, 0, 0.06);
        background-size: 24px 24px, 100% 100%;
        backdrop-filter: blur(0.5px) saturate(1.1);
        animation: hanzo-overlay-in 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
        overflow: hidden;
      }
      @keyframes hanzo-overlay-in {
        from { opacity: 0; backdrop-filter: blur(0); }
        to   { opacity: 1; backdrop-filter: blur(0.5px); }
      }

      /* Scanning beam — horizontal light sweep */
      #${OVERLAY_ID}::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          180deg,
          transparent 0%,
          rgba(255,255,255,0.04) 48%,
          rgba(255,255,255,0.08) 50%,
          rgba(255,255,255,0.04) 52%,
          transparent 100%
        );
        background-size: 100% 200%;
        animation: hanzo-scan 4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes hanzo-scan {
        0%   { background-position: 0 -100%; }
        100% { background-position: 0 200%; }
      }

      /* Corner accents — subtle L-shaped brackets */
      #${OVERLAY_ID}::after {
        content: '';
        position: absolute;
        inset: 12px;
        border: 1px solid transparent;
        border-image: linear-gradient(
          135deg,
          rgba(255,255,255,0.3) 0%,
          transparent 20%,
          transparent 80%,
          rgba(255,255,255,0.3) 100%
        ) 1;
        animation: hanzo-border-breathe 3s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes hanzo-border-breathe {
        0%, 100% { opacity: 0.5; }
        50%      { opacity: 1; }
      }

      /* ---- Sparkle particles ---- */
      .hanzo-sparkle {
        position: fixed;
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: white;
        z-index: 2147483647;
        pointer-events: none;
        animation: hanzo-sparkle-float 2.5s ease-out forwards;
        box-shadow: 0 0 6px 2px rgba(255,255,255,0.6),
                    0 0 12px 4px rgba(255,255,255,0.2);
      }
      .hanzo-sparkle.warm {
        background: #FFD07A;
        box-shadow: 0 0 6px 2px rgba(255,208,122,0.6),
                    0 0 12px 4px rgba(255,208,122,0.2);
      }
      .hanzo-sparkle.cool {
        background: #7AC8FF;
        box-shadow: 0 0 6px 2px rgba(122,200,255,0.6),
                    0 0 12px 4px rgba(122,200,255,0.2);
      }
      @keyframes hanzo-sparkle-float {
        0%   { opacity: 0; transform: translateY(0) scale(0); }
        15%  { opacity: 1; transform: translateY(-8px) scale(1); }
        100% { opacity: 0; transform: translateY(-60px) scale(0.2); }
      }

      /* ---- AI cursor — glowing pointer with aura ---- */
      .hanzo-ai-cursor {
        position: fixed;
        width: 28px;
        height: 28px;
        z-index: 2147483647;
        pointer-events: none;
        transition: left 0.35s cubic-bezier(0.22, 1, 0.36, 1),
                    top 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        filter: drop-shadow(0 0 12px rgba(255,255,255,0.5))
                drop-shadow(0 2px 6px rgba(0,0,0,0.4));
      }
      .hanzo-ai-cursor svg {
        width: 28px;
        height: 28px;
      }

      /* Cursor glow aura */
      .hanzo-cursor-glow {
        position: fixed;
        width: 80px;
        height: 80px;
        border-radius: 50%;
        z-index: 2147483646;
        pointer-events: none;
        background: radial-gradient(
          circle,
          rgba(255,255,255,0.12) 0%,
          rgba(255,255,255,0.04) 40%,
          transparent 70%
        );
        transition: left 0.35s cubic-bezier(0.22, 1, 0.36, 1),
                    top 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        animation: hanzo-glow-pulse 2s ease-in-out infinite;
      }
      @keyframes hanzo-glow-pulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; }
        50%      { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
      }

      /* Cursor trail — glowing orbs */
      .hanzo-cursor-trail {
        position: fixed;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: white;
        z-index: 2147483646;
        pointer-events: none;
        box-shadow: 0 0 8px 2px rgba(255,255,255,0.4);
        animation: hanzo-trail-fade 0.8s ease-out forwards;
      }
      @keyframes hanzo-trail-fade {
        0%   { opacity: 0.7; transform: scale(1); }
        100% { opacity: 0; transform: scale(0.1); }
      }

      /* Cursor click ripple */
      .hanzo-cursor-ripple {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        border: 2px solid rgba(255,255,255,0.6);
        border-radius: 50%;
        animation: hanzo-ripple-expand 0.6s ease-out forwards;
      }
      @keyframes hanzo-ripple-expand {
        0%   { width: 0; height: 0; opacity: 1; transform: translate(-50%, -50%); }
        100% { width: 60px; height: 60px; opacity: 0; transform: translate(-50%, -50%); }
      }

      /* ---- Status bar — frosted glass with animated border ---- */
      .hanzo-ai-status {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        background: rgba(10, 10, 10, 0.88);
        backdrop-filter: blur(24px) saturate(1.3);
        border-radius: 14px;
        padding: 10px 20px 10px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        color: #fff;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5),
                    0 0 0 1px rgba(255,255,255,0.08);
        animation: hanzo-status-in 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        max-width: 90vw;
      }
      /* Animated gradient border */
      .hanzo-ai-status::before {
        content: '';
        position: absolute;
        inset: -1px;
        border-radius: 15px;
        padding: 1px;
        background: linear-gradient(
          135deg,
          rgba(255,255,255,0.25),
          transparent 40%,
          transparent 60%,
          rgba(255,255,255,0.15)
        );
        background-size: 200% 200%;
        animation: hanzo-gradient-spin 3s linear infinite;
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
      }
      @keyframes hanzo-gradient-spin {
        0%   { background-position: 0% 0%; }
        100% { background-position: 200% 200%; }
      }
      @keyframes hanzo-status-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.95); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }

      .hanzo-ai-status .hanzo-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #4ADE80;
        flex-shrink: 0;
        box-shadow: 0 0 8px 2px rgba(74,222,128,0.5);
        animation: hanzo-dot-pulse 1.5s ease-in-out infinite;
      }
      @keyframes hanzo-dot-pulse {
        0%, 100% { opacity: 1; box-shadow: 0 0 8px 2px rgba(74,222,128,0.5); }
        50%      { opacity: 0.6; box-shadow: 0 0 4px 1px rgba(74,222,128,0.3); }
      }

      .hanzo-ai-status .hanzo-label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: 0.01em;
      }

      .hanzo-ai-status .hanzo-stop-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        color: rgba(255,255,255,0.85);
        font-size: 11px;
        font-weight: 600;
        padding: 5px 12px;
        cursor: pointer;
        pointer-events: all;
        transition: all 0.2s ease;
        flex-shrink: 0;
        letter-spacing: 0.02em;
      }
      .hanzo-ai-status .hanzo-stop-btn:hover {
        background: rgba(239, 68, 68, 0.25);
        border-color: rgba(239, 68, 68, 0.5);
        color: #fff;
        box-shadow: 0 0 12px rgba(239, 68, 68, 0.2);
      }

      /* ---- Highlight ring — shimmer + glow ---- */
      .hanzo-ai-highlight {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        border: 2px solid rgba(255, 255, 255, 0.6);
        border-radius: 6px;
        box-shadow: 0 0 16px 2px rgba(255, 255, 255, 0.15),
                    0 0 0 1px rgba(255,255,255,0.1),
                    inset 0 0 12px rgba(255,255,255,0.05);
        transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
        animation: hanzo-highlight-in 0.35s ease-out;
        overflow: hidden;
      }
      /* Shimmer sweep across highlighted element */
      .hanzo-ai-highlight::after {
        content: '';
        position: absolute;
        inset: -2px;
        background: linear-gradient(
          105deg,
          transparent 30%,
          rgba(255,255,255,0.12) 45%,
          rgba(255,255,255,0.2) 50%,
          rgba(255,255,255,0.12) 55%,
          transparent 70%
        );
        background-size: 200% 100%;
        animation: hanzo-shimmer 1.8s ease-in-out infinite;
      }
      @keyframes hanzo-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @keyframes hanzo-highlight-in {
        from { opacity: 0; transform: scale(1.08); }
        to   { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  function spawnSparkle() {
    if (!overlay) return;
    const s = document.createElement('div');
    const variant = Math.random();
    s.className = 'hanzo-sparkle' + (variant < 0.33 ? ' warm' : variant < 0.66 ? ' cool' : '');
    s.style.left = `${Math.random() * window.innerWidth}px`;
    s.style.top = `${Math.random() * window.innerHeight}px`;
    s.style.animationDuration = `${1.5 + Math.random() * 2}s`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 3500);
  }

  function spawnCursorSparkles(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      s.className = 'hanzo-sparkle' + (Math.random() > 0.5 ? ' warm' : '');
      s.style.left = `${x + (Math.random() - 0.5) * 30}px`;
      s.style.top = `${y + (Math.random() - 0.5) * 30}px`;
      s.style.animationDuration = `${0.8 + Math.random() * 1.2}s`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 2500);
    }
  }

  function show(task: string) {
    if (overlay) hide();
    injectStyles();
    setInteractionBlock(true);

    // Overlay mask with dot matrix
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);

    // Cursor glow aura (follows cursor)
    cursorGlow = document.createElement('div');
    cursorGlow.className = 'hanzo-cursor-glow';
    cursorGlow.style.left = `${window.innerWidth / 2}px`;
    cursorGlow.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(cursorGlow);

    // AI cursor
    cursor = document.createElement('div');
    cursor.className = 'hanzo-ai-cursor';
    cursor.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 3.2L20.3 11.5L12.2 13.2L8.8 20.3L5.5 3.2Z" fill="white" stroke="rgba(0,0,0,0.3)" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;
    cursor.style.left = `${window.innerWidth / 2}px`;
    cursor.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(cursor);

    // Status bar
    statusEl = document.createElement('div');
    statusEl.className = 'hanzo-ai-status';
    statusEl.innerHTML = `
      <div class="hanzo-dot"></div>
      <span class="hanzo-label">${escapeHtml(task)}</span>
      <button class="hanzo-stop-btn">Stop</button>
    `;
    document.body.appendChild(statusEl);

    // Stop button handler
    statusEl.querySelector('.hanzo-stop-btn')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'ai.control.cancel' });
      hide();
    });

    // Spawn ambient sparkles periodically
    sparkleInterval = setInterval(() => {
      const count = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) spawnSparkle();
    }, 400);
    // Initial burst
    for (let i = 0; i < 8; i++) spawnSparkle();

    // Extra guard on the mask itself
    overlay.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    overlay.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    overlay.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); });
  }

  function hide() {
    setInteractionBlock(false);
    if (sparkleInterval) { clearInterval(sparkleInterval); sparkleInterval = null; }
    overlay?.remove();
    cursor?.remove();
    cursorGlow?.remove();
    statusEl?.remove();
    highlightEl?.remove();
    cursorTrail.forEach(t => t.remove());
    // Clean up any remaining sparkles
    document.querySelectorAll('.hanzo-sparkle').forEach(s => s.remove());
    overlay = null;
    cursor = null;
    cursorGlow = null;
    statusEl = null;
    highlightEl = null;
    cursorTrail = [];
  }

  function moveCursor(x: number, y: number) {
    if (!cursor) return;

    // Leave glowing trail dot at old position
    const oldLeft = parseFloat(cursor.style.left) || 0;
    const oldTop = parseFloat(cursor.style.top) || 0;
    const trail = document.createElement('div');
    trail.className = 'hanzo-cursor-trail';
    trail.style.left = `${oldLeft + 4}px`;
    trail.style.top = `${oldTop + 4}px`;
    document.body.appendChild(trail);
    cursorTrail.push(trail);
    setTimeout(() => {
      trail.remove();
      cursorTrail = cursorTrail.filter(t => t !== trail);
    }, 800);

    // Keep max 12 trail dots
    while (cursorTrail.length > 12) {
      cursorTrail.shift()?.remove();
    }

    // Sparkles at cursor destination
    spawnCursorSparkles(x, y, 3);

    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;

    // Move glow aura with cursor
    if (cursorGlow) {
      cursorGlow.style.left = `${x}px`;
      cursorGlow.style.top = `${y}px`;
    }
  }

  function emitRipple(x: number, y: number) {
    const ripple = document.createElement('div');
    ripple.className = 'hanzo-cursor-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  function highlight(selector: string) {
    highlightEl?.remove();
    highlightEl = null;

    try {
      const el = document.querySelector(selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      highlightEl = document.createElement('div');
      highlightEl.className = 'hanzo-ai-highlight';
      highlightEl.style.left = `${rect.left - 4}px`;
      highlightEl.style.top = `${rect.top - 4}px`;
      highlightEl.style.width = `${rect.width + 8}px`;
      highlightEl.style.height = `${rect.height + 8}px`;
      document.body.appendChild(highlightEl);

      // Ripple + sparkles at element center
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      emitRipple(cx, cy);
      spawnCursorSparkles(cx, cy, 5);
    } catch {}
  }

  function updateStatus(text: string) {
    if (!statusEl) return;
    const label = statusEl.querySelector('.hanzo-label');
    if (label) label.textContent = text;
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
