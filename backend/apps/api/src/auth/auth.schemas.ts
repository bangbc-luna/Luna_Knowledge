import { z } from 'zod';

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  isSystemAdmin: z.boolean(),
});

export const tokenResponseSchema = z.object({
  accessToken: z.string().describe('JWT, gửi qua header Authorization: Bearer'),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().describe('Số giây còn hiệu lực'),
  user: authUserSchema,
});
