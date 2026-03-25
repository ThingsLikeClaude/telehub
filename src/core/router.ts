import type { ParsedMessage } from '../telegram/parser.js';
import type { BotConfig } from '../config/schema.js';
import type { RouteResult } from './queue.js';

export interface Router {
  route(parsed: ParsedMessage): RouteResult | null;
}

export function createRouter(_bots: BotConfig[]): Router {
  return {
    route(parsed: ParsedMessage): RouteResult | null {
      switch (parsed.type) {
        case 'keyword':
          return {
            target: parsed.botName,
            text: parsed.text,
            chatId: parsed.chatId,
            messageId: parsed.messageId,
            userId: parsed.userId,
            source: 'keyword',
          };

        case 'reply':
          return {
            target: parsed.botName,
            text: parsed.text,
            chatId: parsed.chatId,
            messageId: parsed.messageId,
            userId: parsed.userId,
            source: 'reply',
          };

        case 'multi':
        case 'broadcast':
        case 'system':
        case 'inline_cmd':
        case 'ignore':
          return null;
      }
    },
  };
}
