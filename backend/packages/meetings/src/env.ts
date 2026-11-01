import { z } from 'zod';

export const meetingsEnvSchema = z.object({
  LIVEKIT_URL: z.string().regex(/^wss?:\/\//),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(32),
  MEETING_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(600),
  MEETING_EMPTY_GRACE_SEC: z.coerce.number().int().min(30).default(120),
  MEETING_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(100).default(25),
  MEETING_REMINDER_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
});

export type MeetingsEnv = z.infer<typeof meetingsEnvSchema>;
