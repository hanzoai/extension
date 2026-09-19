// The Hanzo AI assistant panel — a Canva App UI Kit React component. All the
// logic-heavy work lives in tested, pure modules: the action catalog + prompt
// assembly + response parsing in design-core.ts, the model call in hanzo.ts
// (@hanzo/ai), and the design I/O in canva.ts (@canva/design). This component
// only binds them to App UI Kit widgets and holds the panel's small UI state
// (the pasted key, the picked model, the chosen action, the instruction, the
// output). It never speaks to api.hanzo.ai or the Canva SDK directly.
//
// Flow: pick an action → (for generate/ideas/ask) type a brief, (for rewrite/
// translate) select text on the canvas → Run → design-core builds the request
// from the observed selection/page → hanzo.ts calls the model → design-core
// parses the reply → the panel shows it and inserts it via canva.ts (replace the
// selection in place, or add a new text element).

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import {
  Alert,
  Box,
  Button,
  FormField,
  LoadingIndicator,
  MultilineInput,
  Rows,
  Select,
  Text,
  TextInput,
  Title,
} from '@canva/app-ui-kit';
import {
  buildActionMessages,
  designActionList,
  parseCopy,
  parseIdeas,
  DESIGN_ACTIONS,
  type ActionInputs,
  type DesignActionId,
  type DesignContext,
} from './design-core.js';
import { runChat, listModels } from './hanzo.js';
import { onSelectionChange, replaceSelectedText, insertText, type SelectionSnapshot } from './canva.js';
import { isHanzoKey, DEFAULT_MODEL } from './config.js';

// The catalog the panel renders, derived from design-core so labels/flags never
// drift from what will actually run.
const ACTIONS = designActionList();

type Status = { tone: 'positive' | 'critical' | 'info'; text: string } | null;

