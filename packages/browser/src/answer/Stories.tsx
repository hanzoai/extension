import React, { type CSSProperties } from 'react';
import { SizableText, XStack, YStack } from '@hanzo/ui/primitives';
import { measure } from '@hanzo/ui/chat';
import type { NewsItem } from './news.js';

/**
 * Top stories — the idle state of the answer surface, under the composer and
 * cut from the same material: the composer's ground and its one 1px edge
 * (`--composer-ground`, `--composer-edge`, @hanzo/ui glass.css), at its column's
 * width, the text standing as far in from a card's edge as the field's does
 * from the frame's. No shadow. Under a pointer a card takes a step of ink into
 * its ground, eased (gui's `quickest`, 150ms) — a step, not `$hover`, which in
 * dark is a darker ground than the composer's and would sink the card.
 *
 * Renders nothing at all when the feed is empty, so a failed fetch leaves a
 * clean page rather than an empty frame.
 */

/** The space between cards and between the heading and the cards, px. */
const GAP = 8;

/** Where a card's words stand in from its edge, px: the composer field's own inset. */
const TEXT = 16;

/** A card's ground under a pointer: the composer's, with 6% of the ink mixed in.
 *  Stated once on the list, as a custom property, which no gui prop carries. */
const LIFT = { '--story-lift': 'color-mix(in srgb, var(--composer-ground), var(--foreground) 6%)' } as CSSProperties;

export function Stories({ items, limit = 6 }: { items: NewsItem[]; limit?: number }) {
  if (!items.length) return null;
  return (
    <YStack {...measure} data-slot="stories" gap={GAP} style={LIFT}>
      <SizableText fontSize={12} lineHeight={16} color="$soft" px={TEXT}>
        Top stories
      </SizableText>
      <XStack flexWrap="wrap" gap={GAP}>
        {items.slice(0, limit).map((n) => (
          <YStack
            key={n.url}
            render="a"
            {...{ href: n.url, target: '_blank', rel: 'noreferrer' }}
            data-slot="story"
            width={`calc(50% - ${GAP / 2}px)`}
            $max-sm={{ width: '100%' }}
            gap={4}
            px={TEXT}
            py={12}
            rounded={12}
            borderWidth={1}
            borderColor="var(--composer-edge)"
            bg="var(--composer-ground)"
            hoverStyle={{ bg: 'var(--story-lift)' }}
            transition="quickest"
            cursor="pointer"
          >
            <SizableText fontSize={14} lineHeight={20} color="$ink" numberOfLines={2}>
              {n.title}
            </SizableText>
            <SizableText fontSize={12} lineHeight={16} color="$soft" numberOfLines={1}>
              {n.source}
              {typeof n.points === 'number' ? ` · ${n.points} pts` : ''}
            </SizableText>
          </YStack>
        ))}
      </XStack>
    </YStack>
  );
}
