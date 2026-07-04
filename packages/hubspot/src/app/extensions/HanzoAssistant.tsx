// Hanzo AI card — the CRM record panel. Pure UI glue: it reads the record in
// context (context.crm), lets the user pick a model + an action, calls the
// `hanzo-assistant` serverless function (which holds the Hanzo key and does the
// model call), renders the result, and offers one-click write-back as a Note or
// Task via `hanzo-writeback`. No secret and no direct model call live here — the
// browser only ever sees the final text.
//
// Only components exported from @hubspot/ui-extensions may be used in a card; the
// global `window`/`fetch` is not available (all backend work goes through
// runServerlessFunction). See app.functions/ for the two functions this calls.

import React, { useState, useEffect, useCallback } from 'react';
import {
  hubspot,
  Flex,
  Text,
  Select,
  TextArea,
  Button,
  ButtonRow,
  Divider,
  Alert,
  LoadingSpinner,
} from '@hubspot/ui-extensions';
import type { ExtensionPointApi } from '@hubspot/ui-extensions';

type Api = ExtensionPointApi<'crm.record.tab'>;
type RunServerless = Api['runServerlessFunction'];
type Actions = Api['actions'];

// HubSpot's object-type ids for the standard CRM objects → our plural names (the
// same strings the serverless functions and CRM v3 paths use). The card config
// only mounts it on these three; an unlisted type falls back to 'contacts'.
const OBJECT_TYPE_BY_ID: Record<string, 'contacts' | 'companies' | 'deals'> = {
  '0-1': 'contacts',
  '0-2': 'companies',
  '0-3': 'deals',
};

type ActionId = 'summarize' | 'draft' | 'nextSteps' | 'ask';

// The four actions, in card order. `needsDetail` marks the two that take a
// free-text input (draft topic / question) before running.
const ACTIONS: Array<{
  id: ActionId;
  label: string;
  needsDetail: boolean;
  detailLabel?: string;
  placeholder?: string;
}> = [
  { id: 'summarize', label: 'Summarize this record', needsDetail: false },
  {
    id: 'draft',
    label: 'Draft email',
    needsDetail: true,
    detailLabel: 'What should the email be about? (optional)',
    placeholder: 'e.g. following up on last week’s demo',
  },
  { id: 'nextSteps', label: 'Next steps', needsDetail: false },
  {
    id: 'ask',
    label: 'Ask',
    needsDetail: true,
    detailLabel: 'Your question',
    placeholder: 'e.g. what’s blocking this deal?',
  },
];

// unwrap normalizes a serverless result into { data, error }. HubSpot returns a
// discriminated union (status SUCCESS/ERROR); the function bodies also return an
// `{ error }` field on a handled failure. This flattens both so the component
// has one code path.
function unwrap(res: Awaited<ReturnType<RunServerless>>): { data: Record<string, unknown>; error?: string } {
  if (res.status === 'ERROR') return { data: {}, error: res.message || 'Serverless error' };
  const data = (res.response ?? {}) as Record<string, unknown>;
  const err = typeof data.error === 'string' ? data.error : undefined;
  return { data, error: err };
}

hubspot.extend<'crm.record.tab'>(({ context, runServerlessFunction, actions }) => (
  <HanzoAssistant context={context} runServerless={runServerlessFunction} actions={actions} />
));

interface CardProps {
  context: Api['context'];
  runServerless: RunServerless;
  actions: Actions;
}

const HanzoAssistant = ({ context, runServerless, actions }: CardProps) => {
  const objectType = OBJECT_TYPE_BY_ID[context.crm.objectTypeId] ?? 'contacts';
  const objectId = String(context.crm.objectId);

  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>('zen5');
  const [action, setAction] = useState<ActionId>('summarize');
  const [detail, setDetail] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Load the model catalog once (from /v1/models via the serverless proxy). A
  // failure here is non-fatal — the picker just keeps the default model.
  useEffect(() => {
    runServerless({ name: 'hanzo-assistant', parameters: { objectType, action: 'models', objectId } })
      .then((res) => {
        const { data } = unwrap(res);
        const list = data.models;
        if (Array.isArray(list) && list.length > 0) {
          const ids = list.map(String);
          setModels(ids);
          if (!ids.includes(model)) setModel(ids[0]);
        }
      })
      .catch(() => {
        /* keep default model */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentAction = ACTIONS.find((a) => a.id === action)!;

  const run = useCallback(() => {
    setBusy(true);
    setError('');
    setOutput('');
    runServerless({
      name: 'hanzo-assistant',
      propertiesToSend: ['hs_object_id'],
      parameters: { objectType, objectId, action, detail, model },
    })
      .then((res) => {
        const { data, error: err } = unwrap(res);
        if (err) throw new Error(err);
        setOutput(typeof data.text === 'string' ? data.text : '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [runServerless, objectType, objectId, action, detail, model]);

  const writeBack = useCallback(
    (kind: 'note' | 'task') => {
      setBusy(true);
      setError('');
      runServerless({
        name: 'hanzo-writeback',
        parameters: {
          kind,
          objectType,
          objectId,
          body: output,
          subject: kind === 'task' ? `Follow up: ${currentAction.label}` : null,
        },
      })
        .then((res) => {
          const { error: err } = unwrap(res);
          if (err) throw new Error(err);
          actions.addAlert({
            title: kind === 'task' ? 'Task created' : 'Note saved',
            message: kind === 'task' ? 'A follow-up task was added to this record.' : 'The note was added to this record.',
            type: 'success',
          });
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    },
    [runServerless, objectType, objectId, output, currentAction, actions],
  );

  return (
    <Flex direction="column" gap="md">
      <Text variant="microcopy">
        Hanzo AI over this {objectType.replace(/s$/, '')} record. Pick an action; the model runs on
        the record and its associated records. Nothing is saved until you choose to.
      </Text>

      {models.length > 0 && (
        <Select
          name="model"
          label="Model"
          value={model}
          options={models.map((m) => ({ label: m, value: m }))}
          onChange={(v) => setModel(String(v))}
        />
      )}

      <Select
        name="action"
        label="Action"
        value={action}
        options={ACTIONS.map((a) => ({ label: a.label, value: a.id }))}
        onChange={(v) => {
          setAction(v as ActionId);
          setOutput('');
          setError('');
        }}
      />

      {currentAction.needsDetail && (
        <TextArea
          name="detail"
          label={currentAction.detailLabel || 'Detail'}
          placeholder={currentAction.placeholder}
          value={detail}
          onChange={(v) => setDetail(String(v))}
        />
      )}

      <Button variant="primary" onClick={run} disabled={busy}>
        {busy ? 'Working…' : currentAction.label}
      </Button>

      {busy && <LoadingSpinner label="Asking Hanzo…" />}
      {error && (
        <Alert title="Something went wrong" variant="danger">
          {error}
        </Alert>
      )}

      {output && (
        <Flex direction="column" gap="sm">
          <Divider />
          <Text>{output}</Text>
          <ButtonRow>
            <Button onClick={() => writeBack('note')} disabled={busy}>
              Save as Note
            </Button>
            <Button onClick={() => writeBack('task')} disabled={busy}>
              Create Task
            </Button>
          </ButtonRow>
        </Flex>
      )}
    </Flex>
  );
};
