import { Document } from 'langchain/document';
import { PrismaClient } from '@prisma/client';
import { PineconeStore } from '@langchain/pinecone';
import { NASService } from '../nas/nas.service';
import { QueryParser } from '../pinecone/query.parser';
import { LangChainService } from '../pinecone/langchain.service';
import { logger } from '../../utils/logger';

export interface SearchResult {
  id: string;
  path: string;
  fileName: string;
  fileType: string;
  content: string;
  metadata: any;
  tags: string[];
  summary: string;
  createdAt: Date;
  score: number;
  relevantSection?: string; // Most relevant part of the content
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
  private langchain: LangChainService;

  constructor(
    prisma: PrismaClient,
    vectorStore: PineconeStore,
    nas: NASService
  ) {
    this.prisma = prisma;
    this.vectorStore = vectorStore;
    this.nas = nas;
    this.queryParser = new QueryParser();
    this.langchain = new LangChainService();
  }

  /**
   * Initialize LangChain service
   */
  async initialize(pineconeClient: any) {
    await this.langchain.initializePineconeStore(
      pineconeClient, 
      process.env.PINECONE_INDEX || 'trinity-memory'
    );
  }

  /**
   * Main search function with LangChain enhancement
   */
  async search(
    query: string,
    userId: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    logger.info(`Searching for: "${query}" for user ${userId}`);

    // Parse query intent
    const intent = await this.queryParser.parseQuery(query);

    let results: SearchResult[];

    switch (intent.type) {
      case 'semantic':
        results = await this.semanticSearchWithLangChain(query, userId, options);
        break;
      case 'structured':
        results = await this.structuredSearch(intent.filters, userId, options);
        break;
      case 'hybrid':
        results = await this.hybridSearchWithLangChain(query, intent.filters, userId, options);
        break;
      default:
        throw new Error(`Unknown search type: ${intent.type}`);
    }

    // Log search query for analytics
    await this.logSearchQuery(query, intent.type, results.map(r => r.path), userId);

    return results;
  }

  /**
   * Semantic search using LangChain
   */
  private async semanticSearchWithLangChain(
    query: string,
    userId: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    logger.info(`Performing semantic search with LangChain for: "${query}"`);

    // Build metadata filter
    const filter: any = { userId };
    if (options?.fileTypes?.length) {
      filter.fileType = { $in: options.fileTypes };
    }

    // Use LangChain for similarity search with scores
    const searchResults = await this.langchain.similaritySearchWithScore(
      query,
      options?.limit || 10,
      filter
    );

    // Group results by file path
    const filePathMap = new Map<string, { doc: Document; score: number }[]>();
    
    searchResults.forEach(([doc, score]) => {
      const filePath = doc.metadata.filePath;
      if (!filePathMap.has(filePath)) {
        filePathMap.set(filePath, []);
      }
      filePathMap.get(filePath)!.push({ doc, score });
    });

    // Get file contents and build results
    const results: SearchResult[] = [];
    
    for (const [filePath, docs] of filePathMap.entries()) {
      try {
        // Get file metadata from database
        const fileRecord = await this.prisma.nasFile.findFirst({
          where: { filePath, userId },
        });

        if (!fileRecord) continue;

        // Read content from NAS
        const content = await this.nas.readFile(filePath);

        // Find the most relevant section
        const bestMatch = docs.reduce((best, current) => 
          current.score > best.score ? current : best
        );

        // Extract relevant section from content
        const relevantSection = this.extractRelevantSection(
          content,
          bestMatch.doc.pageContent
        );

        results.push({
          id: fileRecord.id,
          path: fileRecord.filePath,
          fileName: fileRecord.fileName,
          fileType: fileRecord.fileType || 'unknown',
          content,
          metadata: {
            ...((fileRecord.metadata ?? {}) as Record<string, any>),
            matchedChunks: docs.length,
            bestScore: bestMatch.score,
          },
          tags: fileRecord.tags,
          summary: fileRecord.summary ?? '',
          createdAt: fileRecord.createdAt,
          score: bestMatch.score,
          relevantSection,
        });

        // Log file access
        await this.logFileAccess(fileRecord.id, userId, 'search');
      } catch (error) {
        logger.error(`Failed to process file ${filePath}:`, error);
      }
    }

    // Sort by score
    return results.sort((a, b) => b.score - a.score).slice(0, options?.limit || 10);
  }

