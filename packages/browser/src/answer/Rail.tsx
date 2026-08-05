import React from 'react';
import { Mark } from './Mark.js';

/**
 * The left rail: mark, new thread, links, sign-in.
 *
 * COLLAPSED IS AN ICON RAIL, NOT AN ABSENCE — the `collapsible="icon"` behaviour of
 * @hanzo/ui primitives/sidebar. A collapsed rail still shows the brand and the way
 * back; hiding it outright left the surface with no affordance at all.
 *
 * The labels are ALWAYS RENDERED and hidden in CSS, never branched on in JS. Opening
 * on hover is a CSS state (`.ae-root.collapsed:hover`), so markup that only appears
 * when `collapsed` is false could never be revealed by hovering — the rail would
 * widen to show nothing. Presentational: every action is injected.
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
          <span>Hanzo</span>
        </button>
        <button
          className="ae-collapse"
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M6 3v10M3 3h10v10H3z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>
      <button className="ae-new" onClick={newThread} title="New thread">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>New thread</span>
      </button>
      <nav className="ae-nav">
        <a href="https://hanzo.chat" target="_blank" rel="noreferrer">Threads</a>
        <a href="https://docs.hanzo.ai" target="_blank" rel="noreferrer">Docs</a>
        <a href="https://hanzo.ai" target="_blank" rel="noreferrer">About</a>
      </nav>
      <div className="ae-side-bottom">
        <button className="ae-signin" onClick={signIn} title="Sign in">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M6 3H3v10h3M10 5l3 3-3 3M13 8H6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          <span className="ae-signin-label">Sign in — free to start</span>
        </button>
      </div>
    </aside>
  );
}
