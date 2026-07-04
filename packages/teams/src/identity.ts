/**
 * Identity — Teams/AAD user ↔ Hanzo, via `@hanzo/iam`.
 *
 * Two supported models, both resolving to a per-request {@link HanzoIdentity}:
 *
 *  1. **Per-tenant key** (default, complete out of the box): the tenant is
 *     provisioned with one `HANZO_API_KEY`. Every Teams user in that tenant
 *     acts as that Hanzo principal — the enterprise/regulated-org pattern.
 *  2. **Per-user link**: a Teams user presents a Hanzo IAM JWT (obtained via
 *     Teams SSO/OAuth). `resolveFromToken` validates it with
 *     `@hanzo/iam`'s `validateToken` and derives the Hanzo org from the `sub`
 *     (`org/username`) claim.
 *
 * Only token validation and claim parsing live here; wiring the SSO flow is the
 * bot's job. Kept side-effect-free apart from the `validateToken` network call.
 */
import { validateToken, type JwtClaims } from '@hanzo/iam';

/** A resolved Hanzo principal for a Teams user. */
export interface HanzoIdentity {
  /** Whether this request is authorized to call Hanzo AI. */
  signedIn: boolean;
  /** Hanzo org (from the `sub` prefix), when known. */
  org?: string;
  /** Hanzo username (from the `sub` suffix), when known. */
  username?: string;
  /** User email, when the token carries it. */
  email?: string;
}

/**
 * Split a Hanzo `sub` (`"org/username"`) into its parts. Returns `undefined`
 * parts when the claim is missing or not in that form.
 */
export function parseSub(sub: string | undefined): {
  org?: string;
  username?: string;
} {
  if (!sub) return {};
  const slash = sub.indexOf('/');
  if (slash < 0) {
    // No org prefix: the whole value is the username.
    return { username: sub };
  }
  // Split on the first slash; omit an empty org or username rather than leaking
  // the separator (`"/alice"` → username `"alice"`, `"acme/"` → org `"acme"`).
  const org = sub.slice(0, slash);
  const username = sub.slice(slash + 1);
  return {
    ...(org ? { org } : {}),
    ...(username ? { username } : {}),
  };
}

/** Build a {@link HanzoIdentity} from validated JWT claims. */
export function identityFromClaims(claims: JwtClaims): HanzoIdentity {
  const { org, username } = parseSub(claims.sub);
  return {
    signedIn: true,
    ...(org ? { org } : {}),
    ...(username ? { username } : {}),
    ...(claims.email ? { email: claims.email } : {}),
  };
}

/** The signed-out identity — the tenant has no Hanzo key and no user token. */
export function anonymous(): HanzoIdentity {
  return { signedIn: false };
}

/** Per-tenant model: a configured API key means every request is signed in. */
export function tenantIdentity(hasApiKey: boolean): HanzoIdentity {
  return hasApiKey ? { signedIn: true } : anonymous();
}

/**
 * Config for {@link resolveFromToken} — the exact `@hanzo/iam` validator config
 * (`serverUrl` + `clientId` are required; the rest are split-horizon/JWKS knobs).
 */
export type TokenConfig = Parameters<typeof validateToken>[1];

/**
 * Validate a Hanzo IAM JWT and resolve the identity. Returns {@link anonymous}
 * when validation fails — an invalid token is signed-out, not an error.
 *
 * `validateToken` returns a discriminated union: `{ ok: true, owner, claims }`
 * on success, `{ ok: false, reason }` otherwise. We derive the org from the
 * `owner` field, falling back to the `sub` prefix.
 */
export async function resolveFromToken(
  token: string,
  config: TokenConfig,
): Promise<HanzoIdentity> {
  try {
    const result = await validateToken(token, config);
    if (!result.ok) return anonymous();
    const identity = identityFromClaims(result.claims);
    // The validator's `owner` is authoritative for the org.
    return { ...identity, ...(result.owner ? { org: result.owner } : {}) };
  } catch {
    return anonymous();
  }
}
