// HubSpot CRM v3 REST API — pure request shaping + response parsing. Every
// function returns a PreparedCrmRequest (method + url + headers + optional body) or
// parses a response body; none opens a socket, so the whole API surface is
// unit-testable without a network. The serverless function (src/app/app.functions)
// is the thin glue that fetches these shapes with the per-portal OAuth access
// token HubSpot injects.
//
// The REST root is `${base}/crm/v3` (see config.crmApiRoot). All paths below are
// built on top of that. Docs:
// developers.hubspot.com/docs/reference/api/crm/objects.

import { crmApiRoot, type ObjectType } from '../config.js';

// A prepared HTTP request: the pieces a single fetch needs. Bearer-only — the
// CRM API is authorized by the OAuth access token. `body` is a JSON string when
// present (POST/PATCH), absent for GET. Pure output so a test asserts the exact
// method/url/headers/body without opening a socket.
export interface PreparedCrmRequest {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

// bearer builds the Authorization + Content-Type headers for a CRM request. The
// access token is the only credential the CRM API needs.
function bearer(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// enc encodes a single path segment. Object ids are numeric strings and types
// are a fixed vocabulary, but we encode defensively at this boundary so a stray
// character can never break the path (or worse, traverse it).
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// getObject — one CRM record with the requested properties. `properties` is
// joined into the comma-separated `properties` query param HubSpot expects; when
// empty, HubSpot returns its default property set. Used to read the record the
// card is mounted on before summarizing/drafting.
export function getObject(
  root: string,
  objectType: ObjectType,
  objectId: string,
  accessToken: string,
  properties: readonly string[] = [],
): PreparedCrmRequest {
  const q = new URLSearchParams();
  if (properties.length > 0) q.set('properties', properties.join(','));
  const query = q.toString();
  return {
    method: 'GET',
    url: `${root}/objects/${enc(objectType)}/${enc(objectId)}${query ? `?${query}` : ''}`,
    headers: bearer(accessToken),
  };
}

// getAssociations — the ids of records of `toObjectType` associated with one
// record. Used to pull a contact's deals/companies (and vice versa) so the model
// sees the record in context, not in isolation. HubSpot caps a page at 500 and
// paginates with `after`; the default limit is generous for a card summary.
export function getAssociations(
  root: string,
  fromObjectType: ObjectType,
  objectId: string,
  toObjectType: ObjectType,
  accessToken: string,
  limit = 100,
): PreparedCrmRequest {
  const q = new URLSearchParams({ limit: String(limit) });
  return {
    method: 'GET',
    url: `${root}/objects/${enc(fromObjectType)}/${enc(objectId)}/associations/${enc(toObjectType)}?${q.toString()}`,
    headers: bearer(accessToken),
  };
}

// batchReadObjects — read many records of one type by id in a single call, with
// the requested properties. Used to expand association ids (from getAssociations)
// into readable rows for the context, without one request per record.
export function batchReadObjects(
  root: string,
  objectType: ObjectType,
  ids: readonly string[],
  accessToken: string,
  properties: readonly string[] = [],
): PreparedCrmRequest {
  return {
    method: 'POST',
    url: `${root}/objects/${enc(objectType)}/batch/read`,
    headers: bearer(accessToken),
    body: JSON.stringify({
      properties: [...properties],
      inputs: ids.map((id) => ({ id })),
    }),
  };
}

// ── Write-back: engagements (Note / Task) ──────────────────────────────────
//
// The write-back is an engagement created on the record. HubSpot models Notes
// and Tasks as first-class CRM objects (`/objects/notes`, `/objects/tasks`) with
// their own required timestamp property; the association to the record is passed
// inline in the create body via the default association type. See
// noteWriteBack / taskWriteBack in write-back.ts for the payload assembly.

// createNote — POST a Note engagement. `body` is the fully-formed create payload
// (properties + associations) from write-back.noteWriteBack. Kept as pure
// request-shaping so the payload assembly is tested independently of the wire.
export function createNote(
  root: string,
  payload: unknown,
  accessToken: string,
): PreparedCrmRequest {
  return {
    method: 'POST',
    url: `${root}/objects/notes`,
    headers: bearer(accessToken),
    body: JSON.stringify(payload),
  };
}

// createTask — POST a Task engagement. Same shape as createNote against the
// `tasks` object.
export function createTask(
  root: string,
  payload: unknown,
  accessToken: string,
): PreparedCrmRequest {
  return {
    method: 'POST',
    url: `${root}/objects/tasks`,
    headers: bearer(accessToken),
    body: JSON.stringify(payload),
  };
}

// ── Response parsing ───────────────────────────────────────────────────────

// One CRM record as it appears in a getObject / batch-read response.
export interface CrmObject {
  id: string;
  properties: Record<string, string>;
}

// parseObject reads a getObject body into a typed record. Missing/undefined
// property values become '' (never undefined) so the context assembly renders
// predictably. Pure — unit-tested with plain objects.
export function parseObject(data: unknown): CrmObject {
  const d = data as { id?: unknown; properties?: Record<string, unknown> } | null;
  const rawProps = d && typeof d.properties === 'object' && d.properties ? d.properties : {};
  const properties: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    properties[k] = v == null ? '' : String(v);
  }
  return { id: String(d?.id ?? ''), properties };
}

// parseObjects reads a batch-read body (`{ results: [...] }`) into a typed list,
// dropping any element with no id. Pure.
export function parseObjects(data: unknown): CrmObject[] {
  const results = (data as { results?: unknown[] } | null)?.results;
  const rows = Array.isArray(results) ? results : [];
  return rows.map(parseObject).filter((o) => o.id.length > 0);
}

// parseAssociationIds reads a getAssociations body (`{ results: [{ toObjectId }]
// | [{ id }] }`) into the list of associated record ids. HubSpot has returned
// both `toObjectId` (v4 associations) and `id` (v3) shapes across the CRM API;
// we accept either at this boundary so a version shift can't silently drop
// associations. Pure — unit-tested.
export function parseAssociationIds(data: unknown): string[] {
  const results = (data as { results?: unknown[] } | null)?.results;
  const rows = Array.isArray(results) ? results : [];
  const ids: string[] = [];
  for (const r of rows) {
    const o = r as { toObjectId?: unknown; id?: unknown };
    const raw = o?.toObjectId ?? o?.id;
    if (raw != null && String(raw).length > 0) ids.push(String(raw));
  }
  return ids;
}
