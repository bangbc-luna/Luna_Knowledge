/** Claims cần dùng từ ID token của Google. */
export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  /** Domain Google Workspace (`hd`); không có với tài khoản Gmail cá nhân. */
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

/**
 * Tách giao tiếp với Google ra interface để e2e thay bằng bản giả
 * (không cần gọi Google thật khi test).
 */
export interface GoogleIdentityProvider {
  buildAuthorizationUrl(req: AuthorizationRequest): Promise<URL>;
  /** `callbackUrl` là URL Google chuyển hướng về (redirect_uri + query). */
  exchangeCode(callbackUrl: URL, checks: CallbackChecks): Promise<GoogleClaims>;
}

export const GOOGLE_IDENTITY = Symbol('GOOGLE_IDENTITY');
