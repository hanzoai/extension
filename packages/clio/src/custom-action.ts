// Clio Custom Actions land here. When a lawyer clicks a Hanzo button Clio has
// rendered on a matter, Clio opens this app's deep-link URL with four query
// params: `custom_action_id`, `user_id`, `subject_url` (URL-encoded API URL of
// the record, e.g. /api/v4/matters/1234), and `custom_action_nonce`.
//
// IMPORTANT (Clio's real contract): the nonce is NOT a locally-verifiable HMAC.
// It is a SINGLE-USE code (60s expiry) that the app passes BACK to the Clio API
// as a query param on its next authenticated request; Clio validates it
// server-side, confirming the click's user matches the OAuth token — a bad or
// stale nonce makes that request 403. So this module is PURE parsing only; the
// validation is "make an authenticated Clio call carrying the nonce" (the app
// does this when it loads the matter), not a signature check we perform.

export interface CustomActionContext {
  // The record the action fired on, as a (possibly URL-encoded) Clio API URL,
  // e.g. /api/v4/matters/1234 or https://app.clio.com/api/v4/matters/1234.
  subjectUrl: string;
  customActionId: string;
  userId: string;
  // Single-use code to replay to the Clio API for server-side validation.
  nonce: string;
  // The parsed record type + id from subject_url, when it is a matter.
  matterId?: number;
  subjectType?: string; // 'matters' | 'contacts' | 'documents' | 'bills'
}

// parseSubjectUrl extracts the record type and numeric id from a Clio
// subject_url. Clio's REST URLs are `.../api/v4/{type}/{id}(.json)?`; the value
// may be URL-encoded (%2Fapi%2Fv4%2F…) and may be a bare path or a full URL.
// Returns empty when it doesn't match (defensive — this is external input). Pure.
export function parseSubjectUrl(subjectUrl: string): { subjectType?: string; recordId?: number } {
  if (!subjectUrl) return {};
  // Clio URL-encodes subject_url; decode first (safe on an already-decoded value).
  let decoded = subjectUrl;
  try {
    decoded = decodeURIComponent(subjectUrl);
  } catch {
    /* not encoded — use as-is */
  }
  let path: string;
  try {
    path = new URL(decoded).pathname;
  } catch {
    path = decoded; // tolerate a bare path
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
    customActionId: get('custom_action_id'),
    userId: get('user_id'),
    nonce: get('custom_action_nonce'),
    subjectType,
    matterId: subjectType === 'matters' ? recordId : undefined,
  };
}
