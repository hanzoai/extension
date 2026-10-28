import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAiClient, type AiClient, type SearchEvent, type SearchSource } from '@hanzo/ai';
import { Button, SizableText, XStack, YStack } from '@hanzo/ui';
import { Composer, Failure, Message, Sources, Step, Thread, type Source } from '@hanzo/ui/chat';
import { ModelSelector, type ModelCatalogEntry } from '@hanzo/ui/models';
import { fetchNews, type NewsItem } from './news.js';
import { AUTO, fetchCatalog } from './model-catalog.js';
import { Prose } from '../shared/Prose.js';
import { capture, contributeTrainingSample } from '../shared/consent.js';
import { Toolbar, type Mode } from './Toolbar.js';
import { Rail } from './Rail.js';
import { Stories } from './Stories.js';
import { Widgets } from './WidgetView.js';
import { extractWidgets } from './widget.js';
import { DEFAULT_PROVIDER_ID, fallbackUrl, loadProviderId, providerById } from './websearch.js';

/**
 * Hanzo Answer Engine — the shared AI-answer surface (query → streamed answer +
 * inline citations + sources + live news). Backend = api.hanzo.ai ONLY, reached
 * through @hanzo/ai: `search` for the grounded modes, `chat.completions` for
 * Chat (each capability defined in exactly one place).
 *
 * It draws with `@hanzo/ui/chat` — Thread, Message, Sources, Composer — and
 * `@hanzo/ui/models` for the picker. This file is the state and the wire; the
 * presentation is the shell every Hanzo chat surface shares. What is left local
 * is only what is true HERE: the modes and sources in the composer's toolbar
 * slot, the widgets the answer can emit, and the news rail.
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
  if (model === 'chatgpt-web' || model === 'webgpu' || model.startsWith('hanzo-')) {
    const runtime: typeof chrome = (globalThis as any).browser ?? (globalThis as any).chrome;
    const resp: any = await runtime.runtime.sendMessage({
      action: 'chat.complete',
      model,
      messages: [{ role: 'user', content: question }],
    });
    if (!resp?.success) {
      yield { type: 'error', error: resp?.error || 'Inference failed' };
      return;
    }
    const answer = resp.message?.content || resp.content || '';
    yield { type: 'text', delta: answer };
    yield { type: 'done', answer, sources: [] };
    return;
  }

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

/** What each wire stage is called on the surface. */
const STAGE: Record<string, string> = {
  planning: 'Planning research',
  searching: 'Searching the web',
  reading: 'Reading sources',
  writing: 'Writing the answer',
};

/** How wide the model picker is allowed to be in the composer's toolbar row. */
const PICKER = 176;

/** A cited source in the shell's vocabulary. The favicon is the mark; the host
 *  initial stands in when a site serves none, so a citation always renders. */
