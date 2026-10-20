import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { requestContext } from '../common/http/request-context.js';
import { ApiZodOk } from '../common/swagger/zod-openapi.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { AuthService, LoginError } from './auth.service.js';
import { tokenResponseSchema } from './auth.schemas.js';
import {
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from './cookies.js';
import type { AuthenticatedRequest } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { googleRedirectUri } from './google/openid-google-identity.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Get('google')
  @ApiOperation({
    summary: 'Bắt đầu đăng nhập Google',
    description: 'Mở trong trình duyệt (không gọi bằng fetch). Chuyển hướng sang Google.',
  })
  @ApiFoundResponse({ description: 'Redirect tới accounts.google.com' })
  async google(@Res() res: Response) {
    const { url, state } = await this.auth.startGoogleLogin();
    res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions(this.config));
    res.redirect(302, url.toString());
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({
    summary: 'Callback từ Google',
    description:
      'Thành công: đặt cookie `luna_rt` (session cookie) và chuyển về AUTH_REDIRECT_URL. ' +
      'Thất bại: chuyển về AUTH_REDIRECT_URL?error=CODE (ACCESS_DENIED, INVALID_STATE, ' +
      'DOMAIN_NOT_ALLOWED, EMAIL_NOT_VERIFIED, ACCOUNT_DISABLED, LOGIN_FAILED).',
  })
  @ApiFoundResponse({ description: 'Redirect về trang FE' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    res.clearCookie(OAUTH_STATE_COOKIE, {
      ...oauthStateCookieOptions(this.config),
      maxAge: undefined,
    });
    const redirect = new URL(this.config.AUTH_REDIRECT_URL);

    // Dựng URL callback từ cấu hình thay vì Host header (không tin header do client gửi).
    const callbackUrl = new URL(googleRedirectUri(this.config));
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') callbackUrl.searchParams.set(key, value);
    }

    try {
      const { refreshToken } = await this.auth.completeGoogleLogin({
        callbackUrl,
        cookieState: req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined,
        ctx: requestContext(req),
      });
      res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.config));
    } catch (err) {
      const code = err instanceof LoginError ? err.code : 'LOGIN_FAILED';
      this.logger.warn({ code, err: (err as Error).message }, 'Google login failed');
      redirect.searchParams.set('error', code);
    }
    res.redirect(302, redirect.toString());
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Lấy access token mới',
    description:
      'Gửi kèm cookie `luna_rt` (fetch với `credentials: "include"`). Refresh token được xoay vòng; ' +
      'dùng lại token cũ sẽ thu hồi cả phiên. Phiên hết hạn trả 401 SESSION_EXPIRED. ' +
      'Không có cookie (chưa đăng nhập) trả 204 không có nội dung, để lần mở trang đầu không bị coi là lỗi.',
  })
  @ApiZodOk(tokenResponseSchema)
  @ApiNoContentResponse({ description: 'Chưa đăng nhập: không có cookie refresh' })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED hoặc SESSION_EXPIRED' })
  async refresh(@Req() req: Request, @Res() res: Response) {
    const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!cookie) {
      res.status(204).end();
      return;
    }
    try {
      const { refreshToken, ...body } = await this.auth.refresh(cookie, requestContext(req));
      if (refreshToken) {
        res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.config));
      }
      res.status(200).json(body);
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.config));
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({ summary: 'Đăng xuất: thu hồi phiên hiện tại và xóa cookie' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request & AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Route @Public nên tự đọc bearer (không bắt buộc): access token hết hạn vẫn đăng xuất được bằng cookie.
    let sessionId: string | undefined;
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      sessionId = (await this.auth.authenticate(token).catch(() => null))?.sessionId;
    }
    await this.auth.logout({
      refreshToken: req.cookies?.[REFRESH_COOKIE] as string | undefined,
      sessionId,
      ctx: requestContext(req),
    });
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(this.config));
  }
}
