import { z } from 'zod';

export const ReportV1Schema = z.object({
  version: z.literal('v1'),
  ok: z.boolean(),
  summary: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  steps: z.array(z.object({
    name: z.string(),
    status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
    durationMs: z.number().optional(),
    error: z.string().optional(),
  })),
  artifacts: z.record(z.string(), z.any()),
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    step: z.string().optional(),
    fatal: z.boolean().optional(),
  })),
});

export type ReportV1 = z.infer<typeof ReportV1Schema>;

export function makeReport(data: Partial<ReportV1> & { ok: boolean; summary: string }): ReportV1 {
  const now = new Date().toISOString();
  return ReportV1Schema.parse({
    version: 'v1',
    ok: data.ok,
    summary: data.summary,
    startedAt: data.startedAt || now,
    finishedAt: data.finishedAt || now,
    steps: data.steps || [],
    artifacts: data.artifacts || {},
    errors: data.errors || [],
  });
}
