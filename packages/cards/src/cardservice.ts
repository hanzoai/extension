/**
 * Google Workspace CardService emitter.
 *
 * Google Apps Script's `CardService` builds cards from runtime objects
 * (`CardService.newCardBuilder()...`), not from JSON — the objects only exist
 * inside the Apps Script runtime. So this emitter produces a documented,
 * declarative JSON shape that mirrors the CardService object graph
 * (`header` + `sections[].widgets[]`): an Apps Script host maps each widget
 * node to the matching `CardService.new*` call.
 *
 * Widget node `type` maps to a CardService factory:
 *   - `textParagraph`  -> `newTextParagraph().setText()`
 *   - `decoratedText`  -> `newDecoratedText().setText().setTopLabel()`
 *   - `selectionInput` -> `newSelectionInput().setType(DROPDOWN)...`
 *   - `textInput`      -> `newTextInput().setFieldName().setValue()`
 *   - `buttonList`     -> `newButtonSet()` of `newTextButton()`
 *   - `divider`        -> `newDivider()`
 * Every action node carries `functionName` (the Apps Script callback) and
 * `parameters` (the stable ActionId + payload).
 *
 * See https://developers.google.com/apps-script/reference/card-service
 */
import {
  ActionId,
  PROMPT_INPUT_ID,
  type ModelOption,
  type PanelSpec,
  type QuickAction,
} from './spec';

/** An onClick action mapped to an Apps Script callback function. */
export interface CardAction {
  /** Apps Script global function the host binds this action to. */
  functionName: string;
  /** Parameters passed to the callback. `action` is the stable ActionId. */
  parameters: Record<string, string>;
}

export interface CardWidget {
  type:
    | 'textParagraph'
    | 'decoratedText'
    | 'selectionInput'
    | 'textInput'
    | 'buttonList'
    | 'divider';
  [key: string]: unknown;
}

export interface CardSection {
  /** Optional section header. */
  header?: string;
  widgets: CardWidget[];
}

export interface CardHeader {
  title: string;
  subtitle?: string;
  /** Image URL for the header icon, when the icon is a URL. */
  imageUrl?: string;
}

export interface CardServiceJson {
  header: CardHeader;
  sections: CardSection[];
}

/** Every action routes through one Apps Script dispatcher callback. */
export const CALLBACK_FUNCTION = 'onHanzoAction';

function action(actionId: string, extra: Record<string, string> = {}): CardAction {
  return { functionName: CALLBACK_FUNCTION, parameters: { action: actionId, ...extra } };
}

function selectionItem(o: ModelOption, selectedValue: string): Record<string, unknown> {
  return { text: o.label ?? o.id, value: o.id, selected: o.id === selectedValue };
}

/**
 * Emit the CardService JSON shape for a {@link PanelSpec}.
 */
export function toCardServiceJson(spec: PanelSpec): CardServiceJson {
  const header: CardHeader = { title: spec.title };
  if (spec.subtitle) header.subtitle = spec.subtitle;
  if (spec.icon && isUrl(spec.icon)) header.imageUrl = spec.icon;
  else if (spec.icon) header.title = `${spec.icon} ${spec.title}`;

  const sections: CardSection[] = [];

  if (spec.signedIn === false) {
    sections.push({
      widgets: [
        { type: 'textParagraph', text: spec.signInPrompt ?? 'Sign in to Hanzo to use the assistant.' },
        {
          type: 'buttonList',
          buttons: [
            { text: spec.signInLabel ?? 'Sign in', onClick: action(ActionId.SignIn) },
          ],
        },
      ],
    });
    if (spec.footer) {
      sections.push({ widgets: [{ type: 'textParagraph', text: spec.footer }] });
    }
    return { header, sections };
  }

  // Model picker as a DROPDOWN selectionInput.
  if (spec.modelPicker && spec.modelPicker.options.length > 0) {
    const mp = spec.modelPicker;
    sections.push({
      widgets: [
        {
          type: 'selectionInput',
          selectionType: 'DROPDOWN',
          fieldName: ActionId.ModelSelect,
          label: mp.label ?? 'Model',
          onChangeAction: action(ActionId.ModelSelect),
          items: mp.options.map((o) => selectionItem(o, mp.value)),
        },
      ],
    });
  }

  // Quick actions as a buttonList.
  if (spec.quickActions && spec.quickActions.length > 0) {
    sections.push({
      widgets: [
        {
          type: 'buttonList',
          buttons: spec.quickActions.map((a: QuickAction) => ({
            text: a.label,
            filled: a.style === 'primary',
            onClick: action(`${ActionId.QuickAction}:${a.id}`, { chip: a.id }),
          })),
        },
      ],
    });
  }

  // Output as a textParagraph (CardService renders limited HTML).
  if (spec.output) {
    sections.push({ header: 'Response', widgets: [{ type: 'textParagraph', text: spec.output }] });
  }

  // Prompt input + submit button.
  if (spec.input) {
    const inp = spec.input;
    const textInput: CardWidget = {
      type: 'textInput',
      fieldName: PROMPT_INPUT_ID,
      title: inp.placeholder ?? 'Ask Hanzo',
      multiline: inp.multiline ?? true,
    };
    if (inp.value) textInput.value = inp.value;
    sections.push({
      widgets: [
        textInput,
        {
          type: 'buttonList',
          buttons: [
            { text: inp.submitLabel ?? 'Send', filled: true, onClick: action(ActionId.PromptSubmit) },
          ],
        },
      ],
    });
  }

  // Footer.
  if (spec.footer) {
    sections.push({ widgets: [{ type: 'textParagraph', text: spec.footer }] });
  }

  return { header, sections };
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
