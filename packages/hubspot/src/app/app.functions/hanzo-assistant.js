// Serverless backend for the Hanzo AI card — the ONLY place the Hanzo key lives.
//
// The card (HanzoAssistant.tsx) calls this with the record's type/id, the chosen
// action, an optional detail (draft topic / question), and the chosen model. This
// function reads the record + its associated records with the app's OAuth token,
// assembles the model context and runs the completion through the PURE
// @hanzo/hubspot core (record → context blocks → windowed context → @hanzo/ai),
// and returns the text. The Hanzo key (HANZO_API_KEY secret) and the CRM token
// never leave this backend — the browser only ever sees the final answer.
//
// context shape (HubSpot serverless):
//   context.propertiesToSend  – CRM props the card requested (hs_object_id, etc.)
//   context.parameters        – the card's payload (objectType, action, detail, model)
//   process.env.PRIVATE_APP_ACCESS_TOKEN – the app's per-portal OAuth token
//   process.env.HANZO_API_KEY – the Hanzo bearer (declared in serverless.json secrets)

const hubspot = require('@hubspot/api-client');
const {
  isObjectType,
  DEFAULT_PROPERTIES,
  ASSOCIATED_TYPES,
  buildContextBlocks,
  assembleRecordContext,
  actionTask,
  complete,
  listModels,
} = require('@hanzo/hubspot');

// Read the primary record + its associated records with the app's OAuth token,
// returning parsed CrmObjects arranged for buildContextBlocks. Uses the official
// @hubspot/api-client (no bespoke HTTP), so pagination/retries are handled.
async function loadRecord(client, objectType, objectId) {
  const primaryResp = await client.crm.objects.basicApi.getById(
    objectType,
    objectId,
    DEFAULT_PROPERTIES[objectType],
  );
  const primary = { id: String(primaryResp.id), properties: normalizeProps(primaryResp.properties) };

  const associations = {};
  for (const assocType of ASSOCIATED_TYPES[objectType]) {
    const idsResp = await client.crm.associations.v4.basicApi.getPage(
      objectType,
      objectId,
      assocType,
      undefined,
      50,
    );
    const ids = (idsResp.results || [])
      .map((r) => String(r.toObjectId != null ? r.toObjectId : r.id))
      .filter((id) => id.length > 0);
    if (ids.length === 0) continue;
    const batch = await client.crm.objects.batchApi.read(assocType, {
      properties: DEFAULT_PROPERTIES[assocType],
      inputs: ids.slice(0, 10).map((id) => ({ id })),
    });
    associations[assocType] = (batch.results || []).map((o) => ({
      id: String(o.id),
      properties: normalizeProps(o.properties),
    }));
  }
  return { primary, associations };
}

// normalizeProps coerces every property value to a string (the shape the pure
// core expects); null/undefined become ''.
function normalizeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) out[k] = v == null ? '' : String(v);
  return out;
}

exports.main = async (context = {}) => {
  const params = context.parameters || {};
  const objectType = params.objectType;
  const action = params.action || 'summarize';
  const detail = params.detail || '';
  const model = params.model || undefined;
  const hanzoKey = process.env.HANZO_API_KEY || '';

  // The model-catalog request powers the card's picker. It needs neither a record
  // nor the CRM token — only the Hanzo bearer — so it short-circuits here.
  if (action === 'models') {
    try {
      return { models: await listModels({ token: hanzoKey }) };
    } catch (error) {
      return { error: (error && error.message) || 'Unable to list models' };
    }
  }

  if (!isObjectType(objectType)) {
    return { error: `Unsupported object type: ${objectType}` };
  }
  const objectId = String((context.propertiesToSend || {}).hs_object_id || params.objectId || '');
  if (!objectId) {
    return { error: 'Missing record id (hs_object_id).' };
  }
  const crmToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  if (!crmToken) {
    return { error: 'Missing CRM access token.' };
  }

  try {
    const client = new hubspot.Client({ accessToken: crmToken });
    const { primary, associations } = await loadRecord(client, objectType, objectId);

    const blocks = buildContextBlocks(objectType, primary, associations);
    const ctx = assembleRecordContext(blocks);
    const task = actionTask(action, detail);
    const text = await complete(task, ctx, { token: hanzoKey, model });

    return { text, truncated: ctx.truncated };
  } catch (error) {
    console.error('hanzo-assistant error:', error && error.message, error && error.stack);
    return { error: (error && error.message) || 'Unknown error' };
  }
};
