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

export type SystemCommand = 'status' | 'project' | 'switch' | 'clear' | 'clearall' | 'stop' | 'session' | 'init' | 'purge' | 'prj-reset' | 'help';

export type InlineCommand = 'clear' | 'session' | 'model';

export type ParsedMessage =
  | { type: 'keyword'; botName: string; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'multi'; botNames: string[]; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'reply'; botName: string; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'broadcast'; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'system'; command: SystemCommand; args: string[]; chatId: number; messageId: number }
  | { type: 'inline_cmd'; botName: string; command: InlineCommand; args: string[]; chatId: number; messageId: number }
  | { type: 'ignore' };

export interface MessageParser {
  parse(msg: TelegramMessage, botUsernames: Map<string, string>): ParsedMessage;
}

const SYSTEM_COMMANDS: ReadonlyMap<string, SystemCommand> = new Map([
  ['status', 'status'],
  ['project', 'project'],
  ['switch', 'switch'],
  ['clear', 'clear'],
  ['clearall', 'clearall'],
  ['stop', 'stop'],
  ['session', 'session'],
  ['init', 'init'],
  ['purge', 'purge'],
  ['prj-reset', 'prj-reset'],
  ['prj_reset', 'prj-reset'],
  ['help', 'help'],
]);

const INLINE_COMMANDS: ReadonlyMap<string, InlineCommand> = new Map([
  ['/clear', 'clear'],
  ['/session', 'session'],
  ['/model', 'model'],
]);

const BROADCAST_KEYWORDS: ReadonlySet<string> = new Set([
  '얘들아', '모두', '전체',
]);

const HONORIFIC_SUFFIXES = /[아야이님씨]$/;

/**
 * ; 을 제거하되 이름/내용은 보존한 텍스트를 반환
 * ";제헌아 해줘" → "제헌아 해줘"
 * ";제헌 ;승주 협업해" → "제헌 승주 협업해"
 */
function stripSemicolons(text: string): string {
  return text.replace(/;/g, '').replace(/\s+/g, ' ').trim();
}

export function createMessageParser(triggerMap: Map<string, string>): MessageParser {
  return {
    parse(msg: TelegramMessage, botUsernames: Map<string, string>): ParsedMessage {
      const text = msg.text;
      if (!text) return { type: 'ignore' };

      const base = { chatId: msg.chatId, messageId: msg.messageId, userId: msg.from.id };

      // / prefix → 시스템 명령
      if (text.startsWith('/')) {
        const withoutSlash = text.slice(1);
        const spaceIdx = withoutSlash.indexOf(' ');
        const firstWord = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).toLowerCase();

        const sysCmd = SYSTEM_COMMANDS.get(firstWord);
        if (sysCmd) {
          const rest = spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1).trim();
          const args = rest ? rest.split(/\s+/) : [];
          return { type: 'system', command: sysCmd, args, ...base };
        }

        // 매칭 안 되는 /는 무시 (Telegram 기본 봇 명령 등)
        return { type: 'ignore' };
      }

      // ; prefix → 봇 호출 / 브로드캐스트
      if (text.startsWith(';')) {
        const withoutSemicolon = text.slice(1);
        const spaceIdx = withoutSemicolon.indexOf(' ');
        const firstWord = spaceIdx === -1 ? withoutSemicolon : withoutSemicolon.slice(0, spaceIdx);

        // 브로드캐스트 체크
        if (BROADCAST_KEYWORDS.has(firstWord)) {
          const rest = spaceIdx === -1 ? '' : withoutSemicolon.slice(spaceIdx + 1).trim();
          return { type: 'broadcast', text: rest, ...base };
        }

        // 멀티 ; 체크: 텍스트 전체에서 ;이름 패턴을 모두 찾기
        const allSemicolons = text.match(/;\S+/g) ?? [];
        if (allSemicolons.length >= 2) {
          const matched = new Set<string>();

          for (const semi of allSemicolons) {
            const word = semi.slice(1);
            const botName = matchTrigger(word, triggerMap);
            if (botName) {
              matched.add(botName);
            }
          }

          if (matched.size >= 2) {
            return {
              type: 'multi',
              botNames: [...matched],
              text: stripSemicolons(text),
              ...base,
            };
          }
        }

        // 단일 트리거 매칭 (prefix 매칭 포함: ;제헌아뭐해 → 제헌 + 뭐해)
        const triggerResult = matchTriggerFull(firstWord, triggerMap);
        if (triggerResult) {
          const restFromTrigger = triggerResult.rest;
          const restFromSpace = spaceIdx === -1 ? '' : withoutSemicolon.slice(spaceIdx + 1).trim();
          const fullText = [restFromTrigger, restFromSpace].filter(Boolean).join(' ');

          // 인라인 명령어 감지: ;제헌 /clear, ;제헌 /session 등
          const firstToken = fullText.split(' ')[0];
          const inlineCmd = INLINE_COMMANDS.get(firstToken);
          if (inlineCmd) {
            const cmdArgs = fullText.split(' ').slice(1);
            return { type: 'inline_cmd', botName: triggerResult.botName, command: inlineCmd, args: cmdArgs, chatId: base.chatId, messageId: base.messageId };
          }

          return { type: 'keyword', botName: triggerResult.botName, text: fullText || stripSemicolons(text), ...base };
        }

        // 매칭 안 되는 ;은 broadcast로 처리 (예: ;너네 지금 뭐해?)
        return { type: 'broadcast', text: stripSemicolons(text), ...base };
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

export interface TriggerMatch {
  botName: string;
  rest: string;  // 트리거 이후 나머지 텍스트
}

export function matchTrigger(
  word: string,
  triggerMap: Map<string, string>,
): string | null {
  const result = matchTriggerFull(word, triggerMap);
  return result?.botName ?? null;
}

export function matchTriggerFull(
  word: string,
  triggerMap: Map<string, string>,
): TriggerMatch | null {
  // 1. 직접 매칭 (정확히 일치)
  const direct = triggerMap.get(word);
  if (direct) return { botName: direct, rest: '' };

  // 2. 접미사 제거 후 매칭
  const cleaned = word.replace(HONORIFIC_SUFFIXES, '');
  if (cleaned !== word) {
    const afterClean = triggerMap.get(cleaned);
    if (afterClean) return { botName: afterClean, rest: '' };
  }

  // 3. Prefix 매칭: "제헌아뭐해" → "제헌" + "아뭐해"
  //    triggerMap 키를 길이 내림차순으로 시도 (긴 것 우선)
  const sortedTriggers = [...triggerMap.keys()].sort((a, b) => b.length - a.length);
  for (const trigger of sortedTriggers) {
    if (word.startsWith(trigger) && word.length > trigger.length) {
      const remainder = word.slice(trigger.length);
      // 접미사(아/야/이/님/씨)로 시작하면 제거
      const cleanRemainder = remainder.replace(/^[아야이님씨]/, '');
      return { botName: triggerMap.get(trigger)!, rest: cleanRemainder };
    }
  }

  return null;
}
