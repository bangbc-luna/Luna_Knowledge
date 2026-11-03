import { z } from 'zod';

export const minutesDraftSchema = z.object({
  overview: z.object({
    summary: z.string(),
    decisions: z.array(z.string()),
    deferred: z.array(z.string()),
    openQuestions: z.array(z.string()),
  }),
  actionItems: z.array(
    z.object({
      task: z.string(),
      ownerSpeakerId: z.string().nullable(),
      ownerName: z.string().nullable(),
      dueText: z.string().nullable(),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      ambiguous: z.boolean(),
      evidence: z.array(z.string()),
    }),
  ),
  topics: z.array(z.object({ title: z.string(), points: z.array(z.string()) })),
  notableChat: z.array(z.string()),
});

export type MinutesDraft = z.infer<typeof minutesDraftSchema>;
