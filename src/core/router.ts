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

        case 'multi':
        case 'broadcast':
        case 'system':
        case 'ignore':
          return null;
      }
    },

    async routeBroadcast(parsed) {
      const allRoutes = bots.map((b) => ({
        target: b.name,
        text: parsed.text,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        userId: parsed.userId,
        source: 'broadcast' as const,
      }));

      // 인사/일반 메시지 → 전원에게
      if (isGeneralMessage(parsed.text)) {
        logger?.info('Broadcast: general message, routing to all bots');
        return allRoutes;
      }

      // 전문 영역 메시지 → Claude로 분류
      const botNames = bots.map((b) => `${b.name}(${b.role})`).join(', ');
      const prompt = [
        '다음 메시지를 처리할 봇을 선택하세요.',
        `봇 목록: ${botNames}`,
        `메시지: "${parsed.text}"`,
        '',
        '규칙:',
        '- 특정 역할에 해당하면 해당 봇 이름만 출력',
        '- 여러 역할이 필요하면 쉼표로 구분 (예: 김제헌, 김용훈)',
        '- 모든 봇이 답해야 하면 "전체" 출력',
        '',
        '응답: 봇 이름만',
      ].join('\n');

      try {
        const result = await runClaudeOnce(prompt);
        logger?.debug('Broadcast classification result', { result });

        if (result.includes('전체') || result.includes('모두')) {
          return allRoutes;
        }

        const targets = bots
          .filter((b) => result.includes(b.name))
          .map((b) => b.name);

        if (targets.length === 0) {
          logger?.warn('Broadcast classification failed, routing to all', { result });
          return allRoutes;
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
        logger?.error('Broadcast classification error, routing to all', { error: String(err) });
        return allRoutes;
      }
    },
  };
}

function runClaudeOnce(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      prompt,
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

const GENERAL_PATTERNS = /^(안녕|ㅎㅇ|하이|뭐해|모해|뭐하|잘자|굿모닝|좋은아침|수고|고생|ㅋㅋ|ㅎㅎ|ㄱㄱ|hi|hello|hey|yo|sup)/i;

function isGeneralMessage(text: string): boolean {
  return GENERAL_PATTERNS.test(text.trim());
}
