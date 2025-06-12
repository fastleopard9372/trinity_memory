import { Router, Request } from 'express';
import { AgentController } from '../controller/agent.controller';
import { SearchController } from '../controller/search.controller';
import { FileController } from '../controller/file.controller';
import { MemoryController } from '../controller/memory.controller';

const router = Router();

// Initialize agent controller
router.use((req, res, next) => {
  const { prisma, nas, pinecone } = req.app.locals;
  req.agentController = new AgentController(prisma, nas);
  next();
});

router.get('/jobs', (req:any, res, next) => req.agentController.listJobs(req, res, next));
router.post('/jobs', (req:any, res, next) => req.agentController.createJob(req, res, next));
router.get('/jobs/:id', (req:any, res, next) => req.agentController.getJob(req, res, next));

router.get('/proposals', (req:any, res, next) => req.agentController.listProposals(req, res, next));
router.post('/proposals', (req:any, res, next) => req.agentController.generateProposal(req, res, next));
router.get('/proposals/:id', (req:any, res, next) => req.agentController.getProposal(req, res, next));

export default router;

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: any;
      memoryController?: MemoryController;
      searchController?: SearchController;
      fileController?: FileController;
      agentController?: AgentController;
    }
  }
}