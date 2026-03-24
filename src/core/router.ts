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

        case 'broadcast':
          // broadcast는 별도 classifyBroadcast 호출 필요
          // 동기 route에서는 null 반환, 상위에서 비동기 분류 수행
          return null;

        case 'system':
        case 'ignore':
          return null;
      }
    },
  };
}
