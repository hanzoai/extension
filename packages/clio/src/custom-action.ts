// Clio Custom Actions land here. When a lawyer clicks a Hanzo button Clio has
// rendered on a matter, Clio opens this app's deep-link URL with a signed
// context in the query string: `subject_url` (the Clio API URL of the record
// the button was on), `user_id`, `subject_id`, and `custom_action_nonce` (an
// HMAC of the params, keyed by the app's client_secret — verified SERVER-side).
//
// This module is PURE parsing: pull the matter id out of `subject_url`, and
// expose the fields the server needs to verify the nonce. Nonce verification
// itself is server.ts (it needs the secret); we only shape the input.

export interface CustomActionContext {
  // The record the action fired on, as a Clio API URL, e.g.
  // https://app.clio.com/api/v4/matters/1234.json
  subjectUrl: string;
  subjectId: string;
  userId: string;
  nonce: string;
  // The parsed record type + id from subject_url, when it is a matter.
  matterId?: number;
  subjectType?: string; // 'matters' | 'contacts' | 'documents' | 'bills'
}

// parseSubjectUrl extracts the record type and numeric id from a Clio
// subject_url. Clio's REST URLs are `${base}/api/v4/{type}/{id}(.json)?`.
// Returns undefined id/type when it doesn't match (a defensive boundary — this
// is external input). Pure.
export function parseSubjectUrl(subjectUrl: string): { subjectType?: string; recordId?: number } {
  if (!subjectUrl) return {};
  let path: string;
  try {
    path = new URL(subjectUrl).pathname;
  } catch {
    path = subjectUrl; // tolerate a bare path
  }
  const m = /\/api\/v4\/([a-z_]+)\/(\d+)(?:\.json)?$/.exec(path);
  if (!m) return {};
  return { subjectType: m[1], recordId: Number(m[2]) };
}

// parseCustomAction turns the deep-link query params (a URLSearchParams or a
// plain record) into a CustomActionContext, resolving the matter id when the
// action fired on a matter. Missing params become empty strings so the shape is
// always complete. Pure — the caller reads window.location in app.ts.
export function parseCustomAction(params: URLSearchParams | Record<string, string>): CustomActionContext {
  const get = (k: string): string =>
    params instanceof URLSearchParams ? params.get(k) ?? '' : params[k] ?? '';

  const subjectUrl = get('subject_url');
  const { subjectType, recordId } = parseSubjectUrl(subjectUrl);
  return {
    subjectUrl,
    subjectId: get('subject_id'),
    userId: get('user_id'),
    nonce: get('custom_action_nonce'),
    subjectType,
    matterId: subjectType === 'matters' ? recordId : undefined,
  };
}
