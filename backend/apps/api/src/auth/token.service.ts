import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const ISSUER = 'luna-api';
const AUDIENCE = 'luna';

export interface AccessTokenPayload {
  userId: string;
  sessionId: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  get accessTtlSec(): number {
    return this.config.ACCESS_TOKEN_TTL_SEC;
  }

  signAccess({ userId, sessionId }: AccessTokenPayload): Promise<string> {
    return new SignJWT({ sid: sessionId, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SEC}s`)
      .sign(this.key);
  }

  /** Trả null nếu token sai chữ ký, hết hạn hoặc sai loại. */
  async verifyAccess(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access' || typeof payload.sid !== 'string' || !payload.sub) return null;
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      return null;
    }
  }

  /** Refresh token là chuỗi ngẫu nhiên (không phải JWT); DB chỉ lưu SHA-256 của nó. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hash(token) };
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
