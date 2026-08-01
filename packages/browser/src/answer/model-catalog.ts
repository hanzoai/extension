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
 */

import { CATALOG_BASE_URL } from '../shared/config.js';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
  tier: string;
  family: string;
  context: number | null;
}

export interface ModelGroup {
  family: string;
  label: string;
  models: ChatModel[];
}

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
const CHAT_FAMILIES = ["enso", "zen5", "zen3"];

/** The "let the router pick" option: no model is pinned and the cloud chooses. */
export const AUTO_MODEL: ChatModel = {
  id: "auto",
  name: "Auto",
  description: "Routes to the best model",
  tier: "",
  family: "auto",
  context: null,
};

export async function fetchModelCatalog(
  signal?: AbortSignal,
): Promise<{ groups: ModelGroup[]; flat: ChatModel[] }> {
  const res = await fetch(`${CATALOG_BASE_URL}/v1/models`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`models ${res.status}`);
  const body = (await res.json()) as ModelsResponse;

  const byId = new Map<string, ModelRow>();
  for (const row of body.data ?? []) byId.set(row.id, row);

  const groups: ModelGroup[] = [];
  for (const fam of body.families ?? []) {
    if (!CHAT_FAMILIES.includes(fam.id)) continue;
    const models: ChatModel[] = [];
    for (const id of fam.models ?? []) {
      const row = byId.get(id);
      models.push({
        id,
        name: row?.name || row?.fullName || id,
        description: row?.description || "",
        tier: row?.tier || "",
        family: fam.id,
        context: row?.context ?? null,
      });
    }
    if (models.length) {
      groups.push({ family: fam.id, label: fam.name || fam.id, models });
    }
  }

  const flat = groups.flatMap((g) => g.models);
  return { groups, flat };
}
