export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  hostedDomain?: string;
  name?: string;
  picture?: string;
}

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface CallbackChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface GoogleIdentityProvider {
  buildAuthorizationUrl(req: AuthorizationRequest): Promise<URL>;
  exchangeCode(callbackUrl: URL, checks: CallbackChecks): Promise<GoogleClaims>;
}

export const GOOGLE_IDENTITY = Symbol('GOOGLE_IDENTITY');
