import { Inject, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import type {
  AuthorizationRequest,
  CallbackChecks,
  GoogleClaims,
  GoogleIdentityProvider,
} from './google-identity.js';

const GOOGLE_ISSUER = new URL('https://accounts.google.com');

export function googleRedirectUri(config: AppConfig): string {
  return new URL('/api/v1/auth/google/callback', config.API_PUBLIC_URL).toString();
}

/** Google OIDC qua `openid-client`: PKCE (S256) + state + nonce, xác minh chữ ký ID token. */
@Injectable()
export class OpenIdGoogleIdentity implements GoogleIdentityProvider {
  private configuration?: Promise<oidc.Configuration>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Discovery chạy lần đầu cần dùng; lỗi mạng thì lần sau thử lại. */
  private discover(): Promise<oidc.Configuration> {
    this.configuration ??= oidc
      .discovery(GOOGLE_ISSUER, this.config.GOOGLE_CLIENT_ID, this.config.GOOGLE_CLIENT_SECRET)
      .catch((err: unknown) => {
        this.configuration = undefined;
        throw err;
      });
    return this.configuration;
  }

  async buildAuthorizationUrl(req: AuthorizationRequest): Promise<URL> {
    return oidc.buildAuthorizationUrl(await this.discover(), {
      redirect_uri: googleRedirectUri(this.config),
      scope: 'openid email profile',
      state: req.state,
      nonce: req.nonce,
      code_challenge: req.codeChallenge,
      code_challenge_method: 'S256',
      // Luôn hiện màn hình chọn tài khoản (SPEC AUTH-3); `hd` chỉ là gợi ý, server vẫn kiểm tra.
      prompt: 'select_account',
      hd: this.config.ALLOWED_GOOGLE_DOMAINS[0]!,
    });
  }

  async exchangeCode(callbackUrl: URL, checks: CallbackChecks): Promise<GoogleClaims> {
    const tokens = await oidc.authorizationCodeGrant(await this.discover(), callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || typeof claims.email !== 'string') {
      throw new Error('Google ID token has no email claim');
    }
    return {
      sub: claims.sub,
      email: claims.email,
      emailVerified: claims.email_verified === true,
      hostedDomain: typeof claims.hd === 'string' ? claims.hd : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    };
  }
}
