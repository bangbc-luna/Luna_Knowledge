import * as oidc from 'openid-client';
import type { AppConfig } from '../../config/app-config.js';
import { OpenIdGoogleIdentity } from './openid-google-identity.js';

describe('OpenIdGoogleIdentity.buildAuthorizationUrl', () => {
  const config = {
    API_PUBLIC_URL: 'https://knowledge.lunatech.vn',
    GOOGLE_CLIENT_ID: 'client-123',
    GOOGLE_CLIENT_SECRET: 'secret',
    ALLOWED_GOOGLE_DOMAINS: ['lunatech.vn'],
  } as AppConfig;

  it('tạo URL Google đúng tham số bảo mật', async () => {
    const provider = new OpenIdGoogleIdentity(config);
    (provider as unknown as { configuration: Promise<oidc.Configuration> }).configuration =
      Promise.resolve(
        new oidc.Configuration(
          {
            issuer: 'https://accounts.google.com',
            authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
          },
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
        ),
      );

    const url = await provider.buildAuthorizationUrl({
      state: 's1',
      nonce: 'n1',
      codeChallenge: 'c1',
    });
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-123',
      response_type: 'code',
      redirect_uri: 'https://knowledge.lunatech.vn/api/v1/auth/google/callback',
      scope: 'openid email profile',
      state: 's1',
      nonce: 'n1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
      prompt: 'select_account',
      hd: 'lunatech.vn',
    });
  });
});
