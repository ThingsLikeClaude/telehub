import TelegramBot from 'node-telegram-bot-api';
import type { Logger } from '../utils/logger.js';
import { splitMessage } from './formatter.js';

export interface SendOptions {
  replyToMessageId?: number;
  parseMode?: 'Markdown' | 'HTML';
}

/**
 * 개별 봇 토큰으로 메시지를 전송하는 sender.
 * 각 봇이 자기 이름/아이콘으로 Telegram에 메시지를 보낸다.
 */
export interface BotSender {
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<number>;
  sendFile(chatId: number, filePath: string, caption?: string): Promise<number>;
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
  getUsername(): Promise<string>;
}

export function createBotSender(token: string, logger: Logger): BotSender {
  const bot = new TelegramBot(token, { polling: false });
  let cachedUsername: string | null = null;

  return {
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
          logger.error('BotSender sendMessage failed', { error: String(err) });
          throw err;
        }
      }
      return lastMessageId;
    },

    async sendFile(chatId, filePath, caption) {
      const sent = await bot.sendDocument(chatId, filePath, { caption });
      return sent.message_id;
    },

    async editMessage(chatId, messageId, text) {
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
        });
      } catch {
        // edit 실패 무시 (메시지 삭제됐거나 변경 없음)
      }
    },

    async getUsername() {
      if (cachedUsername) return cachedUsername;
      const me = await bot.getMe();
      cachedUsername = me.username ?? '';
      return cachedUsername;
    },
  };
}
