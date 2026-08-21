import React from 'react';
import { YStack } from '@hanzo/ui';
import { Code } from '@hanzo/ui/chat';
import { blocks } from './markdown.js';

/**
 * An answer's text, as both surfaces render it: prose as HTML, fenced code as
 * the shared `@hanzo/ui/chat` Code block — which is what carries the language
 * label and the copy control.
 *
 * The `markdown` class is the prose stylesheet's hook and the only thing left
 * here that is CSS rather than a token; the pipeline itself is `blocks()`.
 */
export function Prose({ text }: { text: string }) {
  if (!text) return null;
  return (
    <YStack gap="$3" width="100%">
      {blocks(text).map((b, i) =>
        'code' in b ? (
          <Code key={i} language={b.lang} value={b.code}>
            {b.code}
          </Code>
        ) : (
          <div key={i} className="markdown" dangerouslySetInnerHTML={{ __html: b.html }} />
        ),
      )}
    </YStack>
  );
}
