import { z } from 'zod';

export const uploadFileSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(['conversation', 'summary', 'proposal', 'document']).optional(),
  metadata: z.record(z.any()).optional(),
});

export const reindexFileSchema = z.object({
  path: z.string().min(1),
  force: z.boolean().optional(),
});

export const listFilesSchema = z.object({
  directory: z.string().default('/'),
  recursive: z.boolean().optional(),
  fileType: z.string().optional(),
});