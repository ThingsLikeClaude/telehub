import { describe, it, expect } from 'vitest';
import { createRouter } from './router.js';
import type { ParsedMessage } from '../telegram/parser.js';
import type { BotConfig } from '../config/schema.js';

const bots: BotConfig[] = [
  { name: '김제헌', role: '리서치', triggers: ['제헌'], systemPrompt: '', workDir: 'research', color: '🔬' },
  { name: '김용훈', role: '개발', triggers: ['용훈'], systemPrompt: '', workDir: 'dev', color: '💻' },
];

describe('Router', () => {
  const router = createRouter(bots);

  it('should route keyword message', () => {
    const msg: ParsedMessage = {
      type: 'keyword',
      botName: '김제헌',
      text: '조사해줘',
      chatId: -100,
      messageId: 1,
      userId: 111,
    };
    const result = router.route(msg);
    expect(result).toEqual({
      target: '김제헌',
      text: '조사해줘',
      chatId: -100,
      messageId: 1,
      userId: 111,
      source: 'keyword',
    });
  });

  it('should route reply message', () => {
    const msg: ParsedMessage = {
      type: 'reply',
      botName: '김용훈',
      text: '이거 수정해',
      chatId: -100,
      messageId: 2,
      userId: 111,
    };
    const result = router.route(msg);
    expect(result).toEqual(expect.objectContaining({
      target: '김용훈',
      source: 'reply',
    }));
  });

  it('should return null for system commands', () => {
    const msg: ParsedMessage = {
      type: 'system',
      command: '상태',
      args: [],
      chatId: -100,
      messageId: 3,
    };
    expect(router.route(msg)).toBeNull();
  });

  it('should return null for ignore', () => {
    expect(router.route({ type: 'ignore' })).toBeNull();
  });

  it('should route broadcast with target from classifier', () => {
    const msg: ParsedMessage = {
      type: 'broadcast',
      text: '경쟁사 분석하자',
      chatId: -100,
      messageId: 4,
      userId: 111,
    };
    // broadcast는 routeBroadcast를 통해 처리 — 여기서는 기본 동작 확인
    const result = router.route(msg);
    // broadcast는 별도 classifyBroadcast 필요 — route에서는 null 반환
    expect(result).toBeNull();
  });
});
