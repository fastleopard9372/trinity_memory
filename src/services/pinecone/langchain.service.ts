import { ChatOpenAI } from 'langchain/chat_models/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { LLMChain } from 'langchain/chains';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { logger } from '../../utils/logger';

export interface ConversationAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  keyPoints: string[];
  actionItems: string[];
}

export class LangChainService {
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;
  private pineconeStore?: PineconeStore;
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    this.llm = new ChatOpenAI({
      temperature: 0,
      modelName: 'gpt-4',
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
  }

  /**
   * Initialize Pinecone vector store
   */
  async initializePineconeStore(pineconeClient: PineconeClient, indexName: string) {
    try {
      const pineconeIndex = pineconeClient.Index(indexName);
      
      this.pineconeStore = await PineconeStore.fromExistingIndex(
        this.embeddings,
        { pineconeIndex }
      );

      logger.info('Pinecone store initialized with LangChain');
    } catch (error) {
      logger.error('Failed to initialize Pinecone store:', error);
      throw error;
    }
  }

  /**
   * Create conversational retrieval chain for Q&A
   */
  async createConversationalChain(userId: string) {
    if (!this.pineconeStore) {
      throw new Error('Pinecone store not initialized');
    }

    const qaPrompt = PromptTemplate.fromTemplate(`
      Use the following pieces of context to answer the question at the end.
      If you don't know the answer, just say that you don't know, don't try to make up an answer.
      Always cite the source of your information by mentioning the conversation ID or date when possible.

      Context: {context}

      Question: {question}

      Helpful Answer:`
    );

    // Create retriever with user filter
    const retriever = this.pineconeStore.asRetriever({
      filter: { userId },
      k: 5,
    });

    return { retriever, qaPrompt, llm: this.llm };
  }

  /**
   * Generate embeddings for text chunks
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      return await this.embeddings.embedDocuments(texts);
    } catch (error) {
      logger.error('Failed to generate embeddings:', error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single query
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    try {
      return await this.embeddings.embedQuery(query);
    } catch (error) {
      logger.error('Failed to generate query embedding:', error);
      throw error;
    }
  }

  /**
   * Split text into chunks for embedding
   */
  async splitText(text: string): Promise<string[]> {
    const docs = await this.textSplitter.splitText(text);
    return docs;
  }

  /**
   * Create documents for Pinecone storage
   */
  async createDocuments(
    texts: string[],
    metadatas: Record<string, any>[]
  ): Promise<Document[]> {
    return texts.map((text, index) => new Document({
      pageContent: text,
      metadata: metadatas[index] || {},
    }));
  }

  /**
   * Add documents to Pinecone
   */
  async addDocumentsToPinecone(
    documents: Document[],
    namespace?: string
  ): Promise<void> {
    if (!this.pineconeStore) {
      throw new Error('Pinecone store not initialized');
    }

    try {
      await this.pineconeStore.addDocuments(documents, { namespace });
      logger.info(`Added ${documents.length} documents to Pinecone`);
    } catch (error) {
      logger.error('Failed to add documents to Pinecone:', error);
      throw error;
    }
  }

  /**
   * Search similar documents in Pinecone
   */
  async similaritySearch(
    query: string,
    k: number = 10,
    filter?: Record<string, any>
  ): Promise<Document[]> {
    if (!this.pineconeStore) {
      throw new Error('Pinecone store not initialized');
    }

    try {
      return await this.pineconeStore.similaritySearch(query, k, filter);
    } catch (error) {
      logger.error('Failed to perform similarity search:', error);
      throw error;
    }
  }

  /**
   * Search with relevance scores
   */
  async similaritySearchWithScore(
    query: string,
    k: number = 5,
    filter?: Record<string, any>
  ): Promise<[Document, number][]> {
    if (!this.pineconeStore) {
      throw new Error('Pinecone store not initialized');
    }

    try {
      return await this.pineconeStore.similaritySearchWithScore(query, k, filter);
    } catch (error) {
      logger.error('Failed to perform similarity search with score:', error);
      throw error;
    }
  }

  /**
   * Analyze conversation for insights
   */
  async analyzeConversation(messages: any[]): Promise<ConversationAnalysis> {
    const analysisPrompt = PromptTemplate.fromTemplate(`
      Analyze the following conversation and provide a structured analysis.
      
      Conversation:
      {conversation}
      
      Provide the analysis in the following JSON format:
      {{
        "summary": "A brief 2-3 sentence summary of the conversation",
        "topics": ["main", "topics", "discussed"],
        "sentiment": "positive/negative/neutral/mixed",
        "keyPoints": ["important", "points", "or", "decisions"],
        "actionItems": ["any", "tasks", "or", "follow-ups", "mentioned", "store", "read"]
      }}
    `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: analysisPrompt,
    });

    try {
      const conversationText = messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const result = await chain.call({
        conversation: conversationText,
      });

      const analysis = JSON.parse(result.text);
      return analysis;
    } catch (error) {
      logger.error('Failed to analyze conversation:', error);
      
      // Return default analysis on error
      return {
        summary: 'Unable to generate summary',
        topics: [],
        sentiment: 'neutral',
        keyPoints: [],
        actionItems: [],
      };
    }
  }

