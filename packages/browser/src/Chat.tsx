import React from 'react';
import { Button, Checkbox, SizableText, XStack, YStack } from '@hanzo/ui';
import { Chat as Shell, Failure, Message, type Turn as Spoken } from '@hanzo/ui/chat';
import { ModelSelector, type ModelCatalogEntry } from '@hanzo/ui/models';
import { Prose } from './shared/Prose.js';

/**
 * The sidebar's chat surface — `@hanzo/ui/chat`'s `Chat`, which is Thread +
 * Message + Composer already put together. What used to be here was that
 * assembly written by hand: map the turns, hold the draft, clear it on send,
 * pass `busy`. Six surfaces wrote those twenty lines and they drifted, so the
 * shell grew the composition and this file stopped keeping a copy.
 *
 * What is left is what is TRUE HERE and nowhere else: how a turn's body is
 * drawn (markdown for an answer, a `Failure` for one that broke), what an empty
 * thread says, and the three controls in the composer's toolbar row — the model
 * picker and the two retrieval toggles.
 *
 * The sidebar is the narrow client: ~360px, an MV3 extension page, and a
 * transport that is the service worker rather than a fetch loop. None of that
 * reaches the presentation. Every turn, the model and the busy flag arrive as
 * props and every action leaves as a callback, so `sidebar.ts` keeps the whole
 * wire — token brokering, retrieval, budgets, dedupe, the stream — and this
 * file keeps none of it.
 *
 * The draft is the one piece of state that moved the OTHER way: the shell owns
 * it, because a half-typed message is a fact about this panel and nothing
 * outside it. `sidebar.ts` no longer re-renders the whole tree per keystroke.
 *
 * Width is the one thing the shell is asked to bend on. `Thread` caps prose at
 * a reading measure and centres it, which in a ~360px column would inset the
 * text from both edges, so it is told to fill — and its gutters then come from
 * `column`, because the shell drops its own padding along with the cap. The
 * model picker's trigger is `width: "100%"`, so it is boxed: left free it takes
 * the whole toolbar row and pushes the send control off the edge.
 */

/** How wide the model picker is allowed to be in a sidebar toolbar row. */
const PICKER = 132;

export interface Turn extends Spoken {
  content: string;
  /** The turn failed. Rendered as the shell's Failure, with a retry. */
  error?: string;
}

export interface ChatProps {
  turns: Turn[];
  /** The composer holds the draft and hands it over trimmed. */
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
  if (!props.signedIn) {
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
    <Shell
      messages={props.turns}
      streaming={props.busy}
      onSend={props.onSend}
      onStop={props.onStop}
      maxWidth={0}
      gap={16}
      column={{ px: '$3' }}
      empty={
        <YStack flex={1} p="$3">
          <Message role="system">Ask anything. Powered by Hanzo Cloud.</Message>
        </YStack>
      }
      // `body` is handed back the very objects passed as `messages`, so the
      // surface's extra field is there; the shell's Turn is the narrow view of
      // it that a picture needs.
      body={(turn) => {
        const t = turn as Turn;
        if (t.error) return <Failure onRetry={props.onRetry}>{t.error}</Failure>;
        return t.role === 'assistant' ? <Prose text={t.content} /> : t.content;
      }}
      composer={{
        m: '$2',
        // The frame is `width: "100%"`; a margin on top of that hangs 8px of it
        // off the right edge (measured), so the width becomes the stretch the
        // column already gives it. `e2e/turn.spec.ts` holds both edges.
        width: 'auto',
        hint: props.status,
        children: (
          <>
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
          </>
        ),
      }}
    />
  );
}
