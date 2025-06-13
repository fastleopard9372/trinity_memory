import { PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Document } from "@langchain/core/documents";
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { NASService } from '../nas/nas.service';
import { LangChainService } from '../pinecone/langchain.service';
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
  private supabase: any;
  private pinecone: PineconeClient;
  private nas: NASService;
  private indexer: FileIndexer;
  private vectorStore: PineconeStore;
  private langchain: LangChainService;

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
    this.langchain = new LangChainService();
  }
  async initialize() {
    // Initialize LangChain with Pinecone
    await this.langchain.initializePineconeStore(this.pinecone, 'trinity-memory');
  }

  /**
   * Save conversation to NAS and index file paths with LangChain
   */
  async saveConversation(
    messages: Message[],
    userId: string,
    metadata?: Record<string, any>
  ): Promise<SaveConversationResult> {
    logger.info(`Saving conversation for user ${userId} with ${messages.length} messages`);

    try {
      // 1. Analyze conversation with LangChain
      const analysis = await this.langchain.analyzeConversation(messages);
      logger.info("messages", messages);  
      logger.info("analysis", analysis);
      // 2. Create conversation record in database
      const conversation = await this.prisma.conversation.create({
        data: {
          userId,
          messageCount: messages.length,
          totalTokens: this.estimateTokens(messages),
          status: 'active',
          summary: analysis.summary,
          metadata: {
            ...metadata,
            analysis: {
              topics: analysis.topics,
              sentiment: analysis.sentiment,
              keyPoints: analysis.keyPoints,
              actionItems: analysis.actionItems,
            },
          },
        },
      });

      // 3. Extract entities for better searchability
      const conversationText = messages.map(m => m.content).join(' ');
      const entities = await this.langchain.extractEntities(conversationText);
      
      // 4. Auto-tag based on topics and entities
      const autoTags = [...analysis.topics, ...entities.topics].filter(
        (tag, index, self) => self.indexOf(tag) === index
      );
      
      if (autoTags.length > 0) {
        await this.tagConversationWithTopics(conversation.id, autoTags, userId);
      }

      // 5. Save messages metadata to database
      const messageRecords = await this.prisma.message.createMany({
        data: messages.map((msg, index) => ({
          conversationId: conversation.id,
          role: msg.role,
          tokenCount: this.estimateTokens([msg]),
          timestamp: msg.timestamp || new Date(),
          vectorId: `vec_${conversation.id}_${index}`,
        })),
      });

      // 6. Prepare conversation file content
      const fileContent = {
        id: conversation.id,
        userId,
        timestamp: new Date().toISOString(),
        messages: messages,
        metadata: {
          ...metadata,
          messageCount: messages.length,
          totalTokens: conversation.totalTokens,
          analysis,
          entities,
        },
      };

      // 7. Build file path and save to NAS
      const filename = `conv_${conversation.id}.json`;
      const filePath = NASService.buildUserPath(userId, 'conversations', filename);
      
      await this.nas.writeFile(filePath, JSON.stringify(fileContent, null, 2));

      // 8. Create LangChain documents from messages
      const documents = await this.createConversationDocuments(
        messages,
        conversation.id,
        userId,
        filePath
      );

      // 9. Add documents to Pinecone via LangChain
      await this.langchain.addDocumentsToPinecone(documents);

      // 10. Store file path reference in database
      await this.prisma.nasFile.create({
        data: {
          userId,
          filePath,
          fileName: filename,
          folderPath: NASService.buildUserPath(userId, 'conversations', ''),
          fileType: 'conversation',
          fileSize: BigInt(JSON.stringify(fileContent).length),
          checksum: await this.nas.getFileChecksum(filePath),
          title: `Conversation on ${new Date().toLocaleDateString()}`,
          summary: analysis.summary,
          tags: autoTags,
          metadata: JSON.parse(JSON.stringify({ analysis, entities })),
          conversationId: conversation.id,
          vectorIds: documents.map((_, i) => `vec_${conversation.id}_${i}`),
          indexedAt: new Date(),
        },
      });

      // 11. Generate follow-up questions for future reference
      const followUpQuestions = await this.langchain.generateFollowUpQuestions(
        conversationText,
        3
      );
      
      if (followUpQuestions.length > 0) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            metadata: {
              ...conversation.metadata as any,
              followUpQuestions,
            },
          },
        });
      }

      logger.info(`Successfully saved conversation ${conversation.id} to ${filePath}`);

      return {
        conversationId: conversation.id,
        filePath,
        indexed: true,
        messageCount: messages.length,
      };
    } catch (error) {
      logger.error('Failed to save conversation:', error);
      throw error;
    }
  }

  /**
   * Generate summary for conversation using LangChain
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

    // Generate smart summary using LangChain
    const summary = await this.langchain.generateSmartSummary(
      conversationId,
      data.messages
    );

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
   * Create LangChain documents from messages
   */
  private async createConversationDocuments(
    messages: Message[],
    conversationId: string,
    userId: string,
    filePath: string
  ): Promise<Document[]> {
    // Split messages into chunks if needed
    const chunks: { text: string; messageIndices: number[] }[] = [];
    let currentChunk = '';
    let currentIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const messageText = `${messages[i].role}: ${messages[i].content}`;
      
      if (currentChunk.length + messageText.length > 1000) {
        if (currentChunk) {
          chunks.push({ text: currentChunk, messageIndices: currentIndices });
        }
        currentChunk = messageText;
        currentIndices = [i];
      } else {
        currentChunk += '\n\n' + messageText;
        currentIndices.push(i);
      }
    }

    if (currentChunk) {
      chunks.push({ text: currentChunk, messageIndices: currentIndices });
    }

    // Create documents with metadata
    return chunks.map((chunk, index) => new Document({
      pageContent: chunk.text,
      metadata: {
        conversationId,
        userId,
        filePath,
        chunkIndex: index,
        totalChunks: chunks.length,
        messageIndices: chunk.messageIndices,
        timestamp: new Date().toISOString(),
        type: 'conversation',
      },
    }));
  }

  /**
   * Tag conversation based on extracted topics
   */
  private async tagConversationWithTopics(
    conversationId: string,
    topics: string[],
    userId: string
  ): Promise<void> {
    const tags = await Promise.all(
      topics.slice(0, 5).map(async (topic) => { // Limit to 5 tags
        return this.prisma.tag.upsert({
          where: { name_userId: { name: topic.toLowerCase(), userId } },
          update: {},
          create: { 
            name: topic.toLowerCase(), 
            userId,
            category: 'auto-generated',
          },
        });
      })
    );

    await this.prisma.conversationTag.createMany({
      data: tags.map(tag => ({
        conversationId,
        tagId: tag.id,
      })),
      skipDuplicates: true,
    });
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
            details: JSON.parse(JSON.stringify(rule.actions)),
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