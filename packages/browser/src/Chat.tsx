import React, { useState } from 'react';
import { Button, Checkbox, SizableText, XStack, YStack } from '@hanzo/ui';
import { Composer, Failure, Message, Thread } from '@hanzo/ui/chat';
import { ModelSelector, type ModelCatalogEntry } from '@hanzo/ui/models';
import { Prose } from './shared/Prose.js';

/**
 * The sidebar's chat surface — `@hanzo/ui/chat`, the same shell the new-tab
 * answer engine and every other Hanzo surface draw with.
 *
 * The sidebar is the narrow client: ~360px, an MV3 extension page, and a
 * transport that is the service worker rather than a fetch loop. None of that
 * reaches the presentation. Every turn, the model and the busy flag arrive as
 * props and every action leaves as a callback, so `sidebar.ts` keeps the whole
 * wire — token brokering, retrieval, budgets, dedupe, the stream — and this
 * file keeps none of it.
 *
 * The draft is the one thing held here, as `@hanzo/ui/chat`'s own `Chat` holds
 * it. A half-typed question belongs to this screen and nothing outside it
 * reads it, so it stays in this component, and `onSend` gets its trimmed text.
 * The Composer is controlled and must be handed a value on every render.
 *
 * Width is the one thing the shell is asked to bend on. `Thread` caps prose at a
 * reading measure and centres it, which in a ~360px column would inset the text
 * from both edges, so it is told to fill — and its gutters come from the wrapper
 * here, because the shell drops its own padding along with the cap. The model
 * picker's trigger is `width: "100%"`, so it is boxed: left free it takes the
 * whole toolbar row and pushes the send control off the edge.
 */

/** How wide the model picker is allowed to be in a sidebar toolbar row. */
const PICKER = 132;

export interface Turn {
  /** Minted by `sidebar.ts` where the turn is made. The thread keys rows on it. */
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** The turn failed. Rendered as the shell's Failure, with a retry. */
  error?: string;
}

export interface ChatProps {
  turns: Turn[];
  /** Send the draft's trimmed text. The composer is already empty. */
  onSend: (text: string) => void;
  onStop: () => void;
  /** Run the last question again. */
  onRetry: () => void;
  busy: boolean;
  models: ModelCatalogEntry[];
  model: string;
  onModel: (id: string) => void;
  /** Whether retrieval runs before the turn, and whether it sees the open tab. */
  rag: boolean;
  onRag: (on: boolean) => void;
  tab: boolean;
  onTab: (on: boolean) => void;
  /** What retrieval last did. Shown at the end of the composer's toolbar row. */
  status: string;
  signedIn: boolean;
  onSignIn: () => void;
  onSignUp: () => void;
}

/** A named toggle, sized for the composer's toolbar row. */
function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <XStack items="center" gap="$1" title={hint}>
      <Checkbox
        size="$2"
        checked={on}
        onCheckedChange={(v) => onChange(v === true)}
        aria-label={hint}
      />
      <SizableText size="$1" color="$color10">
        {label}
      </SizableText>
    </XStack>
  );
}

export function Chat(props: ChatProps) {
  const { turns, busy, signedIn } = props;
  const [draft, setDraft] = useState('');

  // The Composer calls this only with something to send and no turn in flight.
  const send = () => {
    setDraft('');
    props.onSend(draft.trim());
  };

  if (!signedIn) {
    return (
      <YStack flex={1} justify="center" items="center" gap="$3" p="$5">
        <SizableText size="$5" fontWeight="600">
          Sign in to Hanzo AI
        </SizableText>
        <SizableText size="$2" color="$color10" text="center">
          Chat with Zen AI models, use browser tools, and build with AI agents.
        </SizableText>
        <Button width="100%" onPress={props.onSignIn}>
          Sign in
        </Button>
        <Button width="100%" variant="outline" onPress={props.onSignUp}>
          Create account
        </Button>
        <SizableText size="$1" color="$color10" text="center">
          Browser tools work without sign-in.{' '}
          <a href="https://docs.hanzo.ai" target="_blank" rel="noreferrer">
            Learn more
          </a>
        </SizableText>
      </YStack>
    );
  }

  return (
    <YStack flex={1} minH={0}>
      <YStack flex={1} minH={0} px="$3">
        <Thread maxWidth={0} gap={16}>
          {turns.length === 0 ? (
            <Message role="system">Ask anything. Powered by Hanzo Cloud.</Message>
          ) : (
            turns.map((t, i) => (
              <Message
                key={t.id}
                role={t.role}
                busy={busy && i === turns.length - 1 && t.role === 'assistant' && !t.content}
              >
                {t.error ? (
                  <Failure onRetry={props.onRetry}>{t.error}</Failure>
                ) : t.role === 'assistant' ? (
                  <Prose text={t.content} />
                ) : (
                  t.content
                )}
              </Message>
            ))
          )}
        </Thread>
      </YStack>

      <YStack p="$2">
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={props.onStop}
          busy={busy}
          hint={props.status}
        >
          <XStack width={PICKER} shrink={0}>
            <ModelSelector
              models={props.models}
              value={props.model}
              onChange={props.onModel}
              size="sm"
            />
          </XStack>
          <Toggle label="RAG" hint="Retrieval context" on={props.rag} onChange={props.onRag} />
          <Toggle label="Tab" hint="Include active tab" on={props.tab} onChange={props.onTab} />
        </Composer>
      </YStack>
    </YStack>
  );
}
