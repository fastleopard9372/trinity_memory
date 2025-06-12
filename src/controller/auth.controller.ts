import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

export class AuthController {
  /**
   * User login
   */
  login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required',
        });
      }

      const supabase = req.app.locals.supabase as SupabaseClient;

      // Sign in with Supabase
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        logger.error('Login error:', error);
        return res.status(401).json({
          error: 'Invalid credentials',
        });
      }

      // Get user profile
      const prisma = req.app.locals.prisma as PrismaClient;
      const profile = await prisma.profile.findUnique({
        where: { userId: data.user.id },
      });

      res.json({
        success: true,
        data: {
          user: {
            id: data.user.id,
            email: data.user.email,
            profile,
          },
          session: data.session,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * User registration
   */
  register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, username } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required',
        });
      }

      const supabase = req.app.locals.supabase as SupabaseClient;
      const prisma = req.app.locals.prisma as PrismaClient;

      // Sign up with Supabase
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        logger.error('Registration error:', error);
        return res.status(400).json({
          error: error.message,
        });
      }

      if (!data.user) {
        return res.status(400).json({
          error: 'Registration failed',
        });
      }

      // Create user profile
      const profile = await prisma.profile.create({
        data: {
          userId: data.user.id,
          email: data.user.email!,
          username,
          settings: {
            theme: 'light',
            notifications: true,
          },
        },
      });

      // Create default memory rules
      await prisma.memoryRule.createMany({
        data: [
          {
            userId: data.user.id,
            ruleType: 'length',
            conditions: { minMessages: 10 },
            actions: { generateSummary: true },
          },
          {
            userId: data.user.id,
            ruleType: 'keyword',
            conditions: { keywords: ['important', 'remember', 'save'] },
            actions: { backup: true },
          },
        ],
      });

      res.json({
        success: true,
        data: {
          user: {
            id: data.user.id,
            email: data.user.email,
            profile,
          },
          session: data.session,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Refresh token
   */
  refresh = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({
          error: 'Refresh token is required',
        });
      }

      const supabase = req.app.locals.supabase as SupabaseClient;

      const { data, error } = await supabase.auth.refreshSession({
        refresh_token,
      });

      if (error) {
        return res.status(401).json({
          error: 'Invalid refresh token',
        });
      }

      res.json({
        success: true,
        data: {
          session: data.session,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * User logout
   */
  logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(400).json({
          error: 'No session to logout',
        });
      }

      const supabase = req.app.locals.supabase as SupabaseClient;

      const { error } = await supabase.auth.signOut();

      if (error) {
        logger.error('Logout error:', error);
      }

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get user profile
   */
  getProfile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({
          error: 'Authorization required',
        });
      }

      const supabase = req.app.locals.supabase as SupabaseClient;
      const prisma = req.app.locals.prisma as PrismaClient;

      // Get user from token
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({
          error: 'Invalid token',
        });
      }

      // Get profile with stats
      const profile = await prisma.profile.findUnique({
        where: { userId: user.id },
      });

      // Get usage stats
      const [conversationCount, fileCount, totalTokens] = await Promise.all([
        prisma.conversation.count({ where: { userId: user.id } }),
        prisma.nasFile.count({ where: { userId: user.id } }),
        prisma.conversation.aggregate({
          where: { userId: user.id },
          _sum: { totalTokens: true },
        }),
      ]);

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            profile,
          },
          stats: {
            conversations: conversationCount,
            files: fileCount,
            tokensUsed: totalTokens._sum.totalTokens || 0,
            storageUsed: profile?.memoryQuotaMb || 0,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };
}