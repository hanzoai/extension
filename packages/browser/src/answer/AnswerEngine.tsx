import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAiClient, type AiClient, type SearchEvent, type SearchSource } from '@hanzo/ai';
import { fetchNews, type NewsItem } from './news.js';
import { AUTO_MODEL, fetchModelCatalog, type ChatModel, type ModelGroup } from './model-catalog.js';
import { renderMarkdown } from './markdown.js';
import { capture, contributeTrainingSample } from '../shared/consent.js';
import { Composer, type Mode } from './Composer.js';
import { Rail } from './Rail.js';
import { Source } from './Source.js';
import { Stories } from './Stories.js';
import { DEFAULT_PROVIDER_ID, fallbackUrl, loadProviderId, providerById } from './websearch.js';

/**
 * Hanzo Answer Engine — the shared AI-answer surface (query → streamed answer +
 * inline citations + sources + live news). Backend = api.hanzo.ai ONLY, reached
 * through @hanzo/ai: `search` for the grounded modes, `chat.completions` for
 * Chat (each capability defined in exactly one place). Strict monochrome per
 * the Hanzo brand.
 *
 * This file holds the state and the wire. Everything it draws with is a
 * presentational sibling — Rail, Composer (Models), Source, Stories — each one
 * a component whose data and effects arrive as props, so the same parts can be
 * lifted into @hanzo/ui and mounted by chat and app without dragging the
 * extension's transport along.
 */

/**
 * Chat mode — the same question, ungrounded, straight to the model. It yields
 * `SearchEvent`s so the surface keeps ONE stream to consume and ONE way to
 * render an answer; a mode is a value the wire takes, never a second UI.
 */
async function* converse(
  client: AiClient,
  question: string,
  model: string,
  signal: AbortSignal,
): AsyncGenerator<SearchEvent> {
  const stream = await client.chat.completions.create(
    { model, messages: [{ role: 'user', content: question }], stream: true },
    { signal },
  );
  let answer = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (!delta) continue;
    answer += delta;
    yield { type: 'text', delta };
  }
  yield { type: 'done', answer, sources: [] };
}

export interface AnswerEngineProps {
  apiBase: string;
  /** Resolves the current IAM bearer, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Kicks off IAM sign-in (opens the OAuth tab). */
  signIn: () => void;
  /** Optional initial query (from the omnibox / address bar `?q=`). */
  initialQuery?: string;
}

