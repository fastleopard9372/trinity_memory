import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().min(3).max(50).optional(),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});