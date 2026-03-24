import { spawn } from 'node:child_process';
import type { ParsedMessage } from '../telegram/parser.js';
import type { BotConfig } from '../config/schema.js';
import type { RouteResult } from './queue.js';
import type { Logger } from '../utils/logger.js';

export interface Router {
  route(parsed: ParsedMessage): RouteResult | null;
  routeBroadcast(parsed: Extract<ParsedMessage, { type: 'broadcast' }>): Promise<RouteResult[]>;
}

export function createRouter(bots: BotConfig[], logger?: Logger): Router {
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
        case 'system':
        case 'ignore':
          return null;
      }
    },

    async routeBroadcast(parsed) {
      const botNames = bots.map((b) => `${b.name}(${b.role})`).join(', ');
      const prompt = `다음 메시지를 가장 적절한 봇에게 배분하세요.\n봇 목록: ${botNames}\n메시지: "${parsed.text}"\n응답: 봇 이름만 (예: "${bots[0].name}")`;

      try {
        const result = await runClaudeOnce(prompt);
        const targets = bots
          .filter((b) => result.includes(b.name))
          .map((b) => b.name);

        if (targets.length === 0) {
          // 분류 실패 → 첫 번째 봇에게 fallback
          logger?.warn('Broadcast classification failed, using fallback', { result });
          return [{
            target: bots[0].name,
            text: parsed.text,
            chatId: parsed.chatId,
            messageId: parsed.messageId,
            userId: parsed.userId,
            source: 'broadcast' as const,
          }];
        }

        return targets.map((target) => ({
          target,
          text: parsed.text,
          chatId: parsed.chatId,
          messageId: parsed.messageId,
          userId: parsed.userId,
          source: 'broadcast' as const,
        }));
      } catch (err) {
        logger?.error('Broadcast classification error', { error: String(err) });
        return [{
          target: bots[0].name,
          text: parsed.text,
          chatId: parsed.chatId,
          messageId: parsed.messageId,
          userId: parsed.userId,
          source: 'broadcast' as const,
        }];
      }
    },
  };
}

function runClaudeOnce(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--prompt', prompt,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Claude CLI exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
