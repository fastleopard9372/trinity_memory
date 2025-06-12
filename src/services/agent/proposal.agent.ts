import { PrismaClient, AgentJob } from '@prisma/client';
import { OpenAI } from 'openai';
import { NASService } from '../nas/nas.service';
import { logger } from '../../utils/logger';

export class ProposalAgent {
  private prisma: PrismaClient;
  private nas: NASService;
  private openai: OpenAI;

  constructor(prisma: PrismaClient, nas: NASService) {
    this.prisma = prisma;
    this.nas = nas;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate proposal for a job
   */
  async generateProposal(
    job: AgentJob,
    template?: string,
    customInstructions?: string
  ) {
    logger.info(`Generating proposal for job ${job.id}`);

    // Build prompt
    const prompt = this.buildPrompt(job, template, customInstructions);

    // Generate with OpenAI
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert freelance proposal writer. Create compelling, personalized proposals that highlight relevant experience and value proposition.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const proposalContent = completion.choices[0].message.content || '';

    // Save proposal to database
    const proposal = await this.prisma.proposal.create({
      data: {
        jobId: job.id,
        content: proposalContent.substring(0, 1000), // Store preview in DB
        status: 'draft',
        metadata: {
          model: 'gpt-4',
          template: template || 'default',
          generatedAt: new Date(),
        },
      },
    });

    // Save full proposal to NAS
    const proposalPath = NASService.buildUserPath(
      job.userId,
      'agents/proposals',
      `proposal_${proposal.id}.md`
    );

    await this.nas.writeFile(proposalPath, proposalContent);

    logger.info(`Proposal ${proposal.id} generated and saved to ${proposalPath}`);

    return {
      ...proposal,
      fullContent: proposalContent,
    };
  }

  /**
   * Build proposal prompt
   */
  private buildPrompt(
    job: AgentJob,
    template?: string,
    customInstructions?: string
  ): string {
    let prompt = `Generate a professional freelance proposal for the following job:\n\n`;
    prompt += `Title: ${job.title}\n`;
    
    if (job.description) {
      prompt += `Description: ${job.description}\n`;
    }
    
    if (job.budgetMin || job.budgetMax) {
      prompt += `Budget: $${job.budgetMin || '?'} - $${job.budgetMax || '?'}\n`;
    }

    if (template) {
      prompt += `\nUse this template structure:\n${template}\n`;
    }

    if (customInstructions) {
      prompt += `\nAdditional instructions:\n${customInstructions}\n`;
    }

    prompt += `\nThe proposal should be personalized, highlight relevant experience, and clearly communicate value proposition.`;

    return prompt;
  }
}