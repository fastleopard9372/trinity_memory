import { PrismaClient } from '@prisma/client';
import { PineconeStore } from '@langchain/pinecone';
import { NASService } from '../nas/nas.service';
import { QueryParser } from '../pinecone/query.parser';
import { logger } from '../../utils/logger';

export interface SearchResult {
  id: string;
  path: string;
  fileName: string;
  fileType: string;
  content: string;
  metadata: any;
  tags: string[];
  summary?: string;
  createdAt: Date;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  fileTypes?: string[];
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export class SearchService {
  private prisma: PrismaClient;
  private vectorStore: PineconeStore;
  private nas: NASService;
  private queryParser: QueryParser;

  constructor(
    prisma: PrismaClient,
    vectorStore: PineconeStore,
    nas: NASService
  ) {
    this.prisma = prisma;
    this.vectorStore = vectorStore;
    this.nas = nas;
    this.queryParser = new QueryParser();
  }

  /**
   * Main search function - routes to appropriate search method
   */
  async search(
    query: string,
    userId: string,
    options?: SearchOptions
  ): Promise<(SearchResult|null)[]> {
    logger.info(`Searching for: "${query}" for user ${userId}`);

    // Parse query intent
    const intent = await this.queryParser.parseQuery(query);

    let filePaths: string[];

    switch (intent.type) {
      case 'semantic':
        filePaths = await this.semanticSearch(query, userId, options);
        break;
      case 'structured':
        filePaths = await this.structuredSearch(intent.filters, userId, options);
        break;
      case 'hybrid':
        filePaths = await this.hybridSearch(query, intent.filters, userId, options);
        break;
      default:
        throw new Error(`Unknown search type: ${intent.type}`);
    }

    // Retrieve file contents from NAS
    const results = await this.retrieveFileContents(filePaths, userId);

    // Log search query for analytics
    await this.logSearchQuery(query, intent.type, filePaths, userId);

    return results;
  }

  /**
   * Semantic search using Pinecone
   */
  private async semanticSearch(
    query: string,
    userId: string,
    options?: SearchOptions
  ): Promise<string[]> {
    logger.info(`Performing semantic search for: "${query}"`);

    // Build metadata filter
    const filter: any = { userId };
    if (options?.fileTypes?.length) {
      filter.fileType = { $in: options.fileTypes };
    }

    // Search in Pinecone
    const vectorResults = await this.vectorStore.similaritySearch(
      query,
      options?.limit || 20,
      filter
    );

    // Extract unique file paths with scores
    const pathScores = new Map<string, number>();

    vectorResults.forEach(result => {
      const path = result.metadata.filePath;
      const currentScore = pathScores.get(path) || 0;
      pathScores.set(path, Math.max(currentScore, (result as any).score || 0));
    });

    // Sort by score and return paths
    return Array.from(pathScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, options?.limit || 10)
      .map(([path]) => path);
  }

  /**
   * Structured search using PostgreSQL
   */
  private async structuredSearch(
    filters: any,
    userId: string,
    options?: SearchOptions
  ): Promise<string[]> {
    logger.info('Performing structured search with filters:', filters);

    const whereClause: any = { userId };

    // Apply filters
    if (filters.fileType || options?.fileTypes?.length) {
      whereClause.fileType = {
        in: filters.fileType ? [filters.fileType] : options!.fileTypes,
      };
    }

    if (filters.tags || options?.tags?.length) {
      whereClause.tags = {
        hasEvery: filters.tags || options!.tags,
      };
    }

    if (filters.dateRange || options?.dateRange) {
      const range = filters.dateRange || options!.dateRange;
      whereClause.createdAt = {
        gte: range.start,
        lte: range.end,
      };
    }

    if (filters.conversationId) {
      whereClause.conversationId = filters.conversationId;
    }

    // Query database
    const files = await this.prisma.nasFile.findMany({
      where: whereClause,
      select: { filePath: true },
      take: options?.limit || 10,
      skip: options?.offset || 0,
      orderBy: { createdAt: 'desc' },
    });

    return files.map(f => f.filePath);
  }

  /**
   * Hybrid search combining semantic and structured
   */
  private async hybridSearch(
    query: string,
    filters: any,
    userId: string,
    options?: SearchOptions
  ): Promise<string[]> {
    logger.info('Performing hybrid search');

    // Run both searches in parallel
    const [semanticPaths, structuredPaths] = await Promise.all([
      this.semanticSearch(query, userId, options),
      this.structuredSearch(filters, userId, options),
    ]);

    // Merge results with scoring
    const pathScores = new Map<string, number>();

    // Add semantic results with higher weight
    semanticPaths.forEach((path, index) => {
      const score = (semanticPaths.length - index) / semanticPaths.length * 1.5;
      pathScores.set(path, score);
    });

    // Add structured results
    structuredPaths.forEach((path, index) => {
      const score = (structuredPaths.length - index) / structuredPaths.length * 0.5;
      const currentScore = pathScores.get(path) || 0;
      pathScores.set(path, currentScore + score);
    });

    // Sort by combined score
    return Array.from(pathScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, options?.limit || 10)
      .map(([path]) => path);
  }

  /**
   * Retrieve file contents from NAS
   */
  private async retrieveFileContents(
    filePaths: string[],
    userId: string
  ): Promise<(SearchResult|null)[]> {
    // Get file metadata from database
    const fileRecords = await this.prisma.nasFile.findMany({
      where: {
        filePath: { in: filePaths },
        userId,
      },
    });

    // Create a map for easy lookup
    const fileMap = new Map(fileRecords.map(f => [f.filePath, f]));

    // Retrieve contents in parallel
    const results = await Promise.allSettled(
      filePaths.map(async (filePath) => {
        const fileRecord = fileMap.get(filePath);
        if (!fileRecord) {
          logger.warn(`File record not found for path: ${filePath}`);
          return null;
        }

        try {
          // Read content from NAS
          const content = await this.nas.readFile(filePath);

          // Log file access
          await this.logFileAccess(fileRecord.id, userId, 'search');

          return {
            id: fileRecord.id,
            path: fileRecord.filePath,
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType || 'unknown',
            content,
            metadata: fileRecord.metadata || {},
            tags: fileRecord.tags,
            summary: fileRecord.summary || undefined,
            createdAt: fileRecord.createdAt,
            score: 1.0, // Will be updated based on search relevance
          };
        } catch (error) {
          logger.error(`Failed to read file ${filePath}:`, error);
          return null;
        }
      })
    );

    return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.status === 'fulfilled' ? r.value : null);
  }

