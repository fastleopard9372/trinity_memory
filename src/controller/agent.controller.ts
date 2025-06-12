import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { NASService } from '../services/nas/nas.service';
import { ProposalAgent } from '../services/agent/proposal.agent';
import { logger } from '../utils/logger';

export class AgentController {
  private prisma: PrismaClient;
  private nas: NASService;
  private proposalAgent: ProposalAgent;

  constructor(prisma: PrismaClient, nas: NASService) {
    this.prisma = prisma;
    this.nas = nas;
    this.proposalAgent = new ProposalAgent(prisma, nas);
  }

  /**
   * List agent jobs
   */
  listJobs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const { 
        limit = 10, 
        offset = 0, 
        status,
        source,
        sortBy = 'scrapedAt',
        order = 'desc' 
      } = req.query;

      const where: any = { userId };
      
      if (status) {
        where.proposals = {
          some: { status }
        };
      }
      
      if (source) {
        where.source = source;
      }

      const jobs = await this.prisma.agentJob.findMany({
        where,
        include: {
          proposals: {
            orderBy: { generatedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { [sortBy as string]: order },
        take: Number(limit),
        skip: Number(offset),
      });

      const total = await this.prisma.agentJob.count({ where });

      res.json({
        success: true,
        data: jobs,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create/import job
   */
  createJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const { title, description, source, budgetMin, budgetMax, metadata } = req.body;

      if (!title) {
        return res.status(400).json({
          error: 'Job title is required',
        });
      }

      const job = await this.prisma.agentJob.create({
        data: {
          userId,
          title,
          description,
          source,
          budgetMin: budgetMin ? parseFloat(budgetMin) : null,
          budgetMax: budgetMax ? parseFloat(budgetMax) : null,
          metadata: metadata || {},
        },
      });

      // Save job to NAS
      const jobPath = NASService.buildUserPath(
        userId,
        'agents/jobs',
        `job_${job.id}.json`
      );

      await this.nas.writeFile(jobPath, JSON.stringify(job, null, 2));

      res.json({
        success: true,
        data: job,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get job details
   */
  getJob = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const job = await this.prisma.agentJob.findFirst({
        where: { id, userId },
        include: {
          proposals: {
            orderBy: { generatedAt: 'desc' },
          },
        },
      });

      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
        });
      }

      res.json({
        success: true,
        data: job,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * List proposals
   */
  listProposals = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const { 
        limit = 10, 
        offset = 0, 
        status,
        jobId 
      } = req.query;

      const where: any = {
        job: { userId }
      };

      if (status) {
        where.status = status;
      }

      if (jobId) {
        where.jobId = jobId;
      }

      const proposals = await this.prisma.proposal.findMany({
        where,
        include: {
          job: true,
          conversation: true,
        },
        orderBy: { generatedAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      });

      const total = await this.prisma.proposal.count({ where });

      res.json({
        success: true,
        data: proposals,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Generate proposal for job
   */
  generateProposal = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const { jobId, template, customInstructions } = req.body;

      if (!jobId) {
        return res.status(400).json({
          error: 'Job ID is required',
        });
      }

      // Verify job ownership
      const job = await this.prisma.agentJob.findFirst({
        where: { id: jobId, userId },
      });

      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
        });
      }

      // Generate proposal
      const proposal = await this.proposalAgent.generateProposal(
        job,
        template,
        customInstructions
      );

      res.json({
        success: true,
        data: proposal,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get proposal details
   */
  getProposal = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const proposal = await this.prisma.proposal.findFirst({
        where: { 
          id,
          job: { userId }
        },
        include: {
          job: true,
          conversation: true,
        },
      });

      if (!proposal) {
        return res.status(404).json({
          error: 'Proposal not found',
        });
      }

      // Get content from NAS if exists
      const proposalPath = NASService.buildUserPath(
        userId,
        'agents/proposals',
        `proposal_${proposal.id}.md`
      );
      let fullContent: string | null = null;
      try {
        fullContent = await this.nas.readFile(proposalPath);
      } catch (error) {
        // File might not exist
        logger.debug(`Proposal file not found: ${proposalPath}`);
      }

      res.json({
        success: true,
        data: {...proposal, fullContent,},
      });
    } catch (error) {
      next(error);
    }
  };
}