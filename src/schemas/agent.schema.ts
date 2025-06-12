import { z } from 'zod';

export const createJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.string().optional(),
  budgetMin: z.number().positive().optional(),
  budgetMax: z.number().positive().optional(),
  metadata: z.record(z.any()).optional(),
});

export const generateProposalSchema = z.object({
  jobId: z.string().uuid(),
  template: z.string().optional(),
  customInstructions: z.string().optional(),
});

export const updateProposalSchema = z.object({
  content: z.string().optional(),
  status: z.enum(['draft', 'submitted', 'accepted', 'rejected']).optional(),
  submittedAt: z.string().datetime().optional(),
});