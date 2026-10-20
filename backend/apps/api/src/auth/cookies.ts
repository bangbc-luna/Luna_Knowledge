import type { CookieOptions } from 'express';
import type { AppConfig } from '../config/app-config.js';

export const REFRESH_COOKIE = 'luna_rt';
export const OAUTH_STATE_COOKIE = 'luna_oauth_state';

/**
 * Session cookie: không đặt Expires/Max-Age nên trình duyệt xóa khi đóng (SPEC AUTH-3).
 * Chỉ gửi tới các endpoint /auth để giảm bề mặt tấn công.
 */
export function refreshCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/v1/auth',
  };
}

/**
 * Cookie gắn state OAuth với trình duyệt. Phải là `lax` vì callback là điều hướng
 * từ accounts.google.com sang (cookie `strict` sẽ không được gửi).
 */
export function oauthStateCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth/google',
    maxAge: 10 * 60 * 1000,
  };
}
