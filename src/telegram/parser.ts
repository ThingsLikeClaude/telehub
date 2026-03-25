export interface TelegramMessage {
  chatId: number;
  messageId: number;
  text: string;
  from: { id: number; firstName: string; username?: string };
  replyToMessage?: {
    messageId: number;
    from: { id: number; firstName: string; isBot: boolean; username?: string };
    text?: string;
  };
  date: number;
}

export type SystemCommand = '상태' | '프로젝트' | '전환' | '클리어' | '전체클리어' | '끝';

export type ParsedMessage =
  | { type: 'keyword'; botName: string; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'multi'; botNames: string[]; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'reply'; botName: string; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'broadcast'; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'system'; command: SystemCommand; args: string[]; chatId: number; messageId: number }
  | { type: 'ignore' };

export interface MessageParser {
  parse(msg: TelegramMessage, botUsernames: Map<string, string>): ParsedMessage;
}

const SYSTEM_COMMANDS: ReadonlySet<string> = new Set([
  '상태', '프로젝트', '전환', '클리어', '전체클리어', '끝',
]);

const BROADCAST_KEYWORDS: ReadonlySet<string> = new Set([
  '얘들아', '모두', '전체',
]);

const HONORIFIC_SUFFIXES = /[아야이님씨]$/;

export function createMessageParser(triggerMap: Map<string, string>): MessageParser {
  return {
    parse(msg: TelegramMessage, botUsernames: Map<string, string>): ParsedMessage {
      const text = msg.text;
      if (!text) return { type: 'ignore' };

      const base = { chatId: msg.chatId, messageId: msg.messageId, userId: msg.from.id };

      // # prefix 처리
      if (text.startsWith('#')) {
        const withoutHash = text.slice(1);
        const spaceIdx = withoutHash.indexOf(' ');
        const firstWord = spaceIdx === -1 ? withoutHash : withoutHash.slice(0, spaceIdx);
        const rest = spaceIdx === -1 ? '' : withoutHash.slice(spaceIdx + 1).trim();

        // 시스템 명령 체크
        if (SYSTEM_COMMANDS.has(firstWord)) {
          const args = rest ? rest.split(/\s+/) : [];
          return { type: 'system', command: firstWord as SystemCommand, args, ...base };
        }

        // 브로드캐스트 체크
        if (BROADCAST_KEYWORDS.has(firstWord)) {
          return { type: 'broadcast', text: rest, ...base };
        }

        // 멀티 # 체크: 텍스트 전체에서 #이름 패턴을 모두 찾기
        const allHashes = text.match(/#\S+/g) ?? [];
        if (allHashes.length >= 2) {
          const matched = new Set<string>();
          const usedTokens = new Set<string>();

          for (const hash of allHashes) {
            const word = hash.slice(1); // # 제거
            const botName = matchTrigger(word, triggerMap);
            if (botName) {
              matched.add(botName);
              usedTokens.add(hash);
            }
          }

          if (matched.size >= 2) {
            // # 토큰들을 제거한 나머지가 메시지 본문
            let cleanText = text;
            for (const token of usedTokens) {
              cleanText = cleanText.replace(token, '');
            }
            cleanText = cleanText.replace(/\s+/g, ' ').trim();

            return {
              type: 'multi',
              botNames: [...matched],
              text: cleanText,
              ...base,
            };
          }
        }

        // 단일 트리거 매칭
        const matched = matchTrigger(firstWord, triggerMap);
        if (matched) {
          return { type: 'keyword', botName: matched, text: rest, ...base };
        }

        return { type: 'ignore' };
      }

      // Reply 라우팅
      if (msg.replyToMessage?.from?.isBot && msg.replyToMessage.from.username) {
        const botName = botUsernames.get(msg.replyToMessage.from.username);
        if (botName) {
          return { type: 'reply', botName, text, ...base };
        }
      }

      return { type: 'ignore' };
    },
  };
}

export function matchTrigger(
  word: string,
  triggerMap: Map<string, string>,
): string | null {
  // 직접 매칭
  const direct = triggerMap.get(word);
  if (direct) return direct;

  // 접미사 제거 후 매칭
  const cleaned = word.replace(HONORIFIC_SUFFIXES, '');
  if (cleaned !== word) {
    const afterClean = triggerMap.get(cleaned);
    if (afterClean) return afterClean;
  }

  return null;
}
