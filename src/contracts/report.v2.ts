import { z } from 'zod';

export const ReportV2Schema = z.object({
  version: z.literal('v2'),
  ok: z.boolean(),
  summary: z.string(),
  durationMs: z.number(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  steps: z.array(z.object({
    name: z.string(),
    status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
    durationMs: z.number().optional(),
    error: z.string().optional(),
  })),
  artifacts: z.record(z.string(), z.any()).optional(),
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    step: z.string().optional(),
    fatal: z.boolean().optional(),
  })),
});

export type ReportV2 = z.infer<typeof ReportV2Schema>;
