import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().min(1).or(z.undefined()),
  query: z.string().min(1).or(z.undefined()),
  limit: z.string().regex(/^\d+$/).transform(Number).default('10'),
  offset: z.string().regex(/^\d+$/).transform(Number).default('0'),
  fileTypes: z.array(z.string()).or(z.string()).optional(),
  tags: z.array(z.string()).or(z.string()).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
}).refine(data => data.q || data.query, {
  message: 'Either q or query parameter is required',
});

export const filePathSchema = z.object({
  path: z.string().min(1),
});