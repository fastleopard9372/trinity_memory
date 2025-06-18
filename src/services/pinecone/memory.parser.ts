import { Conversation, PrismaClient } from '@prisma/client';
import { SupabaseClient } from '@supabase/supabase-js';
import { Document } from "@langchain/core/documents";
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { NASService } from '../nas/nas.service';
import { LangChainService } from './langchain.service';
import { SearchOptions, SearchService } from '../search/search.service';
import { FileIndexer } from '../indexer/file.indexer';
import { logger } from '../../utils/logger';

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

export class MemoryParser {
  private prisma: PrismaClient;
  private supabase: any;
  private pinecone: PineconeClient;
  private nas: NASService;
  private indexer: FileIndexer;
  private vectorStore: PineconeStore;
  private langchain: LangChainService;
  private searchService: SearchService;

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
  async analyzeText(
    messages: Message[],
    userId: string,
    conversationId?: string,
    metadata?: Record<string, any>
  ): Promise<any> {
    logger.info(`Saving conversation for user ${userId} with ${messages.length} messages`);
  
    try {
      // 1. Analyze conversation with LangChain
      /*
        2. Memory Parser
        Extract from text:
        date (from text or default to today)
        people (names)
        topics (noun phrases)
        actions (sentences with verbs + "I"/"we")
        tags (nouns + named entities)
      */
      const analysis = await this.langchain.analyzeText(messages);
      
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
          Date: analysis?.date,
          people: analysis?.people,
          tags: analysis.tags,
          topics: analysis?.topics
        },
      };
    } catch (error) {
      logger.error('Failed to save conversation:', error);
      throw error;
    }
  }
}