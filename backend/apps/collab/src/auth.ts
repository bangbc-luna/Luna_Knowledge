import { COLLAB_TOKEN_AUDIENCE } from '@luna/shared';
import { jwtVerify } from 'jose';

export interface CollabClaims {
  userId: string;
  nodeId: string;
  name: string;
  sessionId?: string;
}

export async function verifyCollabToken(token: string, secret: string): Promise<CollabClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    audience: COLLAB_TOKEN_AUDIENCE,
    issuer: 'luna-api',
    algorithms: ['HS256'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.doc !== 'string')
    throw new Error('Invalid collab token');
  return {
    userId: payload.sub,
    nodeId: payload.doc,
    name: typeof payload.name === 'string' ? payload.name : '',
    sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
  };
}
