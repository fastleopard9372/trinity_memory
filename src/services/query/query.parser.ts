import { OpenAI } from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { logger } from '../../utils/logger';

// Query intent schema
const QueryIntentSchema = z.object({
  type: z.enum(['semantic', 'structured', 'hybrid']),
  query: z.string().optional(),
  filters: z.object({
    fileType: z.string().optional(),
    tags: z.array(z.string()).optional(),
    dateRange: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }).optional(),
    conversationId: z.string().optional(),
    userId: z.string().optional(),
  }).optional(),
  aggregation: z.enum(['count', 'sum', 'average', 'group_by']).optional(),
  groupBy: z.string().optional(),
});

export type QueryIntent = z.infer<typeof QueryIntentSchema>;

export class QueryParser {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Parse natural language query into structured intent
   */
  async parseQuery(userQuery: string): Promise<QueryIntent> {
    logger.info(`Parsing query: "${userQuery}"`);

    // Try pattern matching first for common queries
    const patternResult = this.parseWithPatterns(userQuery);
    if (patternResult) {
      return patternResult;
    }

    // Use AI for complex queries
    return this.parseWithAI(userQuery);
  }

  /**
   * Parse query using pattern matching
   */
  private parseWithPatterns(query: string): QueryIntent | null {
    const lowerQuery = query.toLowerCase();

    // Date patterns
    const datePatterns = [
      {
        regex: /(?:from|on|at)\s+(\d{4}-\d{2}-\d{2})/i,
        handler: (match: RegExpMatchArray) => ({
          type: 'structured' as const,
          filters: {
            dateRange: {
              start: match[1],
              end: match[1],
            },
          },
        }),
      },
      {
        regex: /last\s+(\d+)\s+(day|week|month)s?/i,
        handler: (match: RegExpMatchArray) => {
          const amount = parseInt(match[1]);
          const unit = match[2];
          const start = this.calculateDateOffset(amount, unit);
          return {
            type: 'structured' as const,
            filters: {
              dateRange: {
                start: start.toISOString(),
                end: new Date().toISOString(),
              },
            },
          };
        },
      },
    ];

    // File type patterns
    const fileTypePatterns = [
      {
        regex: /(?:all|get|show|find)\s+conversations?/i,
        handler: () => ({
          type: 'structured' as const,
          filters: { fileType: 'conversation' },
        }),
      },
      {
        regex: /(?:all|get|show|find)\s+summar(?:y|ies)/i,
        handler: () => ({
          type: 'structured' as const,
          filters: { fileType: 'summary' },
        }),
      },
      {
        regex: /(?:all|get|show|find)\s+proposals?/i,
        handler: () => ({
          type: 'structured' as const,
          filters: { fileType: 'proposal' },
        }),
      },
    ];

    // Tag patterns
    const tagPattern = /tagged?\s+(?:as|with)\s+"([^"]+)"/i;
    const tagMatch = query.match(tagPattern);
    if (tagMatch) {
      return {
        type: 'structured',
        filters: {
          tags: [tagMatch[1]],
        },
      };
    }

    // Semantic search indicators
    const semanticIndicators = [
      'about', 'regarding', 'related to', 'concerning',
      'discuss', 'mention', 'talk about', 'similar to',
    ];

    if (semanticIndicators.some(indicator => lowerQuery.includes(indicator))) {
      return {
        type: 'semantic',
        query: query,
      };
    }

    // Check date patterns
    for (const pattern of datePatterns) {
      const match = query.match(pattern.regex);
      if (match) {
        return pattern.handler(match);
      }
    }

    // Check file type patterns
    for (const pattern of fileTypePatterns) {
      if (pattern.regex.test(query)) {
        return pattern.handler();
      }
    }

    // Check for aggregation queries
    if (lowerQuery.includes('count') || lowerQuery.includes('how many')) {
      return {
        type: 'structured',
        aggregation: 'count',
      };
    }

    return null;
  }

  /**
   * Parse query using AI
   */
  private async parseWithAI(userQuery: string): Promise<QueryIntent> {
    const systemPrompt = `You are a query parser for Trinity AI's memory system.
    Parse the user's natural language query into a structured format.
    
    Determine the query type:
    - semantic: For finding similar content, concepts, or topics
    - structured: For exact filters, dates, counts, specific file types
    - hybrid: For combining semantic search with filters
    
    Extract any filters mentioned:
    - fileType: 'conversation', 'summary', 'proposal', etc.
    - tags: Array of tag names
    - dateRange: Start and end dates in ISO format
    - conversationId: Specific conversation ID if mentioned
    
    Examples:
    - "Find conversations about machine learning" → semantic
    - "Get all conversations from January 15th" → structured with date filter
    - "Show conversations about AI from last week" → hybrid with semantic + date
    - "Count proposals per job category" → structured with aggregation`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuery },
        ],
        functions: [{
          name: 'parse_query',
          description: 'Parse the user query into structured format',
          parameters: zodToJsonSchema(QueryIntentSchema),
        }],
        function_call: { name: 'parse_query' },
        temperature: 0,
      });

      const result = completion.choices[0].message.function_call;
      if (!result) {
        throw new Error('No function call in response');
      }

      const parsed = JSON.parse(result.arguments);
      return QueryIntentSchema.parse(parsed);
    } catch (error) {
      logger.error('AI query parsing failed:', error);
      
      // Fallback to semantic search
      return {
        type: 'semantic',
        query: userQuery,
      };
    }
  }

  /**
   * Calculate date offset
   */
  private calculateDateOffset(amount: number, unit: string): Date {
    const date = new Date();
    
    switch (unit.toLowerCase()) {
      case 'day':
        date.setDate(date.getDate() - amount);
        break;
      case 'week':
        date.setDate(date.getDate() - (amount * 7));
        break;
      case 'month':
        date.setMonth(date.getMonth() - amount);
        break;
    }
    
    return date;
  }

  /**
   * Parse date string flexibly
   */
  parseDateString(dateStr: string): Date | null {
    // Try various date formats
    const formats = [
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
      /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        // Parse based on format
        return new Date(dateStr);
      }
    }

    // Try natural date parsing
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }
}
