import { Router } from 'express';
import { SearchController } from '../controller/search.controller';
import { SearchService } from '../services/search/search.service';

const router = Router();

// Initialize search service
router.use((req, res, next) => {
  const { prisma, vectorStore, nas } = req.app.locals;
  const searchService = new SearchService(prisma, vectorStore, nas);
  req.searchController = new SearchController(searchService);
  next();
});

router.get('/', (req:any, res, next) => req.searchController.search(req, res, next));
router.post('/file', (req:any, res, next) => req.searchController.getFileByPath(req, res, next));

// Search analytics
router.get('/history', async (req, res, next) => {
  try {
    const history = await req.app.locals.prisma.searchQuery.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});

export default router;