  /**
   * Generate smart summary with key insights
   */
  async generateSmartSummary(
    conversationId: string,
    messages: any[]
  ): Promise<string> {
    const summaryPrompt = PromptTemplate.fromTemplate(`
      Create a comprehensive summary of this conversation that includes:
      1. Main discussion points
      2. Key decisions made
      3. Action items or next steps
      4. Important insights or learnings
      
      Conversation:
      {conversation}
      
      Format the summary in markdown with clear sections.
    `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: summaryPrompt,
    });

    try {
      const conversationText = messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n\n');

      const result = await chain.call({
        conversation: conversationText,
      });

      return result.text;
    } catch (error) {
      logger.error('Failed to generate smart summary:', error);
      throw error;
    }
  }

  /**
   * Extract entities from text
   */
  async extractEntities(text: string): Promise<{
    people: string[];
    organizations: string[];
    locations: string[];
    dates: string[];
    topics: string[];
  }> {
    const extractionPrompt = PromptTemplate.fromTemplate(`
      Extract the following entities from the text:
      - People names
      - Organization names
      - Locations
      - Dates mentioned
      - Main topics
      
      Text: {text}
      
      Return the results in JSON format:
      {{
        "people": [],
        "organizations": [],
        "locations": [],
        "dates": [],
        "topics": []
      }}
    `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: extractionPrompt,
    });

    try {
      const result = await chain.call({ text });
      return JSON.parse(result.text);
    } catch (error) {
      logger.error('Failed to extract entities:', error);
      return {
        people: [],
        organizations: [],
        locations: [],
        dates: [],
        topics: [],
      };
    }
  }

  /**
   * Generate follow-up questions
   */
  async generateFollowUpQuestions(
    conversation: string,
    count: number = 3
  ): Promise<string[]> {
    const questionPrompt = PromptTemplate.fromTemplate(`
      Based on this conversation, generate ${count} thoughtful follow-up questions
      that would help deepen the discussion or clarify important points.
      
      Conversation:
      {conversation}
      
      Return only the questions as a JSON array of strings.
    `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: questionPrompt,
    });

    try {
      const result = await chain.call({ conversation });
      return JSON.parse(result.text);
    } catch (error) {
      logger.error('Failed to generate follow-up questions:', error);
      return [];
    }
  }

  /**
   * Classify conversation intent
   */
  async classifyConversationIntent(messages: any[]): Promise<{
    primaryIntent: string;
    secondaryIntents: string[];
    confidence: number;
  }> {
    const classificationPrompt = PromptTemplate.fromTemplate(`
      Classify the primary intent and any secondary intents of this conversation.
      
      Common intents include:
      - question_answering
      - brainstorming
      - problem_solving
      - learning
      - planning
      - analysis
      - creative_writing
      - coding_help
      - general_discussion
      
      Conversation:
      {conversation}
      
      Return JSON:
      {{
        "primaryIntent": "main_intent",
        "secondaryIntents": ["other", "intents"],
        "confidence": 0.95
      }}
    `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: classificationPrompt,
    });

    try {
      const conversationText = messages
        .slice(0, 10) // Use first 10 messages for classification
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const result = await chain.call({ conversation: conversationText });
      return JSON.parse(result.text);
    } catch (error) {
      logger.error('Failed to classify conversation intent:', error);
      return {
        primaryIntent: 'general_discussion',
        secondaryIntents: [],
        confidence: 0.5,
      };
    }
  }
}