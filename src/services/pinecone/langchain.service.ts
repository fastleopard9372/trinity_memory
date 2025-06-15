import { ChatOpenAI } from 'langchain/chat_models/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { PromptTemplate } from 'langchain/prompts';
import { LLMChain } from 'langchain/chains';
import { Document } from 'langchain/document';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { logger } from '../../utils/logger';
import { SearchResult } from '../search/search.service';

export interface ConversationAnalysis {
  summary?: string;
  action?: string,
  type?:string,
  fileType?: string;
  tags: string[];
  dateRange?: string[];
  conversationId?: string;
}

export class LangChainService {
  private llm: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;
  private pineconeStore: PineconeStore;
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor(pineconeStore: PineconeStore) {
    this.pineconeStore = pineconeStore;
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
    
      Determine the query action:
      - normal: This is when there is no action
      - store: when there is a similar phrase to save, store, remember or so on in storage or nas,
      - delete: when there is a delete phrase to delete, clear, remove or so on from storage or nas,
      - search: when there is a previous conversation to search or anaylze
      - read: when there is a phrase to read, get, show or so on from storage or nas

      Determine the query type:
      - semantic: For finding similar content, concepts, or topics
      - structured: For exact filters, dates, counts, specific file types
      - hybrid: For combining semantic search with filters
      
      Provide the analysis in the following JSON format:
      {{
        "summary": "A brief 2-3 sentence summary of the conversation",
        "action": 'normal',
        "type":'semantic',
        "fileType": 'conversation', 'summary', 'proposal', etc,
        "tags": Array of tag names,
        "dateRange": [Start, End] for ISOFormat(like 2025-06-12T15:23:00.000Z, The date must be in ISO format.),
        "conversationId": Specific conversation ID if mentioned
      }}
      
      Examples:
      - "Save in storage" → normal
      - "Find conversations about machine learning" → semantic
      - "Get all conversations from January 15th" → structured with date filter
      - "Show conversations about AI from last week" → hybrid with semantic + date
      - "Count proposals per job category" → structured with aggregation
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
      logger.info("analysis:",result);
      const analysis = JSON.parse(result.text);
      return analysis;
    } catch (error) {
      logger.error('Failed to analyze conversation:', error);
      
      // Return default analysis on error
      return {
        summary: 'Unable to generate summary',
        action:'none',
        type: 'none',
        tags:['none']
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
  async searchPrompt(
    question: string,
    messageLog: SearchResult[]
  ): Promise<any> {
    const message = JSON.stringify(messageLog)
  .replace(/{/g, '{{')
  .replace(/}/g, '}}');
    const questionPrompt = PromptTemplate.fromTemplate(`
      You are a helpful memory assistant.      
      The user asked:
      "${question}"

      Below are the user's messages from your request, including notes about their content,summary, tags, timestamps and so on:

      ${message}

      Based on these messages, provide a coherent explanation, summary, or insight that connects their thoughts. Highlight any patterns or themes you observe.
      If relevant, suggest what the user might reflect on or explore further.`);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: questionPrompt,
    });

    try {
      const result = await chain.call({ question, messageLog });
      
      logger.info("search result", result)
      return result.text;
    } catch (error) {
      logger.error('Failed to generate follow-up questions:', error);
      return '';
    }
  }

  async savePrompt(): Promise<any> {
    const questionPrompt = PromptTemplate.fromTemplate(`
      The user has just shared something they want you to remember.

      Do not say anything else.
      Your only response should be like this:
      I saved it in memory.
      `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: questionPrompt,
    });

    try {
      const result = await chain.call({});
      
      logger.info("search result", result)
      return result.text;
    } catch (error) {
      logger.error('Failed to generate follow-up questions:', error);
      return '';
    }
  }
  /**
   * Generate general questions
   */
  async generalPrompt(
    question: string,
    messageLog: SearchResult[]
  ): Promise<any> {
    const message = JSON.stringify(messageLog)
  .replace(/{/g, '{{')
  .replace(/}/g, '}}');
    const questionPrompt = PromptTemplate.fromTemplate(`
      You are a helpful and emotionally intelligent assistant with memory recall.

      The user asked:
      "${question}"

      Below are messages retrieved from the user's memory over recent days. Each message includes context like date, tags, and emotional tone where available.

      ${message}

      ---

      🔍 Your task:
      1. Understand what the user is asking or reflecting on (e.g., emotions, health, goals, decisions, recurring thoughts).
      2. Carefully read the past messages and identify anything relevant to their question.
      3. Highlight key themes, patterns, emotional shifts, or decisions that relate to the question.
      4. If relevant, provide thoughtful reflections or suggestions the user may find helpful.

      Use a gentle, clear, and human tone in your answer. Do not list messages back to the user — summarize and explain what they reveal in context.
      `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: questionPrompt,
    });

    try {
      const result = await chain.call({ question, messageLog });
      
      logger.info("search result", result)
      return result.text;
    } catch (error) {
      logger.error('Failed to generate follow-up questions:', error);
      return '';
    }
  }

  /**
   * Generate follow-up questions
   */
  async generateFollowUpQuestions(
    conversation: string,
    count: number = 3
  ): Promise<any> {
    const questionPrompt = PromptTemplate.fromTemplate(`
      You are a smart assistant with memory and creativity.
      Below is the full recent conversation history:
      -----------------------------
      ${conversation}
      
      -----------------------------

      🔍 Instructions:

      1. **Understand the User's Intent**  
      Carefully analyze the user's most recent input and the overall conversation. Decide whether it is:
        - a **command to save data** (e.g., "Save this", "Remember this", "Add this to memory")
        - a **question about past data** (e.g., "What did I say about...", "Remind me what I did...")
        - or a **general conversation** (chat, thoughts, opinions, jokes, ideas)

      2. **Respond Accordingly**  
      Depending on what you detect:

      👉 If it's a **save command**:  
      Respond by confirming that the data was saved successfully. Acknowledge key information and offer to retrieve it later.

      👉 If it's a **data search or recall request**:  
      Find the most relevant matching messages or memory entries and present them in a clear, user-friendly format. Explain patterns, emotional context, or insights as needed.

      👉 If it's a **general message or casual thought**:  
      Continue the conversation in a meaningful, imaginative, and fun way. Use the full context to keep it personal and engaging.

      🎯 Your goal is to be helpful, thoughtful, and conversational — not robotic. Keep your tone natural, friendly, and intuitive.
      `);

    const chain = new LLMChain({
      llm: this.llm,
      prompt: questionPrompt,
    });

    try {
      const result = await chain.call({ conversation });
      
      logger.info("followUpQuestions", result)
      return result.text;
    } catch (error) {
      logger.error('Failed to generate follow-up questions:', error);
      return '';
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