/**
 * Hanzo model catalog for the answer-engine model picker. Reads the REAL
 * catalog from `GET api.hanzo.ai/v1/models` (public, no auth) and keeps the
 * text/chat families — never a hardcoded or fabricated list. Switching the
 * picker actually changes the `model` passed to the @hanzo/ai search primitive.
 */

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

/** The "let the gateway route" option — mirrors Scira's Auto. */
export const AUTO_MODEL: ChatModel = {
  id: "auto",
  name: "Auto",
  description: "Routes to the best model",
  tier: "",
  family: "auto",
  context: null,
};

export async function fetchModelCatalog(
  apiBase: string,
  signal?: AbortSignal,
): Promise<{ groups: ModelGroup[]; flat: ChatModel[] }> {
  const res = await fetch(`${apiBase}/v1/models`, signal ? { signal } : {});
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
