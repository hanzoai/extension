import React from 'react';
import { Mark } from './Mark.js';

/**
 * The thin left rail: mark, new thread, links, sign-in. Collapses to icons.
 * Presentational — the collapse state and every action are injected.
 */
export interface RailProps {
  collapsed: boolean;
  toggle: () => void;
  newThread: () => void;
  signIn: () => void;
}

export function Rail({ collapsed, toggle, newThread, signIn }: RailProps) {
  return (
    <aside className="ae-sidebar">
      <div className="ae-side-top">
        <button className="ae-brand" onClick={newThread} title="Hanzo">
          <Mark size={22} />
          {!collapsed && <span>Hanzo</span>}
        </button>
        <button className="ae-collapse" onClick={toggle} title="Toggle sidebar">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M6 3v10M3 3h10v10H3z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>
      <button className="ae-new" onClick={newThread}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {!collapsed && <span>New thread</span>}
      </button>
      <nav className="ae-nav">
        <a href="https://hanzo.chat" target="_blank" rel="noreferrer">Threads</a>
        <a href="https://docs.hanzo.ai" target="_blank" rel="noreferrer">Docs</a>
        <a href="https://hanzo.ai" target="_blank" rel="noreferrer">About</a>
      </nav>
      <div className="ae-side-bottom">
        <button className="ae-signin" onClick={signIn}>
          {collapsed ? '↪' : 'Sign in — free to start'}
        </button>
      </div>
    </aside>
  );
}
