import { describe, it, expect } from 'vitest';
import { OIDC_PATHS } from '@hanzo/iam/paths';
import { IAM_API_PATH } from '../../auth/iam';

// This extension restates Hanzo IAM's OAuth path prefix instead of importing
// @hanzo/iam at runtime — that package is 1.8 MB with three transitive
// dependencies, which is a poor trade for twelve characters in a shipped
// extension. The copy is therefore fine; an UNCHECKED copy is not.
//
// @hanzo/iam is a devDependency, so this costs nothing at runtime and the
// build cannot go green while the two disagree.
describe('the local IAM path prefix agrees with @hanzo/iam', () => {
  it('every OAuth endpoint this extension builds is under IAM_API_PATH', () => {
    for (const key of ['authorize', 'token', 'userinfo'] as const) {
      expect(OIDC_PATHS[key].startsWith(`${IAM_API_PATH}/`)).toBe(true);
    }
  });

  it('the prefix is exactly what @hanzo/iam declares, not merely a prefix of it', () => {
    // `/v` and `/v1` both pass a startsWith check; only the real value builds a
    // URL that resolves. Derive it from the canonical path and compare.
    const derived = OIDC_PATHS.authorize.slice(0, OIDC_PATHS.authorize.indexOf('/oauth/'));
    expect(IAM_API_PATH).toBe(derived);
  });
});
