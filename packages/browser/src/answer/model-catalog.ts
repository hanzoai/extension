/**
 * Hanzo model catalog for the answer-engine model picker. Reads the REAL
 * catalog and keeps the text/chat families — never a hardcoded or fabricated
 * list. Switching the picker actually changes the `model` passed to the
 * @hanzo/ai search primitive.
 *
 * It reads catalog.hanzo.ai, not the API base. This is the PUBLIC catalog: a
 * read-only, edge-cached, tokenless list with `families` on it, and
 * catalog.hanzo.ai is the host that serves it. api.hanzo.ai/v1/models is the
 * authenticated OpenAI-compatible model list and answers 401 without a token —
 * it only looked public here because the ingress used to hand that path to the
 * catalog worker, which is exactly the two-implementations-of-one-address defect
 * that carve was deleted for (hanzoai/universe fd18448).
 *
 * The rows come back as `ModelCatalogEntry`, the shape `@hanzo/ui/models` reads,
 * so the picker is the shared `ModelSelector` and this file is only the fetch.
 * `@hanzo/ui/models` ships its own `fetchModelCatalog` and it is NOT usable
 * here: it reads `${baseUrl}/models`, the authenticated endpoint, which is the
 * 401 this surface must not hit while signed out.
 */

import type { ModelCatalogEntry } from '@hanzo/ui/models';
import { CATALOG_BASE_URL } from '../shared/config.js';

interface ModelRow {
  id: string;
  name?: string;
  fullName?: string;
  description?: string;
  tier?: string;
  context?: number | null;
}
interface FamilyRow {
  id: string;
  name?: string;
  description?: string;
  models?: string[];
}
interface ModelsResponse {
  data?: ModelRow[];
  families?: FamilyRow[];
}

/** Text/chat families to surface in the picker (embedding/image/audio excluded). */
const CHAT_FAMILIES = ['enso', 'zen5', 'zen3'];

/** The "let the router pick" option: no model is pinned and the cloud chooses.
 *  Always valid, so it is the seed and the fallback when the fetch is slow or
 *  fails — a dead selection is never shown. */
export const AUTO = 'auto';

const AUTO_MODEL: ModelCatalogEntry = {
  id: AUTO,
  label: 'Auto',
  family: 'Router',
  description: 'Routes to the best model',
  modality: 'chat',
};

export async function fetchCatalog(signal?: AbortSignal): Promise<ModelCatalogEntry[]> {
  const res = await fetch(`${CATALOG_BASE_URL}/v1/models`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`models ${res.status}`);
  const body = (await res.json()) as ModelsResponse;

  const byId = new Map<string, ModelRow>();
  for (const row of body.data ?? []) byId.set(row.id, row);

  const models: ModelCatalogEntry[] = [AUTO_MODEL];
  for (const fam of body.families ?? []) {
    if (!CHAT_FAMILIES.includes(fam.id)) continue;
    for (const id of fam.models ?? []) {
      const row = byId.get(id);
      models.push({
        id,
        label: row?.name || row?.fullName || id,
        // The catalog's own family label, so the picker groups the way the
        // catalog does rather than by an owner heuristic.
        family: fam.name || fam.id,
        description: row?.description || '',
        premium: Boolean(row?.tier),
        // Stated, not inferred: these families ARE the chat families, and
        // ModelSelector's default id heuristic would otherwise drop a name that
        // merely reads like an embedding model.
        modality: 'chat',
        ...(row?.context ? { context_window: row.context } : null),
      });
    }
  }
  return models;
}
