import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAiClient, type SearchEvent, type SearchMode, type SearchSource } from '@hanzo/ai';
import { fetchNews, type NewsItem } from './news.js';
import { AUTO_MODEL, fetchModelCatalog, type ChatModel, type ModelGroup } from './model-catalog.js';
import { renderMarkdown } from './markdown.js';

/**
 * Hanzo Answer Engine — the shared AI-answer surface (query → streamed answer +
 * inline citations + sources + live news). Backend = api.hanzo.ai ONLY, reached
 * through the @hanzo/ai `search`/`deepResearch` primitive (the one place the
 * capability is defined). Rendered on the @hanzo/gui primitive surface; strict
 * monochrome per the Hanzo brand.
 */

export interface AnswerEngineProps {
  apiBase: string;
  /** Resolves the current IAM bearer, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Kicks off IAM sign-in (opens the OAuth tab). */
  signIn: () => void;
  /** Optional initial query (from the omnibox / address bar `?q=`). */
  initialQuery?: string;
}

const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: 'search', label: 'Search', hint: 'Fast grounded answer' },
  { id: 'news', label: 'News', hint: 'Recency-biased' },
  { id: 'research', label: 'Research', hint: 'Multi-source synthesis' },
  { id: 'deep', label: 'Deep', hint: 'Plan + wide research' },
];

const SOURCE_CHIPS = ['web', 'news', 'academic', 'github', 'reddit', 'x'];

// Hanzo tiers mirror @hanzo/plans (the SoT for pricing); shown in the picker's
// upgrade banner. Full plan detail lives at console.hanzo.ai/pricing.
const PLAN_TIERS = [
  { name: 'Pro', price: '$20' },
  { name: 'Max', price: '$100' },
  { name: 'Ultra', price: '$200' },
];

function HanzoMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 67 67" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.21 67V44.6369H0V67H22.21Z" fill="currentColor" />
      <path d="M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z" fill="currentColor" />
      <path d="M22.21 0H0V22.3184H22.21V0Z" fill="currentColor" />
      <path d="M66.7198 0H44.5098V22.3184H66.7198V0Z" fill="currentColor" />
      <path d="M66.7198 67V44.6369H44.5098V67H66.7198Z" fill="currentColor" />
    </svg>
  );
}

