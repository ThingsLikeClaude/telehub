import { describe, it, expect } from 'vitest';
import { createMessageParser, type TelegramMessage, type ParsedMessage } from './parser.js';

const triggerMap = new Map([
  ['제헌', '김제헌'],
  ['ㅈㅎ', '김제헌'],
  ['리서치', '김제헌'],
  ['용훈', '김용훈'],
  ['ㅇㅎ', '김용훈'],
  ['개발', '김용훈'],
  ['승훈', '김승훈'],
  ['마케팅', '김승훈'],
  ['승주', '김승주'],
  ['비서', '김승주'],
]);

const botUsernames = new Map([
  ['jeheon_bot', '김제헌'],
  ['yonghun_bot', '김용훈'],
]);

function makeMsg(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    chatId: -100123,
    messageId: 1,
    text: '',
    from: { id: 111, firstName: 'User' },
    date: Date.now(),
    ...overrides,
  };
}

describe('MessageParser', () => {
  const parser = createMessageParser(triggerMap);

  describe('keyword routing', () => {
    it('should parse #제헌 trigger', () => {
      const result = parser.parse(makeMsg({ text: '#제헌 조사해줘' }), botUsernames);
      expect(result).toEqual(expect.objectContaining({
        type: 'keyword',
        botName: '김제헌',
        text: '조사해줘',
      }));
    });

    it('should parse #ㅈㅎ trigger (초성)', () => {
      const result = parser.parse(makeMsg({ text: '#ㅈㅎ 뭐 좀 찾아줘' }), botUsernames);
      expect(result.type).toBe('keyword');
      if (result.type === 'keyword') {
        expect(result.botName).toBe('김제헌');
        expect(result.text).toBe('뭐 좀 찾아줘');
      }
    });

    it('should handle 호칭 접미사 (#제헌아)', () => {
      const result = parser.parse(makeMsg({ text: '#제헌아 이거 해줘' }), botUsernames);
      expect(result.type).toBe('keyword');
      if (result.type === 'keyword') {
        expect(result.botName).toBe('김제헌');
        expect(result.text).toBe('이거 해줘');
      }
    });

    it('should handle 호칭 접미사 (#용훈이)', () => {
      const result = parser.parse(makeMsg({ text: '#용훈이 코드 짜줘' }), botUsernames);
      expect(result.type).toBe('keyword');
      if (result.type === 'keyword') {
        expect(result.botName).toBe('김용훈');
      }
    });

    it('should handle 호칭 접미사 (#승주님)', () => {
      const result = parser.parse(makeMsg({ text: '#승주님 일정 정리해줘' }), botUsernames);
      expect(result.type).toBe('keyword');
      if (result.type === 'keyword') {
        expect(result.botName).toBe('김승주');
      }
    });

    it('should ignore unknown trigger', () => {
      const result = parser.parse(makeMsg({ text: '#모르는봇 해줘' }), botUsernames);
      expect(result.type).toBe('ignore');
    });
  });

  describe('system commands', () => {
    it('should parse #상태', () => {
      const result = parser.parse(makeMsg({ text: '#상태' }), botUsernames);
      expect(result).toEqual(expect.objectContaining({
        type: 'system',
        command: '상태',
      }));
    });

    it('should parse #전환 with args', () => {
      const result = parser.parse(makeMsg({ text: '#전환 new-project' }), botUsernames);
      expect(result.type).toBe('system');
      if (result.type === 'system') {
        expect(result.command).toBe('전환');
        expect(result.args).toEqual(['new-project']);
      }
    });

    it('should parse #클리어', () => {
      const result = parser.parse(makeMsg({ text: '#클리어' }), botUsernames);
      expect(result.type).toBe('system');
      if (result.type === 'system') {
        expect(result.command).toBe('클리어');
      }
    });

    it('should parse #전체클리어', () => {
      const result = parser.parse(makeMsg({ text: '#전체클리어' }), botUsernames);
      expect(result.type).toBe('system');
      if (result.type === 'system') {
        expect(result.command).toBe('전체클리어');
      }
    });

    it('should parse #끝', () => {
      const result = parser.parse(makeMsg({ text: '#끝' }), botUsernames);
      expect(result.type).toBe('system');
      if (result.type === 'system') {
        expect(result.command).toBe('끝');
      }
    });

    it('should parse #프로젝트', () => {
      const result = parser.parse(makeMsg({ text: '#프로젝트' }), botUsernames);
      expect(result.type).toBe('system');
      if (result.type === 'system') {
        expect(result.command).toBe('프로젝트');
      }
    });
  });

  describe('broadcast', () => {
    it('should parse #얘들아', () => {
      const result = parser.parse(makeMsg({ text: '#얘들아 경쟁사 분석하자' }), botUsernames);
      expect(result.type).toBe('broadcast');
      if (result.type === 'broadcast') {
        expect(result.text).toBe('경쟁사 분석하자');
      }
    });

    it('should parse #모두', () => {
      const result = parser.parse(makeMsg({ text: '#모두 회의 시작' }), botUsernames);
      expect(result.type).toBe('broadcast');
    });

    it('should parse #전체', () => {
      const result = parser.parse(makeMsg({ text: '#전체 보고해' }), botUsernames);
      expect(result.type).toBe('broadcast');
    });
  });

  describe('multi # routing', () => {
    it('should parse #제헌 #용훈 as multi', () => {
      const result = parser.parse(makeMsg({ text: '#제헌 #용훈 둘이서 협업해' }), botUsernames);
      expect(result.type).toBe('multi');
      if (result.type === 'multi') {
        expect(result.botNames).toContain('김제헌');
        expect(result.botNames).toContain('김용훈');
        expect(result.botNames).toHaveLength(2);
        expect(result.text).toBe('둘이서 협업해');
      }
    });

    it('should parse #제헌아 #승주야 with honorifics', () => {
      const result = parser.parse(makeMsg({ text: '#제헌아 #승주야 너네 둘끼리 해' }), botUsernames);
      expect(result.type).toBe('multi');
      if (result.type === 'multi') {
        expect(result.botNames).toContain('김제헌');
        expect(result.botNames).toContain('김승주');
        expect(result.text).toBe('너네 둘끼리 해');
      }
    });

    it('should parse 3 bots', () => {
      const result = parser.parse(makeMsg({ text: '#제헌 #용훈 #승훈 다같이 하자' }), botUsernames);
      expect(result.type).toBe('multi');
      if (result.type === 'multi') {
        expect(result.botNames).toHaveLength(3);
      }
    });

    it('should fall back to single keyword when only 1 # matches', () => {
      const result = parser.parse(makeMsg({ text: '#제헌아 승주한테 물어봐' }), botUsernames);
      expect(result.type).toBe('keyword');
      if (result.type === 'keyword') {
        expect(result.botName).toBe('김제헌');
      }
    });
  });

  describe('reply routing', () => {
    it('should route reply to bot message', () => {
      const msg = makeMsg({
        text: '더 자세히 알아봐',
        replyToMessage: {
          messageId: 99,
          from: { id: 222, firstName: 'jeheon_bot', isBot: true, username: 'jeheon_bot' },
          text: '이전 응답',
        },
      });
      const result = parser.parse(msg, botUsernames);
      expect(result.type).toBe('reply');
      if (result.type === 'reply') {
        expect(result.botName).toBe('김제헌');
        expect(result.text).toBe('더 자세히 알아봐');
      }
    });

    it('should ignore reply to non-bot message', () => {
      const msg = makeMsg({
        text: '이건 사람한테',
        replyToMessage: {
          messageId: 99,
          from: { id: 333, firstName: 'Human', isBot: false },
          text: '사람 메시지',
        },
      });
      const result = parser.parse(msg, botUsernames);
      expect(result.type).toBe('ignore');
    });

    it('should ignore reply to unknown bot', () => {
      const msg = makeMsg({
        text: '누구?',
        replyToMessage: {
          messageId: 99,
          from: { id: 444, firstName: 'unknown_bot', isBot: true, username: 'unknown_bot' },
        },
      });
      const result = parser.parse(msg, botUsernames);
      expect(result.type).toBe('ignore');
    });
  });

  describe('edge cases', () => {
    it('should ignore empty text', () => {
      const result = parser.parse(makeMsg({ text: '' }), botUsernames);
      expect(result.type).toBe('ignore');
    });

    it('should ignore undefined text', () => {
      const result = parser.parse(makeMsg({ text: undefined as unknown as string }), botUsernames);
      expect(result.type).toBe('ignore');
    });

    it('should ignore plain message without #', () => {
      const result = parser.parse(makeMsg({ text: '그냥 대화' }), botUsernames);
      expect(result.type).toBe('ignore');
    });

    it('should preserve chatId and messageId', () => {
      const result = parser.parse(
        makeMsg({ text: '#제헌 테스트', chatId: -999, messageId: 42 }),
        botUsernames,
      );
      if (result.type === 'keyword') {
        expect(result.chatId).toBe(-999);
        expect(result.messageId).toBe(42);
      }
    });
  });
});
