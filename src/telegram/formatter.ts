import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelegramAdapter } from './adapter.js';

export interface ResponseFormatter {
  send(
    chatId: number,
    botName: string,
    botColor: string,
    text: string,
    replyTo?: number,
  ): Promise<void>;
}

export function createResponseFormatter(
  adapter: TelegramAdapter,
  longResponseThreshold: number,
): ResponseFormatter {
  return {
    async send(chatId, botName, botColor, text, replyTo) {
      const prefix = `${botColor} **${botName}**:\n`;

      if (text.length <= longResponseThreshold) {
        await adapter.sendMessage(chatId, prefix + text, {
          replyToMessageId: replyTo,
        });
      } else {
        // 긴 응답 → .md 파일 전송
        const fileName = `${botName}-${Date.now()}.md`;
        const filePath = join(tmpdir(), `telehub-${fileName}`);
        writeFileSync(filePath, text);
        await adapter.sendFile(chatId, filePath, `${botName}의 응답 (파일로 전환됨)`);
        // 10초 후 삭제
        setTimeout(() => {
          try {
            unlinkSync(filePath);
          } catch {
            // 삭제 실패 무시
          }
        }, 10_000);
      }
    },
  };
}

export function splitMessage(text: string, maxLength: number = 4096): string[] {
  if (text.length <= maxLength) return [text];

  // 접미사 "(XX/XX)\n" 최대 길이 예약 (10자)
  const reservedForSuffix = 10;
  const effectiveMax = maxLength - reservedForSuffix;

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= effectiveMax) {
      parts.push(remaining);
      break;
    }

    const chunk = remaining.slice(0, effectiveMax);
    const splitIdx = findSplitPoint(chunk);
    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }

  if (parts.length > 1) {
    return parts.map((part, i) => `${part}\n(${i + 1}/${parts.length})`);
  }

  return parts;
}

function findSplitPoint(chunk: string): number {
  // 우선순위: \n\n > \n > 공백 > 강제 절단
  const doubleNewline = chunk.lastIndexOf('\n\n');
  if (doubleNewline > chunk.length * 0.5) return doubleNewline;

  const newline = chunk.lastIndexOf('\n');
  if (newline > chunk.length * 0.5) return newline;

  const space = chunk.lastIndexOf(' ');
  if (space > chunk.length * 0.5) return space;

  return chunk.length;
}