export function App(): JSX.Element {
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [action, setAction] = useState<DesignActionId>('generate');
  const [instruction, setInstruction] = useState('');
  const [language, setLanguage] = useState('Spanish');
  const [selection, setSelection] = useState<SelectionSnapshot>({ count: 0, text: '' });
  const [output, setOutput] = useState('');
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const keyValid = isHanzoKey(key);
  const spec = DESIGN_ACTIONS[action];

  // Track the live plaintext selection so rewrite/translate know what they act on
  // and the panel can gate those actions until something is selected.
  useEffect(() => onSelectionChange(setSelection), []);

  // Load the model catalog once a valid key is pasted (org-scoped by the bearer).
  useEffect(() => {
    if (!keyValid) return;
    let live = true;
    listModels({ token: key })
      .then((ids) => {
        if (!live) return;
        setModels(ids);
        if (ids.length && !ids.includes(model)) setModel(ids[0]);
      })
      .catch(() => live && setModels([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyValid, key]);

  // The design context we can observe right now — handed to design-core to fence
  // as data. The page text is left to a future read; the selection is the field
  // rewrite/translate act on and is always current.
  const context = useMemo<DesignContext>(
    () => ({ selection: selection.text || undefined }),
    [selection.text],
  );

  const inputs = useMemo<ActionInputs>(
    () => ({ instruction, language }),
    [instruction, language],
  );

  // canRun encodes the action's preconditions: a valid key, plus a selection for
  // selection-actions and an instruction for instruction-actions.
  const missing =
    !keyValid
      ? 'Paste your Hanzo sk- key to begin.'
      : spec.needsSelection && selection.count === 0
        ? 'Select text on your design to run this action.'
        : spec.needsInstruction && instruction.trim() === ''
          ? `Enter ${action === 'ask' ? 'a question' : 'a brief'} to run this action.`
          : '';

  const run = useCallback(async () => {
    if (missing) {
      setStatus({ tone: 'info', text: missing });
      return;
    }
    setBusy(true);
    setStatus(null);
    setOutput('');
    setIdeas([]);
    try {
      const messages = buildActionMessages(action, inputs, context);
      const reply = await runChat(messages, { token: key, model });
      if (action === 'ideas') {
        setIdeas(parseIdeas(reply));
      } else {
        setOutput(parseCopy(reply));
      }
    } catch (e) {
      setStatus({ tone: 'critical', text: e instanceof Error ? e.message : 'Generation failed' });
    } finally {
      setBusy(false);
    }
  }, [missing, action, inputs, context, key, model]);

  // Insert the generated copy. Rewrite replaces the selection in place; every
  // other action adds a new text element at the cursor.
  const place = useCallback(
    async (text: string) => {
      setBusy(true);
      setStatus(null);
      try {
        if (action === 'rewrite') {
          await replaceSelectedText(text);
          setStatus({ tone: 'positive', text: 'Replaced the selected text.' });
        } else {
          await insertText(text, action === 'generate' ? 32 : 18);
          setStatus({ tone: 'positive', text: 'Added to your design.' });
        }
      } catch (e) {
        setStatus({ tone: 'critical', text: e instanceof Error ? e.message : 'Could not add to design' });
      } finally {
        setBusy(false);
      }
    },
    [action],
  );

  return (
    <Box padding="2u">
      <Rows spacing="2u">
        <Title size="small">Hanzo AI</Title>

        <FormField
          label="Hanzo API key"
          description={keyValid ? 'Key looks valid.' : 'Paste your sk- key from hanzo.id'}
          control={(props) => (
            <TextInput {...props} placeholder="sk-..." value={key} onChange={setKey} />
          )}
        />

        {models.length > 0 && (
          <FormField
            label="Model"
            control={() => (
              <Select
                stretch
                value={model}
                onChange={setModel}
                options={models.map((id) => ({ value: id, label: id }))}
              />
            )}
          />
        )}

        <FormField
          label="Action"
          control={() => (
            <Select
              stretch
              value={action}
              onChange={(v) => setAction(v as DesignActionId)}
              options={ACTIONS.map((a) => ({ value: a.id, label: a.label }))}
            />
          )}
        />

        {action === 'translate' ? (
          <FormField
            label="Target language"
            control={(props) => (
              <TextInput {...props} placeholder="Spanish" value={language} onChange={setLanguage} />
            )}
          />
        ) : spec.needsInstruction ? (
          <FormField
            label={action === 'ask' ? 'Question' : action === 'ideas' ? 'Topic' : 'Brief'}
            control={() => (
              <MultilineInput
                autoGrow
                minRows={2}
                placeholder={
                  action === 'ask'
                    ? 'What tone should this poster use?'
                    : action === 'ideas'
                      ? 'Summer sale for a coffee brand'
                      : 'A bold headline for our spring launch'
                }
                value={instruction}
                onChange={setInstruction}
              />
            )}
          />
        ) : null}

        {spec.needsSelection && (
          <Text size="small" tone="tertiary">
            {selection.count > 0
              ? `Selected: ${selection.text.slice(0, 80)}${selection.text.length > 80 ? '…' : ''}`
              : 'Nothing selected — select text on your design.'}
          </Text>
        )}

        <Button variant="primary" onClick={() => void run()} disabled={busy} stretch loading={busy}>
          {spec.label}
        </Button>

        {busy && <LoadingIndicator />}
        {status && <Alert tone={status.tone}>{status.text}</Alert>}

        {output && (
          <Rows spacing="1u">
            <FormField
              label="Result"
              control={() => (
                <MultilineInput autoGrow minRows={3} value={output} onChange={setOutput} />
              )}
            />
            <Button variant="primary" onClick={() => void place(output)} disabled={busy} stretch>
              {action === 'rewrite' ? 'Replace selection' : 'Add to design'}
            </Button>
          </Rows>
        )}

        {ideas.length > 0 && (
          <Rows spacing="1u">
            <Text size="small" tone="tertiary">Content ideas</Text>
            {ideas.map((idea, i) => (
              <Button key={i} variant="secondary" onClick={() => void place(idea)} disabled={busy} stretch>
                {idea}
              </Button>
            ))}
          </Rows>
        )}
      </Rows>
    </Box>
  );
}
