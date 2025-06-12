import { PrismaClient, Conversation } from '@prisma/client';
import { logger } from '../../utils/logger';

export interface ConversationStats {
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  averageMessageCount: number;
  topTags: { name: string; count: number }[];
  conversationsByDay: { date: string; count: number }[];
}

export class ConversationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get conversation statistics for user
   */
  async getConversationStats(
    userId: string,
    days: number = 30
  ): Promise<ConversationStats> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get basic stats
    const [totalConversations, messageStats, tokenStats] = await Promise.all([
      this.prisma.conversation.count({
        where: { userId },
      }),
      this.prisma.conversation.aggregate({
        where: { userId },
        _sum: { messageCount: true },
        _avg: { messageCount: true },
      }),
      this.prisma.conversation.aggregate({
        where: { userId },
        _sum: { totalTokens: true },
      }),
    ]);

    // Get top tags
    const topTags = await this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT t.name, COUNT(ct.conversation_id) as count
      FROM tags t
      JOIN conversation_tags ct ON t.id = ct.tag_id
      JOIN conversations c ON ct.conversation_id = c.id
      WHERE c.user_id = ${userId}
      GROUP BY t.name
      ORDER BY count DESC
      LIMIT 10
    `;

    // Get conversations by day
    const conversationsByDay = await this.prisma.$queryRaw<
      { date: Date; count: bigint }[]
    >`
      SELECT DATE(started_at) as date, COUNT(*) as count
      FROM conversations
      WHERE user_id = ${userId}
        AND started_at >= ${startDate}
      GROUP BY DATE(started_at)
      ORDER BY date DESC
    `;

    return {
      totalConversations,
      totalMessages: messageStats._sum.messageCount || 0,
      totalTokens: tokenStats._sum.totalTokens || 0,
      averageMessageCount: Math.round(messageStats._avg.messageCount || 0),
      topTags: topTags.map(t => ({ 
        name: t.name, 
        count: Number(t.count) 
      })),
      conversationsByDay: conversationsByDay.map(d => ({
        date: d.date.toISOString().split('T')[0],
        count: Number(d.count),
      })),
    };
  }

  /**
   * Tag conversation
   */
  async tagConversation(
    conversationId: string,
    tagNames: string[],
    userId: string
  ): Promise<void> {
    // Verify ownership
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Create or get tags
    const tags = await Promise.all(
      tagNames.map(async (name) => {
        return this.prisma.tag.upsert({
          where: { name_userId: { name, userId } },
          update: {},
          create: { name, userId },
        });
      })
    );

    // Create conversation tags
    await this.prisma.conversationTag.createMany({
      data: tags.map(tag => ({
        conversationId,
        tagId: tag.id,
      })),
      skipDuplicates: true,
    });

    logger.info(`Tagged conversation ${conversationId} with: ${tagNames.join(', ')}`);
  }

  /**
   * Find similar conversations
   */
  async findSimilarConversations(
    conversationId: string,
    userId: string,
    limit: number = 5
  ): Promise<Conversation[]> {
    // Get the conversation's tags
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        tags: {
          include: { tag: true },
        },
      },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const tagIds = conversation.tags.map(ct => ct.tagId);

    if (tagIds.length === 0) {
      return [];
    }

    // Find conversations with similar tags
    const similar = await this.prisma.conversation.findMany({
      where: {
        userId,
        id: { not: conversationId },
        tags: {
          some: {
            tagId: { in: tagIds },
          },
        },
      },
      include: {
        tags: {
          include: { tag: true },
        },
      },
      take: limit,
      orderBy: { startedAt: 'desc' },
    });

    return similar;
  }

  /**
   * Export conversation
   */
  async exportConversation(
    conversationId: string,
    userId: string,
    format: 'json' | 'markdown' = 'json'
  ): Promise<string> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        messages: {
          orderBy: { timestamp: 'asc' },
        },
        tags: {
          include: { tag: true },
        },
        nasFiles: true,
      },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (format === 'markdown') {
      return this.exportAsMarkdown(conversation);
    }

    return JSON.stringify(conversation, null, 2);
  }

  /**
   * Export conversation as markdown
   */
  private exportAsMarkdown(conversation: any): string {
    let markdown = `# Conversation ${conversation.id}\n\n`;
    markdown += `**Date:** ${conversation.startedAt.toISOString()}\n`;
    markdown += `**Messages:** ${conversation.messageCount}\n`;
    markdown += `**Tags:** ${conversation.tags.map((t:any)=> t.tag.name).join(', ')}\n\n`;
    
    if (conversation.summary) {
      markdown += `## Summary\n\n${conversation.summary}\n\n`;
    }

    markdown += `## Messages\n\n`;

    for (const message of conversation.messages) {
      markdown += `### ${message.role.toUpperCase()}\n`;
      markdown += `*${message.timestamp.toISOString()}*\n\n`;
      markdown += `${message.content}\n\n---\n\n`;
    }

    return markdown;
  }
}