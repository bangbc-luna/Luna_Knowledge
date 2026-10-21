import type { CookieOptions } from 'express';
import type { AppConfig } from '../config/app-config.js';

export const REFRESH_COOKIE = 'luna_rt';
export const OAUTH_STATE_COOKIE = 'luna_oauth_state';

export function refreshCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/v1/auth',
  };
}

export function oauthStateCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth/google',
    maxAge: 10 * 60 * 1000,
  };
}
