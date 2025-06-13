import { PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Document } from "@langchain/core/documents";
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { NASService } from '../nas/nas.service';
import { FileIndexer } from '../indexer/file.indexer';
import { QueryParser, QueryIntent } from '../pinecone/query.parser';
import { logger } from '../../utils/logger';
import { log, timeStamp } from 'console';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface SaveConversationResult {
  conversationId: string;
  filePath: string;
  indexed: boolean;
  messageCount: number;
}

export class MemoryService {
  private prisma: PrismaClient;
  private supabase: SupabaseClient;
  private pinecone: PineconeClient;
  private nas: NASService;
  private indexer: FileIndexer;
  private vectorStore: PineconeStore;

  constructor(
    prisma: PrismaClient,
    supabase: SupabaseClient,
    nas: NASService,
    pinecone: PineconeClient,
    vectorStore: PineconeStore
  ) {
    this.prisma = prisma;
    this.supabase = supabase;
    this.pinecone = pinecone;
    this.vectorStore = vectorStore;
    this.nas = nas;
    this.indexer = new FileIndexer(prisma, nas, pinecone);
  }
  /**
   * Save conversation to NAS and index file paths
   */
  async saveConversation(
    message: Message,
    userId: string,
    metadata?: Record<string, any>
  ): Promise<SaveConversationResult> {
    logger.info(`Saving conversation for user ${userId} with message`);
    try {
      const conversation = {
        id: (Math.random() * 9999).toString(),
        totalTokens: "jk-porj-sdfwioefhnwoefwe0hojsldfsho09"
      }

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      logger.info("saving in pinecone...");
        const fullText = `[${message.role}] ${message.content}`;
        const chunks = await textSplitter.splitText(fullText);
        const documents = chunks.map((chunk, idx) => new Document({
        pageContent: chunk,
        metadata: {
          conversationId:conversation.id,
          userId,
          type: 'conversation',
          chunkIndex: idx,
          totalChunks: chunks.length,
          timestamp: new Date().toISOString(),
          ...metadata
        },
      }));
      await this.vectorStore.addDocuments(documents);
      logger.info("saved in pinecone");

      // 2. Create conversation record in database
      // const conversation = await this.prisma.conversation.create({
      //   data: {
      //     userId,
      //     messageCount: messages.length,
      //     totalTokens: this.estimateTokens(messages),
      //     status: 'active',
      //     metadata: metadata || {},
      //   },
      // });
      

      // 3. Save messages metadata to database
      // const messageRecords = await this.prisma.message.createMany({
      //   data: messages.map((msg, index) => ({
      //     conversationId: conversation.id,
      //     role: msg.role,
      //     tokenCount: this.estimateTokens([msg]),
      //     timestamp: msg.timestamp || new Date(),
      //     vectorId: vectorId,
      //   })),
      // });

      // 4. Prepare conversation file content
      const fileContent = {
        id: conversation.id,
        userId,
        timestamp: new Date().toISOString(),
        message: message,
        metadata: {
          ...metadata,
          messageCount: 1,
          totalTokens: conversation.totalTokens,
        },
      };

      // 5. Build file path and save to NAS

      // const filename = `conv_${conversation.id}.json`;
      // const filePath = NASService.buildUserPath(userId, 'conversations', filename);
      
      // await this.nas.writeFile(filePath, JSON.stringify(fileContent, null, 2));

      // 6. Index the file (stores path in PostgreSQL)
      // await this.indexer.indexFile(filePath, userId, conversation.id);

      // 7. Check for memory triggers
      // await this.checkMemoryTriggers(conversation.id, messages, userId);

      // logger.info(`Successfully saved conversation ${conversation.id} to ${filePath}`);

      return {
        conversationId: conversation.id,
        filePath:"",
        indexed: true,
        messageCount: 1,
      };
    } catch (error) {
      logger.error('Failed to save conversation:', error);
      throw error;
    }
  }

  /**
   * Generate summary for conversation
   */
  async generateSummary(conversationId: string): Promise<string> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { nasFiles: true },
    });

    if (!conversation || !conversation.nasFiles[0]) {
      throw new Error('Conversation not found');
    }

    // Read conversation from NAS
    const content = await this.nas.readFile(conversation.nasFiles[0].filePath);
    const data = JSON.parse(content);

    // Generate summary using OpenAI
    // This is a placeholder - implement actual summary generation
    const summary = `Conversation with ${data.messages.length} messages about various topics.`;

    // Update conversation with summary
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { summary },
    });

    // Save summary file to NAS
    const summaryPath = NASService.buildUserPath(
      conversation.userId,
      'summaries',
      `summary_${conversationId}.md`
    );

    await this.nas.writeFile(summaryPath, summary);
    

    // Index summary file
    await this.indexer.indexFile(summaryPath, conversation.userId, conversationId);

    return summary;
  }

  /**
   * Check and execute memory triggers
   */
  private async checkMemoryTriggers(
    conversationId: string,
    messages: Message[],
    userId: string
  ): Promise<void> {
    const rules = await this.prisma.memoryRule.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    for (const rule of rules) {
      const conditions = rule.conditions as any;
      let triggered = false;

      switch (rule.ruleType) {
        case 'length':
          if (messages.length >= conditions.minMessages) {
            triggered = true;
          }
          break;

        case 'keyword':
          const keywords = conditions.keywords as string[];
          const content = messages.map(m => m.content).join(' ').toLowerCase();
          triggered = keywords.some(keyword => content.includes(keyword.toLowerCase()));
          break;

        case 'time':
          // Implement time-based triggers
          break;
      }

      if (triggered) {
        await this.prisma.memoryTrigger.create({
          data: {
            triggerType: rule.ruleType,
            conversationId,
            details: rule.actions ? JSON.parse(JSON.stringify(rule.actions)) : undefined,
          },
        });

        // Execute actions
        await this.executeMemoryActions(rule.actions as any, conversationId);
      }
    }
  }

  /**
   * Execute memory trigger actions
   */
  private async executeMemoryActions(
    actions: any,
    conversationId: string
  ): Promise<void> {
    if (actions.generateSummary) {
      await this.generateSummary(conversationId);
    }

    if (actions.backup) {
      // Trigger backup workflow
      logger.info(`Triggering backup for conversation ${conversationId}`);
    }

    if (actions.notify) {
      // Send notification
      logger.info(`Sending notification for conversation ${conversationId}`);
    }
  }

  /**
   * Estimate token count for messages
   */
  private estimateTokens(messages: Message[]): number {
    // Simple estimation: ~4 characters per token
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    return Math.ceil(totalChars / 4);
  }
}