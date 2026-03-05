import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
} from '@hanzo/ui/primitives-common';

function LoginPrompt() {
  return (
    <Card className="chat-modern-login-card">
      <CardHeader>
        <CardTitle>Chat with Zen AI models</CardTitle>
        <CardDescription>Claude, GPT-4o, Zen Coder Flash and more</CardDescription>
      </CardHeader>
      <CardContent>
        <Button id="auth-btn" className="chat-modern-auth-btn">
          Sign in
        </Button>
        <p className="auth-note">
          Browser tools work without sign-in.{' '}
          <a href="https://docs.hanzo.ai" target="_blank" rel="noreferrer">
            Learn more
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

function ChatComposer() {
  return (
    <div className="chat-modern-composer">
      <div className="model-selector">
        <select id="model-select">
          <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
          <option value="claude-opus-4-20250514">Claude Opus 4</option>
          <option value="gpt-4o">GPT-4o</option>
          <option value="zen-coder-flash">Zen Coder Flash</option>
          <option value="zen-max">Zen Max</option>
        </select>
      </div>

      <div className="chat-flags">
        <label className="flag-toggle">
          <input type="checkbox" id="rag-enabled" defaultChecked />
          <span>RAG</span>
        </label>
        <label className="flag-toggle">
          <input type="checkbox" id="tab-context-enabled" defaultChecked />
          <span>Tab Context</span>
        </label>
        <span id="rag-status" className="rag-status">
          Ready
        </span>
      </div>

      <div className="input-row">
        <Textarea id="chat-input" placeholder="Ask anything..." rows={1} />
        <Button id="send-btn" className="send-btn" title="Send">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M4 10l12-6-6 12-2-6-4-2z" strokeWidth="1.5" fill="currentColor" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

export function mountModernChatWidget() {
  const loginTarget = document.getElementById('chat-login-prompt');
  if (loginTarget) {
    loginTarget.innerHTML = '';
    createRoot(loginTarget).render(<LoginPrompt />);
  }

  const composerTarget = document.getElementById('chat-composer');
  if (composerTarget) {
    composerTarget.innerHTML = '';
    createRoot(composerTarget).render(<ChatComposer />);
  }
}