  /**
   * Log search query for analytics
   */
  private async logSearchQuery(
    query: string,
    queryType: string,
    filePaths: string[],
    userId: string
  ): Promise<void> {
    try {
      await this.prisma.searchQuery.create({
        data: {
          userId,
          queryText: query,
          queryType,
          filePaths,
          executionTimeMs: 0, // TODO: Implement timing
        },
      });
    } catch (error) {
      logger.error('Failed to log search query:', error);
    }
  }

  /**
   * Log file access
   */
  private async logFileAccess(
    fileId: string,
    userId: string,
    accessType: string
  ): Promise<void> {
    try {
      await this.prisma.fileAccessLog.create({
        data: {
          userId,
          fileId,
          accessType,
        },
      });

      // Update last accessed timestamp
      await this.prisma.nasFile.update({
        where: { id: fileId },
        data: { lastAccessed: new Date() },
      });
    } catch (error) {
      logger.error('Failed to log file access:', error);
    }
  }

  /**
   * Get file by direct path
   */
  async getFileByPath(filePath: string, userId: string): Promise<SearchResult> {
    // Check permissions
    const fileRecord = await this.prisma.nasFile.findFirst({
      where: {
        filePath,
        userId,
      },
    });

    if (!fileRecord) {
      throw new Error('File not found or access denied');
    }

    // Read content from NAS
    const content = await this.nas.readFile(filePath);

    // Log access
    await this.logFileAccess(fileRecord.id, userId, 'direct');

    return {
      id: fileRecord.id,
      path: fileRecord.filePath,
      fileName: fileRecord.fileName,
      fileType: fileRecord.fileType || 'unknown',
      content,
      metadata: fileRecord.metadata || {},
      tags: fileRecord.tags,
      summary: fileRecord.summary || undefined,
      createdAt: fileRecord.createdAt,
      score: 1.0,
    };
  }
}