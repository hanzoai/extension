// Hanzo-for-JupyterLab config — the one backend this extension talks to and the
// tunables the settings registry exposes. The model gateway is api.hanzo.ai/v1
// (no `/api/` prefix — it is api.hanzo.ai already). Secrets never live here:
// the Hanzo `hk-` key is read from the JupyterLab settings registry at runtime,
// never bundled into source.

/** Where the Hanzo model gateway lives. `@hanzo/ai` defaults here too. */
export const HANZO_API_BASE_URL = 'https://api.hanzo.ai';

/** Default model when the user has not picked one. A Zen model (qwen3+). */
export const DEFAULT_MODEL = 'zen5';

/**
 * The settings-registry plugin id — must match the basename of the schema file
 * (`schema/plugin.json`) and the `id` the plugin registers under. JupyterLab
 * keys the loaded settings by `<package>:<schema-basename>`.
 */
export const PLUGIN_ID = '@hanzo/jupyter:plugin';

/**
 * The command id namespace. Every command this extension contributes is
 * `hanzo:<verb>` so they group together in the command palette and are
 * unambiguous in `when` clauses.
 */
export const CommandIds = {
  explainCell: 'hanzo:explain-cell',
  fixCell: 'hanzo:fix-cell',
  documentCell: 'hanzo:document-cell',
  optimizeCell: 'hanzo:optimize-cell',
  generateCell: 'hanzo:generate-cell',
  openPanel: 'hanzo:open-panel',
} as const;

/**
 * Resolved runtime settings the extension reads from the settings registry.
 * `apiKey` is the Hanzo `hk-` credential; empty means anonymous (the gateway
 * serves its public/limited models). `baseUrl` is overridable for self-hosted
 * gateways but defaults to api.hanzo.ai.
 */
export interface HanzoSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** The settings defaults, mirrored in schema/plugin.json. Pure. */
export const DEFAULT_SETTINGS: HanzoSettings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  baseUrl: HANZO_API_BASE_URL,
};

/**
 * Normalize a raw settings-registry composite into a {@link HanzoSettings},
 * filling defaults for missing/blank fields. The registry hands back `unknown`
 * per key; this is the single boundary that coerces it. Pure — unit-tested.
 */
export function resolveSettings(raw: {
  apiKey?: unknown;
  model?: unknown;
  baseUrl?: unknown;
}): HanzoSettings {
  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
  return {
    apiKey: str(raw.apiKey, DEFAULT_SETTINGS.apiKey),
    model: str(raw.model, DEFAULT_SETTINGS.model),
    baseUrl: str(raw.baseUrl, DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ''),
  };
}
