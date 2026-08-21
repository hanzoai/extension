/**
 * Minimal, XSS-safe Markdown for a streamed answer. Escapes first, then applies
 * a small whitelist of inline/block transforms. Only http(s) links are emitted.
 * No dependency — an answer needs headings, bold/italic, code, inline
 * `[text](url)` citations, and bullet/number lists.
 *
 * ONE renderer for both surfaces. The sidebar used to carry its own five-regex
 * version, which is how the two drifted: that one turned every newline into a
 * `<br>` and never made a list, so the same answer read as a wall of text in the
 * sidebar and as prose on the new tab.
 *
 * Fenced code comes back as a BLOCK rather than as `<pre>` inside the HTML,
 * because `@hanzo/ui/chat` renders code with a label bar and a copy control and
 * that cannot be expressed as a string. `blocks()` is the split; `renderMarkdown`
 * is the prose half, kept exported for callers with no code to show.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  // Inline code first so its contents aren't further transformed.
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // [text](url) — only http(s) URLs; text keeps prior transforms applied after.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
    const safeUrl = url.replace(/"/g, '%22');
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length + 1; // h2..h5
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join('\n');
}

/** Prose, already HTML, or one fenced code block with its declared language. */
export type Block = { html: string } | { code: string; lang: string };

/**
 * Split an answer into prose and fenced code.
 *
 * An UNTERMINATED fence is still a code block: the text arrives a token at a
 * time, so the closing fence is simply not written yet, and treating the opener
 * as prose would render the first lines of a program as paragraphs and then
 * reflow them the instant the fence closed.
 */
export function blocks(md: string): Block[] {
  const out: Block[] = [];
  let prose = '';

  const flush = () => {
    const html = renderMarkdown(prose);
    if (html) out.push({ html });
    prose = '';
  };

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\w*)\s*$/.exec(lines[i]);
    if (!fence) {
      prose += lines[i] + '\n';
      continue;
    }
    flush();
    const body: string[] = [];
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
    out.push({ code: body.join('\n'), lang: fence[1] });
  }
  flush();
  return out;
}