  /**
   * Hybrid search using LangChain
   */
  private async hybridSearchWithLangChain(
    query: string,
    filters: any,
    userId: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    logger.info('Performing hybrid search with LangChain');

    // Run both searches in parallel
    const [semanticResults, structuredResults] = await Promise.all([
      this.semanticSearchWithLangChain(query, userId, options),
      this.structuredSearch(filters, userId, options),
    ]);

    // Merge and score results
    const resultMap = new Map<string, SearchResult>();

    // Add semantic results with boosted scores
    semanticResults.forEach(result => {
      resultMap.set(result.path, {
        ...result,
        score: result.score * 1.5, // Boost semantic matches
      });
    });

    // Add structured results
    structuredResults.forEach(result => {
      if (resultMap.has(result.path)) {
        // Boost items that match both searches
        const existing = resultMap.get(result.path)!;
        existing.score += 0.5;
      } else {
        resultMap.set(result.path, {
          ...result,
          score: 0.5,
        });
      }
    });

    // Return sorted results
    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.limit || 10);
  }

  /**
   * Conversational search using LangChain
   */
  async conversationalSearch(
    query: string,
    userId: string,
    conversationHistory?: string[]
  ): Promise<{
    answer: string;
    sources: SearchResult[];
  }> {
    logger.info('Performing conversational search');

    // Create conversational chain
    const { retriever, qaPrompt, llm } = await this.langchain.createConversationalChain(userId);

    // Get relevant documents
    const relevantDocs = await retriever.getRelevantDocuments(query);

    // Build context from documents
    const context = relevantDocs
      .map(doc => doc.pageContent)
      .join('\n\n');

    // Generate answer
    const prompt = await qaPrompt.format({
      context,
      question: query,
    });

    const answer = await llm.predict(prompt);

    // Get source files
    const sourcePaths = [...new Set(relevantDocs.map(doc => doc.metadata.filePath))];
    const sources = await this.retrieveFileContents(sourcePaths, userId);

    return {
      answer,
      sources: sources.slice(0, 5), // Top 5 sources
    };
  }

  /**
   * Find similar conversations using LangChain
   */
  async findSimilarContent(
    referenceText: string,
    userId: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    logger.info('Finding similar content using LangChain');

    // Generate embedding for reference text
    const embedding = await this.langchain.generateQueryEmbedding(referenceText);

    // Search by embedding (this would require direct Pinecone access)
    // For now, use similarity search
    const results = await this.langchain.similaritySearchWithScore(
      referenceText,
      limit * 2, // Get more results to filter
      { userId }
    );

    // Filter out the reference itself if it exists
    const filtered = results.filter(([doc, score]) => 
      score < 0.99 // Exclude exact matches
    );

    // Get file contents
    const filePaths = [...new Set(filtered.map(([doc]) => doc.metadata.filePath))];
    const fileContents = await this.retrieveFileContents(filePaths.slice(0, limit), userId);

    return fileContents;
  }

  /**
   * Extract relevant section from content
   */
  private extractRelevantSection(
    fullContent: string,
    matchedChunk: string,
    contextLength: number = 500
  ): string {
    try {
      // For JSON content (conversations)
      const parsed = JSON.parse(fullContent);
      if (parsed.messages) {
        // Find the message that best matches the chunk
        const messages = parsed.messages as any[];
        for (const msg of messages) {
          if (msg.content.includes(matchedChunk.substring(0, 50))) {
            return msg.content;
          }
        }
      }
    } catch {
      // Not JSON, treat as plain text
      const index = fullContent.toLowerCase().indexOf(
        matchedChunk.substring(0, 50).toLowerCase()
      );
      
      if (index !== -1) {
        const start = Math.max(0, index - contextLength / 2);
        const end = Math.min(fullContent.length, index + contextLength / 2);
        return '...' + fullContent.substring(start, end) + '...';
      }
    }

    // Fallback to chunk itself
    return matchedChunk;
  }

  /**
   * Structured search
   */
  private async structuredSearch(
    filters: any,
    userId: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
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
      take: options?.limit || 10,
      skip: options?.offset || 0,
      orderBy: { createdAt: 'desc' },
    });

    // Retrieve contents
    return this.retrieveFileContents(files.map(f => f.filePath), userId);
  }

  /**
   * Retrieve file contents from NAS
   */
  private async retrieveFileContents(
    filePaths: string[],
    userId: string
  ): Promise<SearchResult[]> {
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
            score: 1.0,
          };
        } catch (error) {
          logger.error(`Failed to read file ${filePath}:`, error);
          return null;
        }
      })
    );

    // Filter out failed retrievals and null results
    return results
      .filter((r): r is PromiseFulfilledResult<SearchResult | null> => 
        r.status === 'fulfilled' && r.value !== null
      )
      .map(r => r.value!);
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
}