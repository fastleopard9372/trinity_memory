import { Router } from 'express';
import { FileController } from '../controller//file.controller';
import { FileIndexer } from '../services/indexer/file.indexer';
import { validateRequest } from '../middleware/validation.middle';
import { uploadFileSchema, reindexFileSchema } from '../schemas/file.schemas';

const router = Router();

// Initialize file controller
router.use((req, res, next) => {
  const { prisma, nas, pinecone } = req.app.locals;
  const indexer = new FileIndexer(prisma, nas, pinecone);
  req.fileController = new FileController(nas, indexer);
  next();
});

router.post(
  '/upload',
  validateRequest(uploadFileSchema),
  (req:any, res, next) => req.fileController.uploadFile(req, res, next)
);

router.get(
  '/list',
  (req:any, res, next) => req.fileController.listFiles(req, res, next)
);

router.post(
  '/reindex',
  validateRequest(reindexFileSchema),
  (req:any, res, next) => req.fileController.reindexFile(req, res, next)
);

// File metadata management
router.get('/metadata', async (req, res, next) => {
  try {
    const files = await req.app.locals.prisma.nasFile.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: Number(req.query.limit) || 20,
      skip: Number(req.query.offset) || 0,
    });
    
    const total = await req.app.locals.prisma.nasFile.count({
      where: { userId: req.user.id },
    });
    
    res.json({
      success: true,
      data: files,
      pagination: {
        total,
        limit: Number(req.query.limit) || 20,
        offset: Number(req.query.offset) || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;