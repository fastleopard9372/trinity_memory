// src/routes/index.ts
import { IRoute, Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import authRoutes from './auth.routes';
import memoryRoutes from './memory.routes';
import searchRoutes from './search.routes';
import fileRoutes from './file.routes';
import agentRoutes from './agent.routes';
import { logger } from '../utils/logger';

const router = Router();

// API versioning
const API_VERSION = 'v1';

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    name: 'Trinity AI API',
    version: API_VERSION,
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      memory: '/api/memory',
      search: '/api/search',
      files: '/api/files',
      agent: '/api/agent',
      health: '/api/health',
      docs: '/api/docs',
    },
  });
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const { prisma, nas, vectorStore } = req.app.locals;
    
    // Check database connection
    const dbHealthy = await prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    
    // Check NAS connection
    const nasHealthy = await nas.listDirectory('/')
      .then(() => true)
      .catch(() => false);
    
    // Check Pinecone connection
    const pineconeHealthy = vectorStore ? true : false;
    
    const allHealthy = dbHealthy && nasHealthy && pineconeHealthy;
    
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        nas: nasHealthy ? 'connected' : 'disconnected',
        pinecone: pineconeHealthy ? 'connected' : 'disconnected',
      },
      version: API_VERSION,
    });
  } catch (error:any) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// API documentation endpoint
router.get('/docs', (req, res) => {
  res.json({
    version: API_VERSION,
    endpoints: [
      {
        group: 'Authentication',
        base: '/api/auth',
        endpoints: [
          { method: 'POST', path: '/login', description: 'User login' },
          { method: 'POST', path: '/register', description: 'User registration' },
          { method: 'POST', path: '/refresh', description: 'Refresh access token' },
          { method: 'POST', path: '/logout', description: 'User logout' },
          { method: 'GET', path: '/profile', description: 'Get user profile', auth: true },
        ],
      },
      {
        group: 'Memory Management',
        base: '/api/memory',
        auth: true,
        endpoints: [
          { method: 'POST', path: '/conversations', description: 'Save conversation' },
          { method: 'GET', path: '/conversations', description: 'List conversations' },
          { method: 'GET', path: '/conversations/:id', description: 'Get conversation details' },
          { method: 'POST', path: '/conversations/:id/summary', description: 'Generate conversation summary' },
          { method: 'GET', path: '/rules', description: 'List memory rules' },
          { method: 'POST', path: '/rules', description: 'Create memory rule' },
        ],
      },
      {
        group: 'Search',
        base: '/api/search',
        auth: true,
        endpoints: [
          { method: 'GET', path: '/', description: 'Search memories', query: ['q', 'limit', 'offset', 'fileTypes', 'tags'] },
          { method: 'POST', path: '/file', description: 'Get file by path' },
          { method: 'GET', path: '/history', description: 'Get search history' },
        ],
      },
      {
        group: 'File Management',
        base: '/api/files',
        auth: true,
        endpoints: [
          { method: 'POST', path: '/upload', description: 'Upload file to NAS' },
          { method: 'GET', path: '/list', description: 'List files in directory' },
          { method: 'POST', path: '/reindex', description: 'Re-index file' },
          { method: 'GET', path: '/metadata', description: 'List file metadata' },
        ],
      },
      {
        group: 'Agent Functions',
        base: '/api/agent',
        auth: true,
        endpoints: [
          { method: 'GET', path: '/jobs', description: 'List agent jobs' },
          { method: 'POST', path: '/jobs', description: 'Create/import job' },
          { method: 'GET', path: '/jobs/:id', description: 'Get job details' },
          { method: 'GET', path: '/proposals', description: 'List proposals' },
          { method: 'POST', path: '/proposals', description: 'Generate proposal' },
          { method: 'GET', path: '/proposals/:id', description: 'Get proposal details' },
        ],
      },
    ],
  });
});

// Public routes (no auth required)
router.use('/auth', authRoutes);

// Protected routes (auth required)
router.use('/memory', authMiddleware, memoryRoutes);
router.use('/search', authMiddleware, searchRoutes);
router.use('/files', authMiddleware, fileRoutes);
router.use('/agent', authMiddleware, agentRoutes);

// 404 handler for undefined routes
router.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    suggestion: 'Please check the API documentation at /api/docs',
  });
});

// Log registered routes in development
if (process.env.NODE_ENV === 'development') {
  router.stack.forEach((r) => {
    if (r.route && r.route.path) {
      logger.debug(`Registered route: ${Object.keys((r.route as any).methods).join(', ').toUpperCase()} ${r.route.path}`);
    }
  });
}

export default router;