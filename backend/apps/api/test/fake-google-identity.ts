import * as oidc from 'openid-client';
import type {
  AuthorizationRequest,
  CallbackChecks,
  GoogleClaims,
  GoogleIdentityProvider,
} from '../src/auth/google/google-identity.js';

export class FakeGoogleIdentity implements GoogleIdentityProvider {
  nextClaims: GoogleClaims | null = null;
  private challenges = new Map<string, AuthorizationRequest>();

  async buildAuthorizationUrl(req: AuthorizationRequest): Promise<URL> {
    this.challenges.set(req.state, req);
    const url = new URL('https://accounts.google.test/o/oauth2/v2/auth');
    url.searchParams.set('state', req.state);
    url.searchParams.set('nonce', req.nonce);
    url.searchParams.set('code_challenge', req.codeChallenge);
    return url;
  }

  async exchangeCode(_callbackUrl: URL, checks: CallbackChecks): Promise<GoogleClaims> {
    const original = this.challenges.get(checks.state);
    if (!original || original.nonce !== checks.nonce) throw new Error('nonce mismatch');
    if ((await oidc.calculatePKCECodeChallenge(checks.codeVerifier)) !== original.codeChallenge) {
      throw new Error('PKCE verification failed');
    }
    if (!this.nextClaims) throw new Error('FakeGoogleIdentity.nextClaims not set');
    const claims = this.nextClaims;
    this.nextClaims = null;
    return claims;
  }
}

export function companyClaims(email: string, overrides: Partial<GoogleClaims> = {}): GoogleClaims {
  return {
    sub: `google-${email}`,
    email,
    emailVerified: true,
    hostedDomain: email.split('@')[1],
    name: email.split('@')[0]!.replace(/\./g, ' '),
    picture: `https://example.test/${encodeURIComponent(email)}.png`,
    ...overrides,
  };
}
