import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AUTO_MODEL, type ChatModel, type ModelGroup } from './model-catalog.js';

/**
 * The model picker: a filterable menu over the grouped catalog, with Auto — the
 * router — pinned at the top as the one entry that is always valid.
 *
 * Presentational: the catalog and the choice are both injected. It never fetches.
 */

// Tiers mirror @hanzo/plans (the pricing SoT); shown in the upgrade banner.
// Full plan detail lives at console.hanzo.ai/pricing.
const TIERS = [
  { name: 'Pro', price: '$20' },
  { name: 'Max', price: '$100' },
  { name: 'Ultra', price: '$200' },
];

export interface ModelsProps {
  groups: ModelGroup[];
  current: ChatModel;
  onPick: (model: ChatModel) => void;
}

export function Models({ groups, current, onPick }: ModelsProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          models: g.models.filter(
            (m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.models.length),
    [groups, q],
  );

  return (
    <div className="ae-picker" ref={ref}>
      <button className="ae-picker-btn" onClick={() => setOpen((v) => !v)} title="Choose model">
        <span className="ae-dot" />
        {current.name}
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="ae-picker-menu">
          <input
            className="ae-picker-filter"
            placeholder="Search models…"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="ae-picker-list">
            <button
              className={'ae-model-row' + (current.id === AUTO_MODEL.id ? ' active' : '')}
              onClick={() => {
                onPick(AUTO_MODEL);
                setOpen(false);
              }}
            >
              <span className="ae-model-name">Auto</span>
              <span className="ae-model-desc">Routes to the best model</span>
            </button>
            {shown.map((g) => (
              <div key={g.family} className="ae-model-group">
                <div className="ae-model-group-label">{g.label}</div>
                {g.models.map((m) => (
                  <button
                    key={m.id}
                    className={'ae-model-row' + (current.id === m.id ? ' active' : '')}
                    onClick={() => {
                      onPick(m);
                      setOpen(false);
                    }}
                  >
                    <span className="ae-model-name">
                      {m.name}
                      {m.tier && <span className="ae-badge">{m.tier}</span>}
                    </span>
                    {m.description && <span className="ae-model-desc">{m.description}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <a className="ae-plan-banner" href="https://console.hanzo.ai/pricing" target="_blank" rel="noreferrer">
            <span>Unlock every model</span>
            <span className="ae-plan-tiers">
              {TIERS.map((t) => (
                <span key={t.name} className="ae-plan-tier">
                  {t.name} <b>{t.price}</b>
                </span>
              ))}
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
