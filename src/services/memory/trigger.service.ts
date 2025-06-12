import { PrismaClient, MemoryRule } from '@prisma/client';
import { Message } from './memory.service';
import { logger } from '../../utils/logger';

export interface TriggerAction {
  type: string;
  params: Record<string, any>;
}

export class TriggerService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Evaluate triggers for a conversation
   */
  async evaluateTriggers(
    conversationId: string,
    messages: Message[],
    userId: string
  ): Promise<TriggerAction[]> {
    const rules = await this.prisma.memoryRule.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    const triggeredActions: TriggerAction[] = [];

    for (const rule of rules) {
      if (await this.evaluateRule(rule, messages, conversationId)) {
        const actions = this.parseActions(rule.actions as any);
        triggeredActions.push(...actions);

        // Log trigger
        await this.prisma.memoryTrigger.create({
          data: {
            triggerType: rule.ruleType,
            conversationId,
            details: {
              ruleId: rule.id,
              conditions: rule.conditions,
              actions: rule.actions,
            },
          },
        });
      }
    }

    return triggeredActions;
  }

  /**
   * Evaluate a single rule
   */
  private async evaluateRule(
    rule: MemoryRule,
    messages: Message[],
    conversationId: string
  ): Promise<boolean> {
    const conditions = rule.conditions as any;

    switch (rule.ruleType) {
      case 'length':
        return this.evaluateLengthRule(conditions, messages);
      
      case 'keyword':
        return this.evaluateKeywordRule(conditions, messages);
      
      case 'time':
        return await this.evaluateTimeRule(conditions, conversationId, rule.userId);
      
      default:
        logger.warn(`Unknown rule type: ${rule.ruleType}`);
        return false;
    }
  }

  /**
   * Evaluate length-based rule
   */
  private evaluateLengthRule(
    conditions: { minMessages?: number; maxMessages?: number },
    messages: Message[]
  ): boolean {
    const messageCount = messages.length;

    if (conditions.minMessages && messageCount < conditions.minMessages) {
      return false;
    }

    if (conditions.maxMessages && messageCount > conditions.maxMessages) {
      return false;
    }

    return true;
  }

  /**
   * Evaluate keyword-based rule
   */
  private evaluateKeywordRule(
    conditions: { keywords: string[]; matchType?: 'any' | 'all' },
    messages: Message[]
  ): boolean {
    const content = messages.map(m => m.content.toLowerCase()).join(' ');
    const keywords = conditions.keywords.map(k => k.toLowerCase());
    const matchType = conditions.matchType || 'any';

    if (matchType === 'any') {
      return keywords.some(keyword => content.includes(keyword));
    } else {
      return keywords.every(keyword => content.includes(keyword));
    }
  }

  /**
   * Evaluate time-based rule
   */
  private async evaluateTimeRule(
    conditions: { 
      interval?: string; 
      specificTime?: string;
      daysOfWeek?: number[];
    },
    conversationId: string,
    userId: string
  ): Promise<boolean> {
    if (conditions.interval) {
      // Check if enough time has passed since last trigger
      const lastTrigger = await this.prisma.memoryTrigger.findFirst({
        where: {
          conversation: { userId },
          triggerType: 'time',
        },
        orderBy: { triggeredAt: 'desc' },
      });

      if (lastTrigger) {
        const intervalMs = this.parseInterval(conditions.interval);
        const timeSinceLastTrigger = Date.now() - lastTrigger.triggeredAt.getTime();
        
        if (timeSinceLastTrigger < intervalMs) {
          return false;
        }
      }
    }

    if (conditions.daysOfWeek) {
      const today = new Date().getDay();
      if (!conditions.daysOfWeek.includes(today)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse interval string to milliseconds
   */
  private parseInterval(interval: string): number {
    const units = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };

    const match = interval.match(/^(\d+)([smhdw])$/);
    if (!match) {
      throw new Error(`Invalid interval format: ${interval}`);
    }

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit as keyof typeof units];
  }

  /**
   * Parse actions from rule
   */
  private parseActions(actions: Record<string, any>): TriggerAction[] {
    const triggerActions: TriggerAction[] = [];

    if (actions.generateSummary) {
      triggerActions.push({
        type: 'generate_summary',
        params: { style: actions.summaryStyle || 'brief' },
      });
    }

    if (actions.backup) {
      triggerActions.push({
        type: 'backup',
        params: { destination: actions.backupDestination || 'gdrive' },
      });
    }

    if (actions.notify) {
      triggerActions.push({
        type: 'notify',
        params: { 
          method: actions.notifyMethod || 'email',
          message: actions.notifyMessage,
        },
      });
    }

    if (actions.export) {
      triggerActions.push({
        type: 'export',
        params: { 
          format: actions.exportFormat || 'json',
          destination: actions.exportDestination,
        },
      });
    }

    if (actions.tag) {
      triggerActions.push({
        type: 'tag',
        params: { tags: actions.tags || [] },
      });
    }

    return triggerActions;
  }

  /**
   * Execute trigger actions
   */
  async executeTriggerActions(
    actions: TriggerAction[],
    conversationId: string,
    userId: string
  ): Promise<void> {
    for (const action of actions) {
      try {
        logger.info(`Executing trigger action: ${action.type}`, action.params);
        
        switch (action.type) {
          case 'generate_summary':
            // This would be handled by the memory service
            break;
          
          case 'backup':
            // This would trigger a backup workflow
            break;
          
          case 'notify':
            // This would send a notification
            break;
          
          case 'export':
            // This would export the conversation
            break;
          
          case 'tag':
            // This would add tags to the conversation
            break;
          
          default:
            logger.warn(`Unknown action type: ${action.type}`);
        }
      } catch (error) {
        logger.error(`Failed to execute action ${action.type}:`, error);
      }
    }
  }

  /**
   * Create default rules for new user
   */
  async createDefaultRules(userId: string): Promise<void> {
    const defaultRules = [
      {
        userId,
        ruleType: 'length',
        conditions: { minMessages: 10 },
        actions: { 
          generateSummary: true,
          summaryStyle: 'detailed',
        },
        isActive: true,
      },
      {
        userId,
        ruleType: 'keyword',
        conditions: { 
          keywords: ['important', 'remember', 'todo', 'action item'],
          matchType: 'any',
        },
        actions: { 
          tag: true,
          tags: ['important'],
          notify: true,
          notifyMethod: 'email',
        },
        isActive: true,
      },
      {
        userId,
        ruleType: 'time',
        conditions: { 
          interval: '1d',
          daysOfWeek: [1, 2, 3, 4, 5], // Weekdays
        },
        actions: { 
          backup: true,
          backupDestination: 'nas',
        },
        isActive: true,
      },
    ];

    await this.prisma.memoryRule.createMany({
      data: defaultRules,
      skipDuplicates: true,
    });

    logger.info(`Created default memory rules for user ${userId}`);
  }
}