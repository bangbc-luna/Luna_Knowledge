import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { tokenResponseSchema } from '../auth/auth.schemas.js';
import { AuthService, LoginError } from '../auth/auth.service.js';
import { REFRESH_COOKIE, refreshCookieOptions } from '../auth/cookies.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { AppError } from '../common/errors/app-error.js';
import { requestContext } from '../common/http/request-context.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiZodBody, ApiZodOk } from '../common/swagger/zod-openapi.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const devTokenBody = z.object({
  email: z
    .email()
    .transform((v) => v.toLowerCase())
    .describe('Email @lunatech.vn; chưa có thì tự tạo user'),
  name: z.string().trim().min(1).max(100).optional(),
});

/**
 * Cấp token không qua Google, để test API bằng file .http / Swagger với nhiều vai trò.
 * Chỉ tồn tại khi NODE_ENV=development (DevModule không được nạp ở môi trường khác).
 */
@ApiTags('dev')
@Public()
@Controller('dev')
export class DevAuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {
    // Phòng thủ thêm một lớp: không bao giờ chạy ở production dù cấu hình module sai.
    if (config.NODE_ENV === 'production')
      throw new Error('DevAuthController must not load in production');
  }

  @Post('token')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV] Lấy access token cho một email công ty (không qua Google)',
    description:
      'Chỉ có ở môi trường development. Tạo phiên thật (có idle/absolute timeout, audit log ' +
      '`auth.login` với method=dev) và đặt cookie `luna_rt` như đăng nhập Google.',
  })
  @ApiZodBody(devTokenBody)
  @ApiZodOk(tokenResponseSchema)
  async token(
    @Body(new ZodValidationPipe(devTokenBody)) body: z.output<typeof devTokenBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.auth.isAllowedEmail(body.email)) {
      throw AppError.validation(`Only company accounts are allowed (${body.email})`);
    }
    const ctx = requestContext(req);
    try {
      const signedIn = await this.auth.signIn({ ...body, method: 'dev' }, ctx);
      const { refreshToken, ...tokens } = await this.auth.refresh(signedIn.refreshToken, ctx);
      res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(this.config));
      return tokens;
    } catch (err) {
      if (err instanceof LoginError) throw AppError.forbidden(err.message);
      throw err;
    }
  }
}
