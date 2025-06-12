import { config } from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from '@langchain/pinecone';
import { Document } from "@langchain/core/documents";



import { ChatOpenAI } from 'langchain/chat_models/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SqlDatabase } from 'langchain/sql_db';
import { SqlDatabaseChain } from 'langchain/chains/sql_db';
import { PromptTemplate } from 'langchain/prompts';
import { logger } from '../../utils/logger';

export class LangChainService {
  private llm: ChatOpenAI;
  private sqlChain?: SqlDatabaseChain;

  constructor() {
    this.llm = new ChatOpenAI({
      temperature: 0,
      modelName: 'gpt-4',
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Initialize SQL chain for complex queries
   */
  async initializeSQLChain(databaseUrl: string) {
    try {
      const db = await SqlDatabase.fromDataSourceParams({
        appDataSource: {
          type: 'postgres',
          database: databaseUrl,
        },
      });

      this.sqlChain = new SqlDatabaseChain({
        llm: this.llm,
        database: db,
        topK: 5,
        inputKey: 'question',
        outputKey: 'result',
      });

      logger.info('SQL chain initialized');
    } catch (error) {
      logger.error('Failed to initialize SQL chain:', error);
    }
  }

  /**
   * Generate SQL query from natural language
   */
  async generateSQL(question: string): Promise<string> {
    if (!this.sqlChain) {
      throw new Error('SQL chain not initialized');
    }

    const result = await this.sqlChain.call({
      question,
    });

    return result.result;
  }

  /**
   * Analyze conversation for insights
   */
  async analyzeConversation(messages: any[]): Promise<{
    summary: string;
    topics: string[];
    sentiment: string;
    keyPoints: string[];
  }> {
    const prompt = PromptTemplate.fromTemplate(`
      Analyze the following conversation and provide:
      1. A brief summary
      2. Main topics discussed
      3. Overall sentiment
      4. Key points or decisions made

      Conversation:
      {conversation}

      Format the response as JSON.
    `);

    const chain = prompt.pipe(this.llm);
    
    const result = await chain.invoke({
      conversation: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
    });

    try {
      return JSON.parse(result.content as string);
    } catch {
      return {
        summary: result.content as string,
        topics: [],
        sentiment: 'neutral',
        keyPoints: [],
      };
    }
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    return embeddings.embedDocuments(texts);
  }
}