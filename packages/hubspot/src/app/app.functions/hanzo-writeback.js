// Serverless backend for write-back — creates a Note or Task engagement on the
// record, associated via the default HUBSPOT_DEFINED edge. The card calls this
// after the user reviews an AI result and clicks "Save as Note" / "Create Task".
//
// The payload assembly (properties + associations) is the PURE @hanzo/hubspot
// core (noteWriteBack / taskWriteBack), so the exact create body is unit-tested;
// this function is the thin async edge that POSTs it with the app's OAuth token.
//
// context.parameters: { kind: 'note' | 'task', objectType, objectId, body,
//                       subject? (task title), dueTimestamp? (task due, ISO) }
// process.env.PRIVATE_APP_ACCESS_TOKEN – the app's per-portal OAuth token

const hubspot = require('@hubspot/api-client');
const { isObjectType, noteWriteBack, taskWriteBack } = require('@hanzo/hubspot');

exports.main = async (context = {}) => {
  const params = context.parameters || {};
  const kind = params.kind || 'note';
  const objectType = params.objectType;
  const objectId = String(params.objectId || (context.propertiesToSend || {}).hs_object_id || '');
  const body = String(params.body || '');

  if (!isObjectType(objectType)) return { error: `Unsupported object type: ${objectType}` };
  if (!objectId) return { error: 'Missing record id.' };
  if (!body.trim()) return { error: 'Nothing to write back (empty body).' };

  const crmToken = process.env.PRIVATE_APP_ACCESS_TOKEN;
  if (!crmToken) return { error: 'Missing CRM access token.' };

  try {
    const client = new hubspot.Client({ accessToken: crmToken });
    if (kind === 'task') {
      const subject = String(params.subject || 'Follow up (Hanzo AI)');
      const payload = taskWriteBack(objectType, objectId, subject, body, params.dueTimestamp);
      const created = await client.crm.objects.basicApi.create('tasks', payload);
      return { id: String(created.id), kind: 'task' };
    }
    const payload = noteWriteBack(objectType, objectId, body);
    const created = await client.crm.objects.basicApi.create('notes', payload);
    return { id: String(created.id), kind: 'note' };
  } catch (error) {
    console.error('hanzo-writeback error:', error && error.message, error && error.stack);
    return { error: (error && error.message) || 'Unknown error' };
  }
};
