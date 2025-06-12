import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { SupabaseClient } from '@supabase/supabase-js';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { MemoryService } from '../services/memory/memory.service';
import { ConversationService } from '../services/memory/conversation.service';
import { TriggerService } from '../services/memory/trigger.service';
import { NASService } from '../services/nas/nas.service';

export class MemoryController {
  private memoryService: MemoryService;
  private conversationService: ConversationService;
  private triggerService: TriggerService;
  private prisma: PrismaClient;
  private nas: NASService;

  constructor(
    prisma: PrismaClient,
    supabase: SupabaseClient,
    nas: NASService,
    pinecone: PineconeClient,
    vectorStore: PineconeStore
  ) {
    this.prisma = prisma;
    this.nas = nas;
    this.memoryService = new MemoryService(prisma, supabase, nas, pinecone, vectorStore);
    this.conversationService = new ConversationService(prisma);
    this.triggerService = new TriggerService(prisma);
  }

  /**
   * Save conversation
   */
  saveConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, metadata } = req.body;
      const userId = req.user.id; // From auth middleware

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          error: 'Messages array is required',
        });
      }

      const result = await this.memoryService.saveConversation(
        messages,
        userId,
        metadata
        );
        
      res.json({
        success: true,
        data: { result },
      });
    } catch (error) {
      next(error);
    }
  };
}