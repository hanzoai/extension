import React from 'react';

import { MARK_BLOCKS } from '@hanzo/logo/logos';

/** The Hanzo mark. Monochrome — it inherits colour from its parent. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 67 67" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {MARK_BLOCKS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}