function cite(s: SearchSource): Source {
  return {
    id: s.url,
    title: s.title || s.url,
    href: s.url,
    ...(s.favicon ? { icon: <img src={s.favicon} alt="" width={16} height={16} /> } : null),
  };
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
  // Rail hidden by default — the answer surface should read like hanzo.chat:
  // a single centered column. Its own header control brings it back.
  const [collapsed, setCollapsed] = useState(true);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<Mode>('search');
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [model, setModel] = useState<string>(AUTO);
  const [news, setNews] = useState<NewsItem[]>([]);
  // True once the user picks a model themselves, so the catalog's default-to-Enso
  // never overwrites a deliberate choice made while the fetch was still in flight.
  const picked = useRef(false);
  const chooseModel = useCallback((id: string) => {
    picked.current = true;
    setModel(id);
  }, []);

  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  /** What the answer is doing right now, as the shell's Step reads it. */
  const [step, setStep] = useState<{ name: string; detail?: string }>({ name: '' });
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
  // of model-catalog.ts is that the list is never fabricated. Auto is the seed
  // and the fallback, so a failed/slow fetch degrades to "routes to the best
  // model" instead of a dead selection. Only the initial pick is overridden:
  // `picked` guards a user's choice against a late catalog resolve.
  useEffect(() => {
    fetchCatalog()
      .then((entries) => {
        setModels(entries);
        if (picked.current) return;
        const enso = entries.find((m) => /enso/i.test(m.family ?? ''));
        if (enso) setModel(enso.id);
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
      const isSpecial = model === 'chatgpt-web' || model === 'webgpu' || model.startsWith('hanzo-');
      let identified = false;
      try {
        identified = Boolean(await getToken());
      } catch {
        identified = false;
      }
      if (!identified && !isSpecial) {
        const url = fallbackUrl(providerId, question);
        if (url) {
          void capture('answer_search_fallback', { provider: providerId, mode });
          window.location.assign(url);
          return;
        }
      }

      setSubmitted(question);
      setPhase('running');
      setStep({ name: mode === 'chat' || isSpecial ? 'Thinking' : 'Searching the web' });
      setAnswer('');
      setAnswerSources([]);
      setFollowUps([]);
      setError('');
      setNeedAuth(false);
      void capture('answer_search', { mode, model });
      let fullAnswer = '';

      const stream =
        mode === 'chat' || isSpecial
          ? converse(client, question, model, ctrl.signal)
          : (client.search(question, {
              mode,
              model,
              sources: [...sources],
              signal: ctrl.signal,
            }) as AsyncGenerator<SearchEvent>);
      try {
        for await (const ev of stream) {
          switch (ev.type) {
            case 'status':
              setStep({
                name: STAGE[ev.stage] ?? 'Writing the answer',
                ...(ev.detail ? { detail: ev.detail } : null),
              });
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
              void capture('answer_shown', { mode, model });
              // Opt-in only: no-ops unless the user turned on training
              // contribution (the consent module gates the send).
              void contributeTrainingSample({ query: question, answer: fullAnswer, model });
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
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setPhase('done');
  }, []);
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

  const busy = phase === 'running';
  const composer = (
    <Composer value={query} onChange={setQuery} onSend={submit} onStop={stop} busy={busy}>
      <Toolbar mode={mode} setMode={setMode} sources={sources} toggleSource={toggleSource} />
      {/* Boxed: the picker's trigger is `width: "100%"`, so left free in the
          toolbar row it takes everything and pushes the send control out. */}
      <XStack width={PICKER} shrink={0}>
        <ModelSelector models={models} value={model} onChange={chooseModel} size="sm" />
      </XStack>
    </Composer>
  );

  const { prose, widgets } = extractWidgets(answer);

  return (
    <div className={'ae-root' + (collapsed ? ' collapsed' : '')}>
      <Rail
        collapsed={collapsed}
        toggle={() => setCollapsed((v) => !v)}
        newThread={newThread}
        signIn={signIn}
      />

      <main className="ae-main">
        {phase === 'idle' ? (
          <YStack flex={1} justify="center" items="center" gap="$6" px="$4" py="$6">
            <YStack width="100%" maxW={768}>
              {composer}
            </YStack>
            <Stories items={news} />
          </YStack>
        ) : (
          <>
            <Thread>
              <Message role="user">{submitted}</Message>

              {answerSources.length > 0 && <Sources sources={answerSources.map(cite)} />}

              {needAuth ? (
                /* Reached only when a token EXISTED and the call still came back
                   401 — an expired or revoked session, since a signed-out query
                   never gets here (run() hands it to the fallback engine first).
                   Both doors are offered: renew the session for an AI answer, or
                   take the same query to the configured engine. A dead end here
                   would strand someone who simply needs to sign in again. */
                <YStack gap="$3" items="flex-start">
                  <SizableText size="$3">
                    Your Hanzo session expired. Sign in again for AI answers.
                  </SizableText>
                  <XStack gap="$3" items="center">
                    <Button onPress={signIn}>Sign in</Button>
                    <a
                      href={fallbackUrl(providerId, submitted) || undefined}
                      style={{ color: 'inherit', opacity: 0.7, fontSize: 13 }}
                    >
                      Search {providerById(providerId).label} instead
                    </a>
                  </XStack>
                </YStack>
              ) : error ? (
                <Message role="assistant">
                  <Failure onRetry={() => void run(submitted)}>{error}</Failure>
                </Message>
              ) : (
                /* The answer picks its own presentation: any widget blocks it
                   emitted render as real components, and the prose is what is
                   left after they are removed — so a widget is never also shown
                   as raw JSON. Extraction runs per frame against a STREAMING,
                   half-written document, which is why an unterminated fence is
                   left alone until it closes. */
                <Message role="assistant" busy={busy && !answer}>
                  {busy && !answer ? (
                    <Step name={step.name} status="running" {...(step.detail ? { detail: step.detail } : null)} />
                  ) : null}
                  <Widgets widgets={widgets} />
                  <Prose text={prose} />
                </Message>
              )}

              {followUps.length > 0 && (
                <YStack gap="$1.5">
                  <SizableText size="$1" color="$color10" fontWeight="500">
                    Follow-up
                  </SizableText>
                  {followUps.map((f) => (
                    <XStack
                      key={f}
                      items="center"
                      gap="$2"
                      px="$3"
                      py="$2"
                      rounded="$3"
                      borderWidth={1}
                      borderColor="$borderColor"
                      cursor="pointer"
                      role="button"
                      tabIndex={0}
                      hoverStyle={{ backgroundColor: '$color3' }}
                      onPress={() => {
                        setQuery(f);
                        void run(f);
                      }}
                    >
                      <SizableText size="$2" flex={1}>
                        {f}
                      </SizableText>
                      <SizableText size="$2" color="$color10">
                        →
                      </SizableText>
                    </XStack>
                  ))}
                </YStack>
              )}
            </Thread>

            <YStack width="100%" maxW={768} self="center" px="$3" pb="$4">
              {composer}
            </YStack>
          </>
        )}
      </main>
    </div>
  );
}
