import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const createPrismaClient = () => {
  const prisma = new PrismaClient({
    log: [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'info',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
    errorFormat: 'pretty',
  });

  prisma.$on('query', (e) => {
    logger.debug(`Query: ${e.query} - Params: ${e.params} - Duration: ${e.duration}ms`);
  });

  prisma.$on('error', (e) => {
    logger.error(`Prisma Error: ${e.message}`);
  });

  prisma.$on('info', (e) => {
    logger.info(`Prisma Info: ${e.message}`);
  });

  prisma.$on('warn', (e) => {
    logger.warn(`Prisma Warning: ${e.message}`);
  });

  return prisma;
};