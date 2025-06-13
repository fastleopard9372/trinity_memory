import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { PineconeStore } from '@langchain/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';


import { authMiddleware } from './middleware/auth.middleware';
import { errorMiddleware } from './middleware/error.middleware';
// import { validationMiddleware } from './middleware/validation.middleware';
import routes from './routes';
import { logger } from './utils/logger';
import { NASService } from './services/nas/nas.service';
import { getNASConfig } from './config/nas.config';
import { createPrismaClient } from './config/database.config';
import { createSupabaseClient } from './config/supabase.config';
import { createPineconeClient } from './config/pinecone.config';

dotenv.config();

export const createApp = async () => {
  const app = express();

  logger.info('Initializing services...');

  try {

    const supabase = createSupabaseClient();
    logger.info('Supabase client initialized');
    
    const prisma = createPrismaClient();
    logger.info('Prisma client initialized');

    await prisma.$connect();
    logger.info('Database connected successfully');

    const nasConfig = getNASConfig();
    const nas = new NASService(nasConfig);
    logger.info('NAS service initialized');

    const pinecone = await createPineconeClient();
    const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX || 'trinity-memory');
    logger.info('Pinecone client initialized');
    
    const vectorStore = await PineconeStore.fromExistingIndex(
      new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        model: "text-embedding-ada-002"
      }),
      { pineconeIndex }
    );
    logger.info('Vector store initialized');

    // app.locals.prisma = prisma;
    app.locals.supabase = supabase;
    app.locals.nas = nas;
    app.locals.pinecone = pinecone;
    app.locals.vectorStore = vectorStore;

    app.use(helmet());
    app.use(cors({
      origin: process.env.CORS_ORIGIN?.split(',') || '*',
      credentials: true,
    }));
    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
        });
      });
      next();
    });

    app.use('/api', routes);

    // app.get('/health', async (req, res) => {
    //   try {
    //     await prisma.$queryRaw`SELECT 1`;
    //     const nasHealthy = await nas.listDirectory('/').then(() => true).catch(() => false);
    //     res.json({
    //       status: 'healthy',
    //       timestamp: new Date(),
    //       services: {
    //         database: 'connected',
    //         nas: nasHealthy ? 'connected' : 'disconnected',
    //         pinecone: 'connected',
    //       },
    //     });
    //   } catch (error) {
    //     logger.error('Health check failed:', error);
    //     res.status(503).json({
    //       status: 'unhealthy',
    //       timestamp: new Date(),
    //       error: (error as Error).message,
    //     });
    //   }
    // });

    app.use(errorMiddleware);

    // process.on('SIGTERM', async () => {
    //   logger.info('SIGTERM received, closing connections...');
    //   await prisma.$disconnect();
    //   process.exit(0);
    // });

    logger.info('Application initialized successfully');
    return app;

  } catch (error) {
    logger.error('Failed to initialize application:', error);
    throw error;
  }
};