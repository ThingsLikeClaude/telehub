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

export type SystemCommand = '상태' | '프로젝트' | '전환' | '클리어' | '전체클리어' | '끝' | '세션';

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
  '상태', '프로젝트', '전환', '클리어', '전체클리어', '끝', '세션',
]);

const BROADCAST_KEYWORDS: ReadonlySet<string> = new Set([
  '얘들아', '모두', '전체',
]);

const HONORIFIC_SUFFIXES = /[아야이님씨]$/;

/**
 * # 을 제거하되 이름/내용은 보존한 텍스트를 반환
 * "#제헌아 해줘" → "제헌아 해줘"
 * "#제헌 #승주 협업해" → "제헌 승주 협업해"
 */
function stripHashes(text: string): string {
  return text.replace(/#/g, '').replace(/\s+/g, ' ').trim();
}

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

        // 시스템 명령 체크
        if (SYSTEM_COMMANDS.has(firstWord)) {
          const rest = spaceIdx === -1 ? '' : withoutHash.slice(spaceIdx + 1).trim();
          const args = rest ? rest.split(/\s+/) : [];
          return { type: 'system', command: firstWord as SystemCommand, args, ...base };
        }

        // 브로드캐스트 체크
        if (BROADCAST_KEYWORDS.has(firstWord)) {
          const rest = spaceIdx === -1 ? '' : withoutHash.slice(spaceIdx + 1).trim();
          return { type: 'broadcast', text: rest, ...base };
        }

        // 멀티 # 체크: 텍스트 전체에서 #이름 패턴을 모두 찾기
        const allHashes = text.match(/#\S+/g) ?? [];
        if (allHashes.length >= 2) {
          const matched = new Set<string>();

          for (const hash of allHashes) {
            const word = hash.slice(1);
            const botName = matchTrigger(word, triggerMap);
            if (botName) {
              matched.add(botName);
            }
          }

          if (matched.size >= 2) {
            return {
              type: 'multi',
              botNames: [...matched],
              text: stripHashes(text),
              ...base,
            };
          }
        }

        // 단일 트리거 매칭
        const matched = matchTrigger(firstWord, triggerMap);
        if (matched) {
          // #만 제거, 이름 포함한 전체 텍스트 전달
          return { type: 'keyword', botName: matched, text: stripHashes(text), ...base };
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

      // @mention 라우팅 (예: @jehun_res_bot 조사해줘)
      const mentions = text.match(/@(\S+)/g);
      if (mentions) {
        const mentionedBots: string[] = [];
        for (const mention of mentions) {
          const username = mention.slice(1); // @ 제거
          const botName = botUsernames.get(username);
          if (botName) mentionedBots.push(botName);
        }

        if (mentionedBots.length > 0) {
          const cleanText = text.replace(/@\S+/g, '').replace(/\s+/g, ' ').trim();
          if (mentionedBots.length === 1) {
            return { type: 'keyword', botName: mentionedBots[0], text: cleanText || text, ...base };
          }
          return {
            type: 'multi',
            botNames: [...new Set(mentionedBots)],
            text: cleanText || text,
            ...base,
          };
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
