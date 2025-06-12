import { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // const token = req.headers.authorization?.replace('Bearer ', '');

    // if (!token) {
    //   return res.status(401).json({
    //     error: 'Authorization token required',
    //   });
    // }

    // const supabase = req.app.locals.supabase as SupabaseClient;
    
    // // Verify token with Supabase
    // const { data: { user }, error } = await supabase.auth.getUser(token);

    // if (error || !user) {
    //   return res.status(401).json({
    //     error: 'Invalid or expired token',
    //   });
    // }

    // // Get user profile
    // const { data: profile } = await req.app.locals.prisma.profile.findUnique({
    //   where: { userId: user.id },
    // });

    // req.user = {
    //   id: user.id,
    //   email: user.email,
    //   profile,
    // };
    req.user = {
      id: "test_user",
      email: "fastleopard9372",
      profile: "",
    };

    next();
  } catch (error) {
    res.status(401).json({
      error: 'Authentication failed',
    });
  }
};