function ModelPicker({
  groups,
  current,
  onPick,
}: {
  groups: ModelGroup[];
  current: ChatModel;
  onPick: (m: ChatModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          models: g.models.filter(
            (m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.models.length),
    [groups, q],
  );

  return (
    <div className="ae-picker" ref={ref}>
      <button className="ae-picker-btn" onClick={() => setOpen((v) => !v)} title="Choose model">
        <span className="ae-dot" />
        {current.name}
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="ae-picker-menu">
          <input
            className="ae-picker-filter"
            placeholder="Search models…"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="ae-picker-list">
            <button
              className={'ae-model-row' + (current.id === AUTO_MODEL.id ? ' active' : '')}
              onClick={() => {
                onPick(AUTO_MODEL);
                setOpen(false);
              }}
            >
              <span className="ae-model-name">Auto</span>
              <span className="ae-model-desc">Routes to the best model</span>
            </button>
            {shown.map((g) => (
              <div key={g.family} className="ae-model-group">
                <div className="ae-model-group-label">{g.label}</div>
                {g.models.map((m) => (
                  <button
                    key={m.id}
                    className={'ae-model-row' + (current.id === m.id ? ' active' : '')}
                    onClick={() => {
                      onPick(m);
                      setOpen(false);
                    }}
                  >
                    <span className="ae-model-name">
                      {m.name}
                      {m.tier && <span className="ae-badge">{m.tier}</span>}
                    </span>
                    {m.description && <span className="ae-model-desc">{m.description}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <a className="ae-plan-banner" href="https://console.hanzo.ai/pricing" target="_blank" rel="noreferrer">
            <span>Unlock every model</span>
            <span className="ae-plan-tiers">
              {PLAN_TIERS.map((t) => (
                <span key={t.name} className="ae-plan-tier">
                  {t.name} <b>{t.price}</b>
                </span>
              ))}
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

function SourceCard({ s, index }: { s: SearchSource; index: number }) {
  let host = '';
  try {
    host = new URL(s.url).hostname.replace(/^www\./, '');
  } catch {
    host = s.url;
  }
  return (
    <a className="ae-source" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
      <span className="ae-source-head">
        {s.favicon ? <img src={s.favicon} alt="" width="14" height="14" /> : <span className="ae-dot" />}
        <span className="ae-source-host">{host}</span>
        <span className="ae-source-idx">{index + 1}</span>
      </span>
      <span className="ae-source-title">{s.title}</span>
    </a>
  );
}

function InputCard({
  value,
  onChange,
  onSubmit,
  mode,
  setMode,
  sources,
  toggleSource,
  models,
  model,
  setModel,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  mode: SearchMode;
  setMode: (m: SearchMode) => void;
  sources: Set<string>;
  toggleSource: (s: string) => void;
  models: ModelGroup[];
  model: ChatModel;
  setModel: (m: ChatModel) => void;
  busy: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  return (
    <div className="ae-card">
      <textarea
        ref={taRef}
        className="ae-input"
        placeholder="Type @ for sources or / for modes"
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="ae-card-row">
        <div className="ae-chips">
          {SOURCE_CHIPS.map((s) => (
            <button
              key={s}
              className={'ae-chip' + (sources.has(s) ? ' on' : '')}
              onClick={() => toggleSource(s)}
              title={`@${s}`}
            >
              @{s}
            </button>
          ))}
        </div>
        <div className="ae-card-right">
          <div className="ae-modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={'ae-mode' + (mode === m.id ? ' on' : '')}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
          <ModelPicker groups={models} current={model} onPick={setModel} />
          <button className="ae-send" onClick={onSubmit} disabled={busy || !value.trim()} title="Search (Enter)">
            {busy ? (
              <span className="ae-spinner" />
            ) : (
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M3 13V3l10 5-10 5z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AnswerEngine({ apiBase, getToken, signIn, initialQuery }: AnswerEngineProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<SearchMode>('search');
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [model, setModel] = useState<ChatModel>(AUTO_MODEL);
  const [news, setNews] = useState<NewsItem[]>([]);

  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [status, setStatus] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerSources, setAnswerSources] = useState<SearchSource[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [needAuth, setNeedAuth] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load real model catalog + live news (both public — work signed out).
  // Default stays on Auto ("routes to the best model"); the picker changes it.
  useEffect(() => {
    fetchModelCatalog(apiBase)
      .then(({ groups }) => setModelGroups(groups))
      .catch(() => {});
    fetchNews().then(setNews).catch(() => {});
  }, [apiBase]);

  const client = useMemo(
    () =>
      createAiClient({
        baseUrl: apiBase,
        getToken: async () => {
          const t = await getToken();
          if (!t) throw new Error('__NO_TOKEN__');
          return t;
        },
      }),
    [apiBase, getToken],
  );

  const run = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setSubmitted(question);
      setPhase('running');
      setStatus('Searching the web');
      setAnswer('');
      setAnswerSources([]);
      setFollowUps([]);
      setError('');
      setNeedAuth(false);

      const opts = {
        mode,
        model: model.id,
        sources: [...sources],
        signal: ctrl.signal,
      };
      try {
        for await (const ev of client.search(question, opts) as AsyncGenerator<SearchEvent>) {
          switch (ev.type) {
            case 'status':
              setStatus(
                ev.stage === 'planning'
                  ? 'Planning research'
                  : ev.stage === 'searching'
                    ? 'Searching the web' + (ev.detail ? `: ${ev.detail}` : '')
                    : ev.stage === 'reading'
                      ? 'Reading sources'
                      : 'Writing the answer',
              );
              break;
            case 'sources':
              setAnswerSources(ev.sources);
              break;
            case 'text':
              setAnswer((a) => a + ev.delta);
              break;
            case 'follow_ups':
              setFollowUps(ev.questions);
              break;
            case 'done':
              setPhase('done');
              break;
            case 'error':
              if (ev.error.includes('__NO_TOKEN__') || /401|invalid api key/i.test(ev.error)) {
                setNeedAuth(true);
              } else {
                setError(ev.error);
              }
              setPhase('done');
              break;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('__NO_TOKEN__') || /401|invalid api key/i.test(msg)) setNeedAuth(true);
        else setError(msg);
        setPhase('done');
      }
    },
    [client, mode, model, sources],
  );

  // Fire the initial (address-bar) query once models are ready enough.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !initialQuery) return;
    didInit.current = true;
    setQuery(initialQuery);
    void run(initialQuery);
  }, [initialQuery, run]);

  const submit = useCallback(() => void run(query), [query, run]);
  const toggleSource = useCallback((s: string) => {
    setSources((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setQuery('');
    setSubmitted('');
    setAnswer('');
    setAnswerSources([]);
    setFollowUps([]);
    setError('');
    setNeedAuth(false);
  }, []);

  return (
    <div className={'ae-root' + (collapsed ? ' collapsed' : '')}>
      <aside className="ae-sidebar">
        <div className="ae-side-top">
          <button className="ae-brand" onClick={newThread} title="Hanzo">
            <HanzoMark size={22} />
            {!collapsed && <span>Hanzo</span>}
          </button>
          <button className="ae-collapse" onClick={() => setCollapsed((v) => !v)} title="Toggle sidebar">
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

      <main className="ae-main">
        {phase === 'idle' ? (
          <div className="ae-hero">
            <div className="ae-wordmark">
              <HanzoMark size={44} />
              <span>Hanzo</span>
            </div>
            <div className="ae-hero-card">
              <InputCard
                value={query}
                onChange={setQuery}
                onSubmit={submit}
                mode={mode}
                setMode={setMode}
                sources={sources}
                toggleSource={toggleSource}
                models={modelGroups}
                model={model}
                setModel={setModel}
                busy={false}
              />
            </div>
            {news.length > 0 && (
              <div className="ae-news">
                <div className="ae-news-head">Top stories</div>
                <div className="ae-news-grid">
                  {news.slice(0, 6).map((n) => (
                    <a key={n.url} className="ae-news-item" href={n.url} target="_blank" rel="noreferrer">
                      <span className="ae-news-title">{n.title}</span>
                      <span className="ae-news-meta">
                        {n.source}
                        {typeof n.points === 'number' ? ` · ${n.points} pts` : ''}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="ae-answer-wrap">
            <div className="ae-answer-scroll">
              <h1 className="ae-question">{submitted}</h1>

              {answerSources.length > 0 && (
                <div className="ae-sources">
                  {answerSources.map((s, i) => (
                    <SourceCard key={s.url} s={s} index={i} />
                  ))}
                </div>
              )}

              {phase === 'running' && !answer && (
                <div className="ae-status">
                  <span className="ae-spinner" /> {status}…
                </div>
              )}

              {needAuth ? (
                <div className="ae-auth">
                  <p>Sign in with Hanzo to get AI answers.</p>
                  <button className="ae-signin big" onClick={signIn}>
                    Sign in — free to start
                  </button>
                </div>
              ) : error ? (
                <div className="ae-error">{error}</div>
              ) : (
                <div
                  className="ae-answer markdown"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
                />
              )}

              {followUps.length > 0 && (
                <div className="ae-followups">
                  <div className="ae-followups-head">Follow-up</div>
                  {followUps.map((f) => (
                    <button
                      key={f}
                      className="ae-followup"
                      onClick={() => {
                        setQuery(f);
                        void run(f);
                      }}
                    >
                      {f}
                      <span className="ae-followup-arrow">→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ae-answer-composer">
              <InputCard
                value={query}
                onChange={setQuery}
                onSubmit={submit}
                mode={mode}
                setMode={setMode}
                sources={sources}
                toggleSource={toggleSource}
                models={modelGroups}
                model={model}
                setModel={setModel}
                busy={phase === 'running'}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
