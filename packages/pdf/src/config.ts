// PDF workspace config — the api.hanzo.ai model gateway, the default model, the
// pasted-key storage, and the pure context-windowing that keeps a 500-page
// filing from being fired at the model wholesale. Endpoints and the bearer
// choice mirror @hanzo/office-addin so the productivity suite stays DRY; the
// windowing is what a *document* surface adds on top.

export const API_BASE_URL = 'https://api.hanzo.ai';

// Default model. Overridable per-request via the picker; the gateway routes it.
export const DEFAULT_MODEL = 'zen5';

// localStorage key for the pasted Hanzo API key (`sk-…`). A pasted key needs no
// registered OAuth client, which is the zero-setup path a lawyer uses. (OAuth /
// hanzo.id device login is the documented future upgrade — see README.)
export const APIKEY_STORAGE_KEY = 'hanzo.pdf.apiKey';

// Context budget. A legal PDF can be hundreds of pages; the whole text won't fit
// a model window and shouldn't be sent. CONTEXT_CHAR_BUDGET caps the characters
// of document text we attach to any one request — chosen conservatively so it
// fits comfortably inside a modern context window alongside the reply, and is
// honest rather than optimal (we'd rather truncate visibly than silently drop).
export const CONTEXT_CHAR_BUDGET = 48_000;

// pickBearer chooses the credential to send: a pasted API key wins over an OAuth
// token (an explicit key is a deliberate override), else the token, else empty
// (anonymous — the gateway still serves public models). Pure — unit-tested.
export function pickBearer(apiKey: string, oauthToken: string): string {
  return (apiKey && apiKey.trim()) || (oauthToken && oauthToken.trim()) || '';
}

// chatCompletionsURL / modelsURL — the model gateway endpoints. /v1 only, never
// an /api/ prefix (api.hanzo.ai IS the api host).
export function chatCompletionsURL(): string {
  return `${API_BASE_URL}/v1/chat/completions`;
}
export function modelsURL(): string {
  return `${API_BASE_URL}/v1/models`;
}

// A page of extracted text, paired with its 1-based page number so a truncation
// note can name the exact page range that was sent.
export interface PageText {
  page: number;
  text: string;
}

// The result of windowing a document down to what we'll actually send: the
// concatenated text, the inclusive page range it covers, and whether anything
// was dropped (so the UI/prompt can say so honestly).
export interface DocumentContext {
  text: string;
  firstPage: number;
  lastPage: number;
  totalPages: number;
  truncated: boolean;
}

// buildContext turns per-page text into the context to attach, capped at
// `budget` characters. It walks pages IN ORDER from the requested start page and
// stops when adding the next page would exceed the budget — always including at
// least the start page (even if that one page alone is over budget, in which
// case it is hard-cut to the budget). `truncated` is true whenever we did not
// include every page in `pages`. Pure and total: no I/O, deterministic.
//
// startPage is 1-based and clamped into range; passing the current/visible page
// lets the caller window around what the reader is looking at, while the default
// (page 1) windows from the top for a whole-document action.
export function buildContext(
  pages: PageText[],
  budget: number = CONTEXT_CHAR_BUDGET,
  startPage: number = 1,
): DocumentContext {
  const total = pages.length;
  if (total === 0) {
    return { text: '', firstPage: 0, lastPage: 0, totalPages: 0, truncated: false };
  }

  // Clamp the start index into [0, total-1].
  const startIdx = Math.min(Math.max(startPage - 1, 0), total - 1);

  const chunks: string[] = [];
  let used = 0;
  let lastIdx = startIdx;
  let hardCut = false;

  for (let i = startIdx; i < total; i++) {
    const header = `\n\n===== Page ${pages[i].page} =====\n`;
    const body = pages[i].text;
    const addition = (chunks.length === 0 ? '' : header) + body;

    if (used + addition.length > budget) {
      if (chunks.length === 0) {
        // The very first page overflows on its own — hard-cut it so we always
        // return something, and mark truncated (we dropped part of this page).
        chunks.push(body.slice(0, budget));
        used = budget;
        hardCut = true;
      }
      break;
    }
    chunks.push(addition);
    used += addition.length;
    lastIdx = i;
  }

  // Truncated if we skipped pages before the start, stopped before the last
  // page, or hard-cut the single start page mid-way.
  const truncated = startIdx > 0 || lastIdx < total - 1 || hardCut;
  return {
    text: chunks.join(''),
    firstPage: pages[startIdx].page,
    lastPage: pages[lastIdx].page,
    totalPages: total,
    truncated,
  };
}

// contextNote is the one honest sentence we prepend to the document text so the
// model (and, echoed in the UI, the user) knows the scope of what it's seeing.
// Never claim we sent the whole document when we didn't.
export function contextNote(ctx: DocumentContext): string {
  if (ctx.totalPages === 0) return 'No selectable text was found in this PDF (it may be a scanned image).';
  const range =
    ctx.firstPage === ctx.lastPage
      ? `page ${ctx.firstPage}`
      : `pages ${ctx.firstPage}–${ctx.lastPage}`;
  return ctx.truncated
    ? `Context: ${range} of ${ctx.totalPages} (the document was truncated to fit; answer only from what is shown and say so if a full answer needs the omitted pages).`
    : `Context: the full document (${ctx.totalPages} page${ctx.totalPages === 1 ? '' : 's'}).`;
}
