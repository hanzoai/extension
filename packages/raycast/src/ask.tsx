// Ask Hanzo — the flagship view command. A Form collects a prompt (and lets the
// user apply an action to the current selection/clipboard: summarize, explain,
// rewrite, translate, fix grammar, or a freeform ask), then a Detail streams the
// completion live via @hanzo/ai and offers Copy / Paste actions on the result.
//
// This file is the ONLY view; all logic it depends on is pure (actions.ts) or
// thin adapters (hanzo.ts, selection.ts). React state here is just the streaming
// text + phase. UI is intentionally not unit-tested (Raycast React is hard to
// mount headless); the logic under it is covered in test/.

import { useEffect, useState } from "react";
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import {
  actionList,
  buildActionMessages,
  parseResult,
  type ActionContext,
  type ActionId,
} from "./actions.js";
import { streamChat } from "./hanzo.js";
import { captureSubject, preferences } from "./selection.js";
import { isHanzoKey } from "./config.js";

// The Ask form's submitted values: the action to run, the freeform instruction/
// prompt, and the target language (only meaningful for translate).
interface FormValues {
  action: ActionId;
  instruction: string;
  language: string;
}

// ResultView streams one completion into a Detail. It builds the request from the
// captured subject + form values once on mount, then appends each delta to state
// so the Detail re-renders live. Copy/Paste actions operate on the final parsed
// text.
function ResultView(props: {
  values: FormValues;
  ctx: ActionContext;
  apiKey: string;
  model: string;
}) {
  const { values, ctx, apiKey, model } = props;
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const messages = buildActionMessages(
          values.action,
          { instruction: values.instruction, language: values.language },
          ctx,
        );
        await streamChat(messages, (delta) => setText((t) => t + delta), {
          token: apiKey,
          model,
          signal: controller.signal,
        });
        setDone(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setDone(true);
      }
    })();
    // Run once for this result — the props are fixed for the view's lifetime
    // (ResultView is pushed with new props for each ask), so an empty dep array
    // is correct and complete. The cleanup aborts an in-flight stream on unmount.
    return () => controller.abort();
  }, []);

  const result = parseResult(text);
  const markdown = error ? `# Error\n\n${error}` : text || "_Asking Hanzo…_";

  return (
    <Detail
      isLoading={!done}
      markdown={markdown}
      actions={
        result && !error ? (
          <ActionPanel>
            <Action.CopyToClipboard
              title="Copy Result"
              content={result}
              icon={Icon.Clipboard}
            />
            <Action.Paste
              title="Paste Result"
              content={result}
              icon={Icon.Text}
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

// AskHanzo is the command's root: capture the subject on mount, gate on a valid
// key, then show the Form. On submit it pushes ResultView, which streams.
export default function AskHanzo() {
  const { push } = useNavigation();
  const [ctx, setCtx] = useState<ActionContext>({});
  const { apiKey, model } = preferences();

  useEffect(() => {
    captureSubject().then(setCtx);
  }, []);

  async function onSubmit(values: FormValues) {
    if (!isHanzoKey(apiKey)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Set your Hanzo API key",
        message: "Add your hk- key in this extension’s preferences (⌘,).",
      });
      return;
    }
    if (!values.instruction.trim() && values.action === "ask") {
      await showToast({ style: Toast.Style.Failure, title: "Enter a prompt" });
      return;
    }
    if (!ctx.text && values.action !== "ask") {
      await showToast({
        style: Toast.Style.Failure,
        title: "Nothing to work on",
        message: "This action needs selected or copied text. Try Ask instead.",
      });
      return;
    }
    push(
      <ResultView values={values} ctx={ctx} apiKey={apiKey} model={model} />,
    );
  }

  const subjectNote = ctx.text
    ? `Using your ${ctx.source} (${ctx.text.length} chars).`
    : "No selection or clipboard text captured — the Ask action still works.";

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Run"
            onSubmit={onSubmit}
            icon={Icon.Stars}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={subjectNote} />
      <Form.Dropdown id="action" title="Action" defaultValue="ask">
        {actionList().map((a) => (
          <Form.Dropdown.Item key={a.id} value={a.id} title={a.label} />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="instruction"
        title="Prompt"
        placeholder="Ask anything, or add an instruction for the selected action…"
      />
      <Form.TextField
        id="language"
        title="Language"
        placeholder="Target language for Translate (e.g. Spanish)"
        defaultValue="English"
      />
      <Form.Description text={`Model: ${model}`} />
    </Form>
  );
}
