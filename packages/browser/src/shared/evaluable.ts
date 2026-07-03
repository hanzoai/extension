/**
 * The ONE cross-browser rule for caller-supplied JavaScript.
 *
 * Every `evaluate` surface (Chrome `Runtime.evaluate` over chrome.debugger,
 * Firefox `scripting.executeScript` trampoline) consumes the output of
 * `wrapEvaluable`: a single *expression* whose value — possibly a Promise —
 * is the result. Both consumers already await promises (`awaitPromise: true`
 * on CDP; `executeScript` resolves returned promises), so statement bodies
 * can be wrapped in an async IIFE without changing caller semantics.
 */

/**
 * Accept the code parameter under every alias the callers use:
 * `expression` (CDP), `code` (MCP/SDK), plus the legacy bridge aliases
 * `script` / `function` / `js`.
 */
export function pickEvaluable(params: Record<string, unknown> | null | undefined): string {
  const p = params ?? {};
  const raw = p.expression ?? p.code ?? p.script ?? p.function ?? p.js ?? '';
  return typeof raw === 'string' ? raw : String(raw);
}

/**
 * Make `evaluate` forgiving: a bare expression (`document.title`) is
 * returned as-is, but a statement body (`const b=…; b.click()`) is wrapped
 * in an async IIFE so it doesn't blow up with "expected expression, got
 * 'const'". Multi-statement bodies auto-`return` their trailing expression
 * (`const x=…; x` yields x, not undefined); an explicit `return` and
 * control-flow / declaration tails are left alone. Ready-made callables
 * (functions, arrows, IIFEs) pass through untouched — CDP calls them.
 */
export function wrapEvaluable(code: string): string {
  const t = (code ?? '').trim();
  if (!t) return 'undefined';
  // already a callable form — leave it (CDP calls it)
  if (/^(\(?\s*(async\s+)?function\b|\(?\s*\([^)]*\)\s*=>|\(\s*async\b)/.test(t)) return t;
  const looksStatement =
    /[;\n]/.test(t) || /^(const|let|var|if|for|while|switch|return|throw|await|try)\b/.test(t);
  if (!looksStatement) return t; // bare expression → return its value directly
  let body = t.replace(/;\s*$/, '');
  const cut = Math.max(body.lastIndexOf(';'), body.lastIndexOf('\n'));
  const head = cut >= 0 ? body.slice(0, cut + 1) : '';
  const last = (cut >= 0 ? body.slice(cut + 1) : body).trim();
  if (last && !/^(return|const|let|var|if|for|while|switch|throw|}|\/\/)/.test(last)) {
    body = head + ' return ' + last;
  }
  return `(async()=>{ ${body} })()`;
}
