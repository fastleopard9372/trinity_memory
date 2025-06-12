import { Router } from 'express';
import { MemoryController } from '../controller/memory.controller';
import { validateRequest } from '../middleware/validation.middle';
import { saveConversationSchema, createRuleSchema } from '../schemas/memory.schemas';

const router = Router();

// Initialize controller with dependencies from app.locals
router.use((req, res, next) => {
  const { prisma, supabase, nas, pinecone } = req.app.locals;
  req.memoryController = new MemoryController(prisma, supabase, nas, pinecone);
  next();
});

router.post(
  '/conversations',
  validateRequest(saveConversationSchema),
  (req:any, res, next) => req.memoryController.saveConversation(req, res, next)
);

router.get(
  '/conversations',
  (req:any, res, next) => req.memoryController.listConversations(req, res, next)
);

router.get(
  '/conversations/:id',
  (req:any, res, next) => req.memoryController.getConversation(req, res, next)
);

router.post(
  '/conversations/:id/summary',
  (req:any, res, next) => req.memoryController.generateSummary(req, res, next)
);

// Memory rules management
router.get('/rules', async (req, res, next) => {
  try {
    const rules = await req.app.locals.prisma.memoryRule.findMany({
      where: { userId: req.user.id },
    });
    res.json({ success: true, data: rules });
  } catch (error) {
    next(error);
  }
});

router.post('/rules', validateRequest(createRuleSchema), async (req, res, next) => {
  try {
    const rule = await req.app.locals.prisma.memoryRule.create({
      data: {
        ...req.body,
        userId: req.user.id,
      },
    });
    res.json({ success: true, data: rule });
  } catch (error) {
    next(error);
  }
});

export default router;