export function AnswerEngine({ apiBase, getToken, signIn, initialQuery }: AnswerEngineProps) {
  // Sidebar hidden by default — the answer surface should read like hanzo.chat:
  // a single centered column. A fixed toggle (below) brings the rail back.
  const [collapsed, setCollapsed] = useState(true);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<Mode>('search');
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [model, setModel] = useState<ChatModel>(AUTO_MODEL);
  const [news, setNews] = useState<NewsItem[]>([]);
  // True once the user picks a model themselves, so the catalog's default-to-Enso
  // never overwrites a deliberate choice made while the fetch was still in flight.
  const picked = useRef(false);
  const chooseModel = useCallback((m: ChatModel) => {
    picked.current = true;
    setModel(m);
  }, []);

  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [status, setStatus] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerSources, setAnswerSources] = useState<SearchSource[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [needAuth, setNeedAuth] = useState(false);
  // The engine an unauthenticated query falls back to. Read once; the default
  // stands until storage answers, so a query typed in the first moments after a
  // new tab opens still has somewhere to go.
  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER_ID);
  const abortRef = useRef<AbortController | null>(null);

  // Load real model catalog + live news (both public — work signed out).
  //
  // Enso is the default, selected once the catalog lands. It cannot be the
  // useState seed: the catalog is fetched at runtime, so naming a model before
  // it arrives would hardcode an id the server may not serve — the whole point
  // of model-catalog.ts is that the list is never fabricated. AUTO_MODEL is the
  // seed and the fallback, so a failed/slow fetch degrades to "routes to the
  // best model" instead of a dead selection. Only the initial pick is
  // overridden: `picked` guards a user's choice against a late catalog resolve.
  useEffect(() => {
    fetchModelCatalog()
      .then(({ groups }) => {
        setModelGroups(groups);
        if (picked.current) return;
        const enso = groups.find((g) => g.family === 'enso')?.models[0];
        if (enso) setModel(enso);
      })
      .catch(() => {});
    fetchNews().then(setNews).catch(() => {});
    loadProviderId().then(setProviderId).catch(() => {});
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

      // NO IDENTITY, NO DEAD END. /v1/ask is metered and answers 401 to a
      // signed-out caller, but this surface IS the browser's search box: a query
      // that returns a sign-in card has broken the address bar rather than shown a
      // paywall. Hand it to the configured engine instead, before any spinner —
      // checking first is what makes the handoff instant rather than a flash of
      // "Searching the web" followed by a navigation.
      //
      // The fallback is not a Hanzo call: no token, no proxy, no telemetry. The
      // query goes from this browser straight to the engine the user chose.
      let identified = false;
      try {
        identified = Boolean(await getToken());
      } catch {
        identified = false;
      }
      if (!identified) {
        const url = fallbackUrl(providerId, question);
        if (url) {
          void capture('answer_search_fallback', { provider: providerId, mode });
          window.location.assign(url);
          return;
        }
      }

      setSubmitted(question);
      setPhase('running');
      setStatus(mode === 'chat' ? 'Thinking' : 'Searching the web');
      setAnswer('');
      setAnswerSources([]);
      setFollowUps([]);
      setError('');
      setNeedAuth(false);
      void capture('answer_search', { mode, model: model.id });
      let fullAnswer = '';

      const stream =
        mode === 'chat'
          ? converse(client, question, model.id, ctrl.signal)
          : (client.search(question, {
              mode,
              model: model.id,
              sources: [...sources],
              signal: ctrl.signal,
            }) as AsyncGenerator<SearchEvent>);
      try {
        for await (const ev of stream) {
          switch (ev.type) {
            case 'status':
              setStatus(
                ev.stage === 'planning'
                  ? 'Planning research' + (ev.detail ? `: ${ev.detail}` : '')
                  : ev.stage === 'searching'
                    ? 'Searching the web' + (ev.detail ? `: ${ev.detail}` : '')
                    : ev.stage === 'reading'
                      ? 'Reading sources' + (ev.detail ? `: ${ev.detail}` : '')
                      : 'Writing the answer',
              );
              break;
            case 'sources':
              setAnswerSources(ev.sources);
              break;
            case 'text':
              fullAnswer += ev.delta;
              setAnswer((a) => a + ev.delta);
              break;
            case 'follow_ups':
              setFollowUps(ev.questions);
              break;
            case 'done':
              setPhase('done');
              void capture('answer_shown', { mode, model: model.id });
              // Opt-in only: no-ops unless the user turned on training
              // contribution (the consent module gates the send).
              void contributeTrainingSample({ query: question, answer: fullAnswer, model: model.id });
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
    [client, mode, model, sources, getToken, providerId],
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

  const composer = (busy: boolean) => (
    <Composer
      value={query}
      onChange={setQuery}
      onSubmit={submit}
      mode={mode}
      setMode={setMode}
      sources={sources}
      toggleSource={toggleSource}
      models={modelGroups}
      model={model}
      setModel={chooseModel}
      busy={busy}
    />
  );

  return (
    <div className={'ae-root' + (collapsed ? ' collapsed' : '')}>
      {/* No fixed reveal button: the rail itself is always present now, and it
          carries its own expand control. A floating toggle only existed because
          the collapsed rail rendered nothing to click. */}
      <Rail
        collapsed={collapsed}
        toggle={() => setCollapsed((v) => !v)}
        newThread={newThread}
        signIn={signIn}
      />

      <main className="ae-main">
        {phase === 'idle' ? (
          <div className="ae-hero">
            <div className="ae-hero-card">{composer(false)}</div>
            <Stories items={news} />
          </div>
        ) : (
          <div className="ae-answer-wrap">
            <div className="ae-answer-scroll">
              <h1 className="ae-question">{submitted}</h1>

              {answerSources.length > 0 && (
                <div className="ae-sources">
                  {answerSources.map((s, i) => (
                    <Source key={s.url} source={s} index={i} />
                  ))}
                </div>
              )}

              {phase === 'running' && !answer && (
                <div className="ae-status">
                  <span className="ae-spinner" /> {status}…
                </div>
              )}

              {needAuth ? (
                /* Reached only when a token EXISTED and the call still came back
                   401 — an expired or revoked session, since a signed-out query
                   never gets here (run() hands it to the fallback engine first).
                   Both doors are offered: renew the session for an AI answer, or
                   take the same query to the configured engine. A dead end here
                   would strand someone who simply needs to sign in again. */
                <div className="ae-auth">
                  <p>Your Hanzo session expired. Sign in again for AI answers.</p>
                  <button className="ae-signin big" onClick={signIn}>
                    Sign in
                  </button>
                  <a
                    className="ae-fallback-link"
                    href={fallbackUrl(providerId, submitted) || undefined}
                  >
                    Search {providerById(providerId).label} instead
                  </a>
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

            <div className="ae-answer-composer">{composer(phase === 'running')}</div>
          </div>
        )}
      </main>
    </div>
  );
}
