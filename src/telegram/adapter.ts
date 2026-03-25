import TelegramBot from 'node-telegram-bot-api';
import type { Logger } from '../utils/logger.js';
import { splitMessage } from './formatter.js';

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

export interface SendOptions {
  replyToMessageId?: number;
  parseMode?: 'Markdown' | 'HTML';
}

export interface TelegramAdapter {
  start(): void;
  stop(): Promise<void>;
  registerCommands(): Promise<void>;
  onMessage(handler: (msg: TelegramMessage) => void): void;
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<number>;
  sendFile(chatId: number, filePath: string, caption?: string): Promise<number>;
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
}

export function createTelegramAdapter(
  token: string,
  groupChatId: string,
  logger: Logger,
): TelegramAdapter {
  const bot = new TelegramBot(token, { polling: false });
  const handlers: Array<(msg: TelegramMessage) => void> = [];

  function normalize(raw: TelegramBot.Message): TelegramMessage | null {
    if (String(raw.chat.id) !== groupChatId) return null;
    if (!raw.text) return null;

    return {
      chatId: raw.chat.id,
      messageId: raw.message_id,
      text: raw.text,
      from: {
        id: raw.from?.id ?? 0,
        firstName: raw.from?.first_name ?? 'Unknown',
        username: raw.from?.username,
      },
      replyToMessage: raw.reply_to_message
        ? {
            messageId: raw.reply_to_message.message_id,
            from: {
              id: raw.reply_to_message.from?.id ?? 0,
              firstName: raw.reply_to_message.from?.first_name ?? 'Unknown',
              isBot: raw.reply_to_message.from?.is_bot ?? false,
              username: raw.reply_to_message.from?.username,
            },
            text: raw.reply_to_message.text,
          }
        : undefined,
      date: raw.date,
    };
  }

  return {
    start() {
      bot.startPolling();
      bot.on('message', (raw) => {
        logger.debug('Raw Telegram message', {
          chatId: raw.chat.id,
          text: raw.text?.slice(0, 50),
          hasReplyTo: !!raw.reply_to_message,
          replyToFrom: raw.reply_to_message?.from?.username,
          replyToIsBot: raw.reply_to_message?.from?.is_bot,
          replyToMsgId: raw.reply_to_message?.message_id,
        });
        const msg = normalize(raw);
        if (!msg) return;
        for (const handler of handlers) {
          try {
            handler(msg);
          } catch (err) {
            logger.error('Message handler error', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      });
      logger.info('Telegram polling started', { groupChatId });
    },

    async stop() {
      await bot.stopPolling();
      logger.info('Telegram polling stopped');
    },

    async registerCommands() {
      try {
        await bot.setMyCommands([
          { command: 'help', description: '명령어 목록' },
          { command: 'status', description: '봇 상태 대시보드' },
          { command: 'project', description: '현재 프로젝트 정보' },
          { command: 'switch', description: '프로젝트 전환 (/switch 이름)' },
          { command: 'init', description: '봇 초기화 (템플릿 복사)' },
          { command: 'prj_reset', description: '프로젝트 리셋 (삭제 후 재생성)' },
          { command: 'session', description: '세션 정보' },
          { command: 'clear', description: '봇 세션 초기화 (/clear 이름)' },
          { command: 'clearall', description: '전체 세션 초기화' },
          { command: 'purge', description: '채팅 메시지 삭제' },
          { command: 'stop', description: '활성 작업 종료' },
        ]);
        logger.info('Telegram commands registered');
      } catch (err) {
        logger.warn('Failed to register commands', { error: String(err) });
      }
    },

    onMessage(handler) {
      handlers.push(handler);
    },

    async sendMessage(chatId, text, options) {
      const parts = splitMessage(text);
      let lastMessageId = 0;
      for (const part of parts) {
        try {
          const sent = await bot.sendMessage(chatId, part, {
            reply_to_message_id: options?.replyToMessageId,
            parse_mode: options?.parseMode,
          });
          lastMessageId = sent.message_id;
        } catch (err) {
          if (options?.replyToMessageId && String(err).includes('replied')) {
            const sent = await bot.sendMessage(chatId, part, {
              parse_mode: options?.parseMode,
            });
            lastMessageId = sent.message_id;
          } else {
            logger.error('sendMessage failed', { error: String(err) });
          }
        }
      }
      return lastMessageId;
    },

    async sendFile(chatId, filePath, caption) {
      const sent = await bot.sendDocument(chatId, filePath, {
        caption,
      });
      return sent.message_id;
    },

    async editMessage(chatId, messageId, text) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch (err) {
        logger.warn('Edit message failed (may be deleted)', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async deleteMessage(chatId, messageId) {
      try {
        await bot.deleteMessage(chatId, messageId);
      } catch (err) {
        logger.warn('Delete message failed', {
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
