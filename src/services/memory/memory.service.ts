import { Conversation, PrismaClient } from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Document } from "@langchain/core/documents";
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { NASService } from '../nas/nas.service';
import { LangChainService } from '../pinecone/langchain.service';
import { SearchOptions, SearchService } from '../search/search.service';
import { FileIndexer } from '../indexer/file.indexer';
import { MemoryParser } from "../pinecone/memory.parser";
import { QueryParser, QueryIntent } from '../pinecone/query.parser';
import { logger } from '../../utils/logger';
import { log, timeStamp } from 'console';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  conversation_id?:string;
  filePath?:string;
  timestamp?: Date;
}

export interface SaveConversationResult {
  conversation: Conversation,
  filePath: string;
  indexed: boolean;
  message: any;
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
  private searchService: SearchService;
  private memoryParser: MemoryParser;

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
    this.memoryParser = new MemoryParser(prisma, supabase, nas, pinecone, vectorStore);
    this.indexer = new FileIndexer(prisma, nas, pinecone);
    this.langchain = new LangChainService(this.vectorStore);
    this.searchService = new SearchService(prisma, vectorStore, nas);
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
    conversationId?: string,
    metadata?: Record<string, any>
  ): Promise<SaveConversationResult> {
    logger.info(`Saving conversation for user ${userId} with ${messages.length} messages`);
  
    try {
      // 1. Analyze conversation with LangChain
      /*
        4. Query Handler
        Accept query like: “What did I say about health last week?”
        Search memory entries (by keyword, tag, or date range)
        Return matching structured entries or summarized output
      */
      const analysis = await this.langchain.analyzeConversation(messages);

      if (analysis.action == "storeandSave") {
        const anylysiz = await this.memoryParser.analyzeText(messages,userId,conversationId);
      }
      logger.info("messages", messages);
      logger.info("analysis", analysis);
      
      // 2. Create conversation record in database
      let existingConversation = null;
      if (conversationId) {
        existingConversation = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          include:{ messages: true}
        });
      }
  
      const conversationMetadata = {
        ...metadata,
        analysis: {
          action: analysis.action,
          conversationId: conversationId,
          dateRange: analysis.dateRange,
          fileType: analysis.fileType,
          summary: analysis.summary,
          tags: analysis.tags,
          type: analysis.type
        },
      };

      let conversation;
      if (existingConversation) {
        // Update existing conversation
        const newMessageCount = existingConversation.messages.length + messages.length;
        conversation = await this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            messageCount: newMessageCount,
            totalTokens: this.estimateTokens(messages),
            metadata: {
              ...((typeof existingConversation.metadata === 'object' &&
                existingConversation.metadata !== null)
                ? (existingConversation.metadata as Record<string, any>)
                : {}),
              ...conversationMetadata
            },
          },
        });
      } else {
        // Create new conversation
        conversation = await this.prisma.conversation.create({
          data: {
            userId,
            messageCount: messages.length,
            totalTokens: this.estimateTokens(messages),
            status: 'active',
            summary: analysis.summary,
            metadata: {
              ...conversationMetadata
            },
          },
        });
      }
  
      if (!conversation) {
        throw new Error("Failed to create or update conversation");     
      }
      // 3. Extract entities for better searchability
      let conversationText = messages.map(m => m.content).join(' ');
      const entities = await this.langchain.extractEntities(conversationText);
      
      // 4. Auto-tag based on topics and entities
      const autoTags = [...analysis.tags, ...entities.topics].filter(
        (tag, index, self) => self.indexOf(tag) === index
      );
      
      if (autoTags.length > 0) {
        await this.tagConversationWithTopics(conversation.id, autoTags, userId);
      }
  
      // 5. Save messages metadata to database

      await this.prisma.message.createMany({
        data: messages.map((msg, index) => ({
          conversationId: conversation.id,
          role: msg.role,
          content: msg.content,
          tokenCount: this.estimateTokens([msg]),
          timestamp: msg.timestamp || new Date(),
          vectorId: `vec_${conversation.id}_${index}`,
        })),
      });
  
      // 8. Build file path and save to NAS
      let filePath = "", filename = "";
      let result = '';
      if(analysis.action =="store"){
        filename = `conv_${conversation.id}_${new Date().toISOString()}.json`;
        filePath = NASService.buildUserPath(userId, 'conversations', filename);

        const unSavedMgs = await this.prisma.message.findMany({
          where: {
            conversationId: conversation.id,
            filePath: "",
          },
          orderBy: { timestamp: 'asc' },
          select: {
            id: true,
            conversationId: true,
            role: true,
            tokenCount: true,
            content: true,
            vectorId: true,
            metadata: true,
            timestamp: true,
          },
        });
        const fileContent = {
          id: conversation.id,
          userId,
          timestamp: new Date().toISOString(),
          messages: unSavedMgs,
          metadata: {
            ...metadata,
            messageCount: messages.length,
            totalTokens: conversation.totalTokens,
            analysis,
            entities,
          },
        };

        await this.nas.writeFile(filePath, JSON.stringify(fileContent, null, 2));
        await this.prisma.message.updateMany({
          where: {
            id: {
              in: unSavedMgs.map(m => m.id),
            },
          },
          data: {
            filePath,
          },
        });
        
        const messageResult = await this.prisma.message.findMany({
          where: { id: conversationId }
        })
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
            vectorIds: messageResult.map((_, i) => `vec_${conversation.id}_${i}`),
            indexedAt: new Date(),
          },
        });
        result = await this.langchain.generateFollowUpQuestions(
          conversationText
        );
        logger.info(`Successfully saved conversation ${conversation.id} to ${filePath}`);
        result = await this.langchain.savePrompt()
      }else if(analysis.action =="search"){
        const options : SearchOptions= {
          limit: 10,
          offset: 0,
          fileTypes: analysis.fileType ? [analysis.fileType] : undefined, 
          tags: analysis.tags,
          dateRange: analysis.dateRange?.length && analysis.dateRange[1]
            ? {
                start: new Date(analysis.dateRange[0]).toISOString(), 
                end: new Date(analysis.dateRange[1]).toISOString(), 
              }
            : undefined,
        };
        const p_result = await this.searchService.search(conversationText, userId, options);
        result = await this.langchain.searchPrompt(conversationText, p_result)

      } else {
        const options : SearchOptions= {
          limit:40,
          offset: 0,
        };
        const p_result = await this.searchService.search(conversationText, userId, options)
        result = await this.langchain.generalPrompt(conversationText, p_result)
      }

      const AIMessage = await this.prisma.message.create({
        data: {
          conversationId : conversation.id,
          role : 'assistant',
          content: result,
          tokenCount: 1,
          timestamp: new Date(),
          vectorId: `vec_${conversation.id}_${new Date().toISOString()}`,
        }
      });

      const documents = await this.createConversationDocuments(
        messages,
        conversation.id,
        userId,
        filePath
      );

      //Add documents to Pinecone via LangChain
      await this.langchain.addDocumentsToPinecone(documents);

      return {
        filePath,
        message: AIMessage,
        conversation: conversation,
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
      const messageText =  messages[i].content;
      /*
      5. Summarizer Agent
      For longer entries: auto-generate a summary and store it alongside raw data
      Use basic prompt → send to OpenAI if needed (optional for now)
      */
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
        role: messages[0].role,
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