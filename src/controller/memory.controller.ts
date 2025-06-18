import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { SupabaseClient } from '@supabase/supabase-js';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { MemoryService } from '../services/memory/memory.service';
import { SearchService } from '../services/search/search.service';
import { ConversationService } from '../services/memory/conversation.service';
import { TriggerService } from '../services/memory/trigger.service';
import { NASService } from '../services/nas/nas.service';
import { log } from 'console';
import { logger } from '../utils/logger';
import { _success } from 'zod/v4/core';

export class MemoryController {
  private memoryService: MemoryService;
  private conversationService: ConversationService;
  private triggerService: TriggerService;
  private prisma: PrismaClient;
  private nas: NASService;
  private searchService: SearchService;

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
    this.searchService = new SearchService(prisma, vectorStore, nas);
  }
  /**
   * Save conversation
   */
  saveConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, metadata, conversationId } = req.body;
      const userId = req.user.id; // From auth middleware
      if (!messages) {
        return res.status(400).json({
          error: 'Message is required',
        });
      }
      
      const result = await this.memoryService.saveConversation(
        messages,
        userId,
        conversationId,
        metadata
      );
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
  /**
   * Get conversation by ID
   */
  getConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { includeContent = 'false', format = 'json' } = req.query;

      // Get conversation from database
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          id,
          userId,
        },
        include: {
          messages: {
            orderBy: { timestamp: 'asc' },
          },
          // tags: {
          //   include: {
          //     tag: true,
          //   },
          // },
          // nasFiles: true,
          // _count: {
          //   select: {
          //     messages: true,
          //   },
          // },
        },
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }
      return res.json({success:true, conversation});

      // let responseData: any = {
      //   ...conversation,
      //   tags: conversation.tags.map(ct => ct.tag.name),
      // };

      // Include full content from NAS if requested
    //   if (includeContent === 'true' && conversation.nasFiles.length > 0) {
    //     try {
    //       const nasFile = conversation.nasFiles[0];
    //       const content = await this.nas.readFile(nasFile.filePath);
    //       const parsedContent = JSON.parse(content);
          
    //       responseData = {
    //         ...responseData,
    //         fullContent: parsedContent,
    //         messages: parsedContent.messages || conversation.messages,
    //       };

    //       // Log file access
    //       await this.prisma.fileAccessLog.create({
    //         data: {
    //           userId,
    //           fileId: nasFile.id,
    //           accessType: 'read',
    //         },
    //       });
    //     } catch (error) {
    //       logger.error(`Failed to read NAS content for conversation ${id}:`, error);
    //       responseData.contentError = 'Failed to retrieve full content';
    //     }
    //   }

    //   // Export in requested format
    //   if (format === 'markdown') {
    //     const markdown = await this.conversationService.exportConversation(
    //       id,
    //       userId,
    //       'markdown'
    //     );
    //     res.setHeader('Content-Type', 'text/markdown');
    //     res.setHeader('Content-Disposition', `attachment; filename="conversation_${id}.md"`);
    //     return res.send(markdown);
    //   }

    //   res.json({
    //     success: true,
    //     data: responseData,
    //   });
     } catch (error) {
       logger.error('Error getting conversation:', error);
       next(error);
     }
  };

  /**
   * List conversations with advanced filtering
   */
  listConversations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const {
        limit = '20',
        offset = '0',
        tags,
        startDate,
        endDate,
        status,
        search,
        sortBy = 'startedAt',
        order = 'desc',
        minMessages,
        maxMessages,
      } = req.query;

      // Build where clause
      const where: any = { userId };

      // Tag filter
      // if (tags) {
      //   const tagArray = Array.isArray(tags) ? tags : [tags];
      //   where.tags = {
      //     some: {
      //       tag: {
      //         name: { in: tagArray },
      //       },
      //     },
      //   };
      // }

      // Date range filter
      // if (startDate || endDate) {
      //   where.startedAt = {};
      //   if (startDate) {
      //     where.startedAt.gte = new Date(startDate as string);
      //   }
      //   if (endDate) {
      //     where.startedAt.lte = new Date(endDate as string);
      //   }
      // }

      // Status filter
      // if (status) {
      //   where.status = status;
      // }

      // Message count filter
      // if (minMessages || maxMessages) {
      //   where.messageCount = {};
      //   if (minMessages) {
      //     where.messageCount.gte = parseInt(minMessages as string);
      //   }
      //   if (maxMessages) {
      //     where.messageCount.lte = parseInt(maxMessages as string);
      //   }
      // }

      // Search filter (searches in summary and metadata)
      // if (search) {
      //   where.OR = [
      //     { summary: { contains: search as string, mode: 'insensitive' } },
      //     { 
      //       metadata: { 
      //         path: ['$.title'], 
      //         string_contains: search as string 
      //       } 
      //     },
      //   ];
      // }

      // Execute query with pagination
      console.log(this.prisma.conversation)
      const [conversations, total] = await Promise.all([
        this.prisma.conversation.findMany({
          where
        }),
        this.prisma.conversation.count({ where }),
      ]);

      // Format response
      const formattedConversations = conversations.map(conv => ({
        id: conv.id,
        startedAt: conv.startedAt,
        endedAt: conv.endedAt,
        messageCount: conv.messageCount,
        totalTokens: conv.totalTokens,
        status: conv.status,
        summary: conv.summary,
        // tags: conv.tags.map(ct => ct.tag.name),
        // hasFile: conv.nasFiles.length > 0,
        // fileSize: conv.nasFiles[0]?.fileSize || null,
      }));

      res.json({
        success: true,
        data: formattedConversations,
        pagination: {
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          pages: Math.ceil(total / parseInt(limit as string)),
          hasMore: parseInt(offset as string) + parseInt(limit as string) < total,
        },
      });
    } catch (error) {
      logger.error('Error listing conversations:', error);
      next(error);
    }
  };

  /**
   * Update conversation
   */
  updateConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { status, summary, metadata, tags } = req.body;

      // Verify ownership
      const existing = await this.prisma.conversation.findFirst({
        where: { id, userId },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      // Update conversation
      const updated = await this.prisma.conversation.update({
        where: { id },
        data: {
          status: status || undefined,
          summary: summary || undefined,
          metadata: metadata ? { ...existing.metadata as any, ...metadata } : undefined,
          endedAt: status === 'completed' ? new Date() : undefined,
          updatedAt: new Date(),
        },
      });

      // Update tags if provided
      if (tags && Array.isArray(tags)) {
        await this.conversationService.tagConversation(id, tags, userId);
      }

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      logger.error('Error updating conversation:', error);
      next(error);
    }
  };

  /**
   * Delete conversation
   */
  deleteConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Verify ownership and get file info
      const conversation = await this.prisma.conversation.findFirst({
        where: { id, userId },
        include: { nasFiles: true },
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      // Delete NAS files
      // for (const file of conversation.nasFiles) {
      //   try {
      //     await this.nas.deleteFile(file.filePath);
      //     logger.info(`Deleted NAS file: ${file.filePath}`);
      //   } catch (error) {
      //     logger.error(`Failed to delete NAS file ${file.filePath}:`, error);
      //   }
      // }

      // Delete from database (cascades to related records)
      await this.prisma.conversation.delete({ where: { id } });

      res.json({
        success: true,
        message: 'Conversation deleted successfully',
        deletedFiles: conversation.nasFiles.length,
      });
    } catch (error) {
      logger.error('Error deleting conversation:', error);
      next(error);
    }
  };

  /**
   * Generate conversation summary
   */
}