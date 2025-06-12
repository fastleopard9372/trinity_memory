import { PrismaClient } from '@prisma/client';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import { createHash } from 'crypto';
import * as path from 'path';
import { NASService } from '../nas/nas.service';
import { logger } from '../../utils/logger';
import { id } from 'zod/dist/types/v4/locales';

export interface FileMetadata {
  checksum: string;
  size: number;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  metadata: Record<string, any>;
  conversationId?: string;
}

export class FileIndexer {
  private prisma: PrismaClient;
  private nas: NASService;
  private pinecone: PineconeClient;
  private embeddings: OpenAIEmbeddings;

  constructor(
    prisma: PrismaClient,
    nas: NASService,
    pinecone: PineconeClient
  ) {
    this.prisma = prisma;
    this.nas = nas;
    this.pinecone = pinecone;
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Index a file - store path in database and embeddings in Pinecone
   */
  async indexFile(
    filePath: string,
    userId: string,
    conversationId?: string
  ): Promise<void> {
    logger.info(`Indexing file: ${filePath}`);

    try {
      // 1. Read file content from NAS
      const content = await this.nas.readFile(filePath);
      const stats = await this.nas.getFileStats(filePath);

      // 2. Extract metadata
      const fileMetadata = await this.extractFileMetadata(filePath, content);
      fileMetadata.conversationId = conversationId;

      // 3. Generate embeddings for content chunks
      const chunks = this.chunkContent(content);
      const vectorIds = await this.indexChunks(
        chunks,
        filePath,
        userId,
        fileMetadata
      );

      // 4. Store file registry in PostgreSQL
      await this.prisma.nasFile.upsert({
        where: {
          userId_filePath: {
            userId,
            filePath,
          },
        },
        update: {
          fileSize: BigInt(stats.size),
          checksum: fileMetadata.checksum,
          title: fileMetadata.title,
          summary: fileMetadata.summary,
          tags: fileMetadata.tags,
          metadata: fileMetadata.metadata,
          vectorIds,
          modifiedAt: new Date(),
          indexedAt: new Date(),
        },
        create: {
          userId,
          filePath,
          fileName: path.basename(filePath),
          folderPath: path.dirname(filePath),
          fileType: fileMetadata.type,
          fileSize: BigInt(stats.size),
          checksum: fileMetadata.checksum,
          title: fileMetadata.title,
          summary: fileMetadata.summary,
          tags: fileMetadata.tags,
          metadata: fileMetadata.metadata,
          conversationId,
          vectorIds,
          indexedAt: new Date(),
        },
      });

      logger.info(`Successfully indexed ${chunks.length} chunks for ${filePath}`);
    } catch (error) {
      logger.error(`Failed to index file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Extract metadata from file content
   */
  private async extractFileMetadata(
    filePath: string,
    content: string
  ): Promise<FileMetadata> {
    const checksum = createHash('sha256').update(content).digest('hex');
    const fileType = this.detectFileType(filePath, content);

    let metadata: FileMetadata = {
      checksum,
      size: content.length,
      type: fileType,
      title: '',
      summary: '',
      tags: [],
      metadata: {},
    };

    switch (fileType) {
      case 'conversation':
        metadata = await this.parseConversationFile(content, metadata);
        break;
      case 'summary':
        metadata = await this.parseSummaryFile(content, metadata);
        break;
      case 'proposal':
        metadata = await this.parseProposalFile(content, metadata);
        break;
      default:
        metadata.title = path.basename(filePath);
        metadata.summary = content.substring(0, 200) + '...';
    }

    return metadata;
  }

  /**
   * Detect file type based on path and content
   */
  private detectFileType(filePath: string, content: string): string {
    // Check by path
    if (filePath.includes('/conversations/')) return 'conversation';
    if (filePath.includes('/summaries/')) return 'summary';
    if (filePath.includes('/proposals/')) return 'proposal';
    if (filePath.includes('/agents/')) return 'agent';

    // Check by content structure
    try {
      const json = JSON.parse(content);
      if (json.messages && Array.isArray(json.messages)) return 'conversation';
      if (json.proposal || json.content) return 'proposal';
    } catch {
      // Not JSON
    }

    // Check by extension
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.json': return 'json';
      case '.md': return 'markdown';
      case '.txt': return 'text';
      default: return 'unknown';
    }
  }

  /**
   * Parse conversation JSON file
   */
  private async parseConversationFile(
    content: string,
    metadata: FileMetadata
  ): Promise<FileMetadata> {
    try {
      const data = JSON.parse(content);
      
      metadata.title = `Conversation from ${new Date(data.timestamp).toLocaleDateString()}`;
      metadata.summary = await this.generateSummary(data.messages);
      metadata.tags = data.tags || [];
      metadata.metadata = {
        messageCount: data.messages?.length || 0,
        userId: data.userId,
        timestamp: data.timestamp,
      };

      return metadata;
    } catch (error) {
      logger.error('Failed to parse conversation file:', error);
      return metadata;
    }
  }

  /**
   * Parse summary markdown file
   */
  private async parseSummaryFile(
    content: string,
    metadata: FileMetadata
  ): Promise<FileMetadata> {
    // Extract title from first line if it's a heading
    const lines = content.split('\n');
    const firstLine = lines[0];
    
    if (firstLine.startsWith('#')) {
      metadata.title = firstLine.replace(/^#+\s*/, '');
    } else {
      metadata.title = 'Summary';
    }

    metadata.summary = content.substring(0, 200);
    metadata.tags = ['summary'];
    
    return metadata;
  }

  /**
   * Parse proposal file
   */
  private async parseProposalFile(
    content: string,
    metadata: FileMetadata
  ): Promise<FileMetadata> {
    try {
      const data = JSON.parse(content);
      
      metadata.title = data.title || 'Proposal';
      metadata.summary = data.summary || content.substring(0, 200);
      metadata.tags = ['proposal', ...(data.tags || [])];
      metadata.metadata = {
        jobId: data.jobId,
        status: data.status,
      };

      return metadata;
    } catch {
      // Handle non-JSON proposals
      metadata.title = 'Proposal';
      metadata.summary = content.substring(0, 200);
      metadata.tags = ['proposal'];
      return metadata;
    }
  }

  /**
   * Generate AI summary of content
   */
  private async generateSummary(messages: any[]): Promise<string> {
    if (!messages || messages.length === 0) {
      return 'Empty conversation';
    }

    // Create a brief summary from messages
    const preview = messages
      .slice(0, 5)
      .map(m => `${m.role}: ${m.content.substring(0, 50)}...`)
      .join(' ');

    // In production, use OpenAI to generate better summaries
    return `Conversation with ${messages.length} messages. Preview: ${preview}`;
  }

  /**
   * Chunk content for embedding
   */
  private chunkContent(
    content: string,
    maxChunkSize: number = 1000
  ): string[] {
    const chunks: string[] = [];
    const sentences = content.split(/[.!?]+/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Index chunks in Pinecone
   */
  private async indexChunks(
    chunks: string[],
    filePath: string,
    userId: string,
    metadata: FileMetadata
  ): Promise<string[]> {
    const index = await this.pinecone.index('trinity-memory');
    const vectorIds: string[] = [];

    // Generate embeddings for all chunks
    const embeddings = await this.embeddings.embedDocuments(chunks);

    // Prepare vectors for upsert
    const vectors = chunks.map((chunk, i) => {
      const vectorId = `${metadata.checksum}_chunk_${i}`;
      vectorIds.push(vectorId);

      return {
        id: vectorId,
        values: embeddings[i],
        metadata: JSON.parse(JSON.stringify({
            filePath,
            userId,
            fileType: metadata.type,
            chunkIndex: i,
            chunkCount: chunks.length,
            preview: chunk.substring(0, 200),
            timestamp: Date.now(),
            conversationId: metadata.conversationId,
            tags: metadata.tags,
          })),
      };
    });

    // Batch upsert to Pinecone
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert(batch);
    }

    return vectorIds;
  }

  /**
   * Remove file from index
   */
  async removeFileFromIndex(filePath: string, userId: string): Promise<void> {
    // Get file record
    const file = await this.prisma.nasFile.findFirst({
      where: { filePath, userId },
    });

    if (!file) {
      return;
    }

    // Delete vectors from Pinecone
    if (file.vectorIds.length > 0) {
    const index = await this.pinecone.index('trinity-memory');
        await index.deleteMany(file.vectorIds);
    }

    // Delete from database
    await this.prisma.nasFile.delete({
      where: { id: file.id },
    });

    logger.info(`Removed file from index: ${filePath}`);
  }
}