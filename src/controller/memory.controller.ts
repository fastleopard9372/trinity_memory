import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { MemoryService } from '../services/memory/memory.service';
import { NASService } from '../services/nas/nas.service';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';

export class MemoryController {
  private memoryService: MemoryService;

  constructor(
    prisma: PrismaClient,
    supabase: any,
    nas: NASService,
    pinecone: PineconeClient
  ) {
    this.memoryService = new MemoryService(prisma, supabase, pinecone, nas);
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