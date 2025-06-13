import { z } from 'zod';

export const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
  timestamp: z.string().datetime().optional(),
});

export const saveConversationSchema = z.object({
  messages: z.array(messageSchema).min(1),
  metadata: z.record(z.any()).optional(),
});

export const generateSummarySchema = z.object({
  style: z.enum(['brief', 'detailed', 'bullet_points']).optional(),
});

export const createRuleSchema = z.object({
  ruleType: z.enum(['keyword', 'length', 'time']),
  conditions: z.record(z.any()),
  actions: z.record(z.any()),
  isActive: z.boolean().default(true),
});