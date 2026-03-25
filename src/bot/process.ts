import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { BotConfig } from '../config/schema.js';
import type { Logger } from '../utils/logger.js';

export interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'system';
  subtype?: string;
  content?: string;
  sessionId?: string;
  costUsd?: number;
}

export interface BotProcess {
  readonly pid: number | null;
  readonly sessionId: string | null;
  readonly isRunning: boolean;
  kill(): Promise<void>;
  onEvent(handler: (event: StreamEvent) => void): void;
  onComplete(handler: (result: { sessionId: string; output: string }) => void): void;
  onError(handler: (error: Error) => void): void;
}

export interface SpawnOptions {
  botConfig: BotConfig;
  projectDir: string;
  sessionId?: string;
  message: string;
  logger: Logger;
}

export function spawnBotProcess(options: SpawnOptions): BotProcess {
  const { botConfig, projectDir, sessionId, message, logger } = options;

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--verbose',
    ...(botConfig.systemPrompt ? ['--append-system-prompt', botConfig.systemPrompt] : []),
    ...(sessionId ? ['--resume', sessionId] : []),
    message,
  ];

  logger.debug('Spawning Claude CLI', { bot: botConfig.name, args: args.join(' ') });

  const workDir = `${projectDir}/${botConfig.workDir}`;
  const child: ChildProcess = spawn('claude', args, {
    cwd: workDir,
    // stdin을 /dev/null로 리다이렉트 (stdin 대기 경고 방지)
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let currentSessionId: string | null = sessionId ?? null;
  let outputBuffer = '';
  let running = true;

  const eventHandlers: Array<(event: StreamEvent) => void> = [];
  const completeHandlers: Array<(result: { sessionId: string; output: string }) => void> = [];
  const errorHandlers: Array<(error: Error) => void> = [];

  // stdout line-by-line 파싱
  if (child.stdout) {
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      logger.debug('Claude CLI stdout raw', { bot: botConfig.name, line: line.slice(0, 300) });

      const event = parseStreamLine(line);
      if (!event) return;

      logger.debug('Parsed stream event', {
        bot: botConfig.name,
        type: event.type,
        subtype: event.subtype,
        hasContent: !!event.content,
        contentLen: event.content?.length,
      });

      // 텍스트 누적
      if (event.content) {
        outputBuffer += event.content;
      }

      // result 이벤트의 result 필드에서 텍스트 추출 (스트리밍이 없었을 때만)
      if (event.type === 'result' && !event.content && outputBuffer.length === 0) {
        const resultText = extractResultText(line);
        if (resultText) {
          outputBuffer = resultText;
          // 핸들러에도 content로 전달
          event.content = resultText;
        }
      }

      // sessionId 추출
      if (event.sessionId) {
        currentSessionId = event.sessionId;
      }

      for (const handler of eventHandlers) {
        try {
          handler(event);
        } catch (err) {
          logger.error('Event handler error', { error: String(err) });
        }
      }
    });
  }

  // stderr → 로그
  if (child.stderr) {
    const rl = createInterface({ input: child.stderr });
    rl.on('line', (line) => {
      logger.debug('Claude CLI stderr', { bot: botConfig.name, line });
    });
  }

  // 프로세스 종료
  child.on('close', (code) => {
    running = false;
    logger.debug('Claude CLI process closed', {
      bot: botConfig.name,
      code,
      outputLen: outputBuffer.length,
      sessionId: currentSessionId,
    });

    if (code === 0) {
      for (const handler of completeHandlers) {
        handler({
          sessionId: currentSessionId ?? '',
          output: outputBuffer,
        });
      }
    } else {
      const err = new Error(`Claude CLI exited with code ${code}`);
      for (const handler of errorHandlers) {
        handler(err);
      }
    }
  });

  child.on('error', (err) => {
    running = false;
    for (const handler of errorHandlers) {
      handler(err);
    }
  });

  return {
    get pid() {
      return child.pid ?? null;
    },
    get sessionId() {
      return currentSessionId;
    },
    get isRunning() {
      return running;
    },
    async kill() {
      if (!running) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      running = false;
    },
    onEvent(handler) {
      eventHandlers.push(handler);
    },
    onComplete(handler) {
      completeHandlers.push(handler);
    },
    onError(handler) {
      errorHandlers.push(handler);
    },
  };
}

/**
 * Claude CLI stream-json 이벤트 파싱
 *
 * 가능한 텍스트 위치:
 * - { type: "assistant", subtype: "text", content_block_delta: { text: "..." } }
 * - { type: "assistant", content: "..." }
 * - { type: "assistant", message: { content: [{ text: "..." }] } }
 * - { type: "result", result: "...", session_id: "..." }
 */
export function parseStreamLine(line: string): StreamEvent | null {
  if (!line.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = parsed.type as StreamEvent['type'];
  if (!type) return null;

  const event: StreamEvent = { type };

  if (parsed.subtype) {
    event.subtype = parsed.subtype as string;
  }

  // sessionId — 여러 위치에서 추출
  if (parsed.session_id) {
    event.sessionId = parsed.session_id as string;
  }

  // costUsd
  if (parsed.cost_usd !== undefined) {
    event.costUsd = parsed.cost_usd as number;
  }

  // 텍스트 추출 — result 이벤트는 제외 (이미 스트리밍으로 누적된 텍스트와 중복)
  if (type !== 'result') {
    const content = extractTextContent(parsed);
    if (content) {
      event.content = content;
    }
  }

  return event;
}

function extractTextContent(parsed: Record<string, unknown>): string | null {
  // Pattern 1: content_block_delta.text
  if (parsed.content_block_delta) {
    const delta = parsed.content_block_delta as Record<string, unknown>;
    if (typeof delta.text === 'string') return delta.text;
  }

  // Pattern 2: direct content field (string)
  if (typeof parsed.content === 'string' && parsed.content.length > 0) {
    return parsed.content;
  }

  // Pattern 3: message.content[].text
  if (parsed.message && typeof parsed.message === 'object') {
    const msg = parsed.message as Record<string, unknown>;
    if (Array.isArray(msg.content)) {
      const texts = (msg.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string);
      if (texts.length > 0) return texts.join('');
    }
  }

  // Pattern 4: result field (string) — 최종 결과
  if (parsed.type === 'result' && typeof parsed.result === 'string') {
    return parsed.result;
  }

  return null;
}

function extractResultText(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.type === 'result' && typeof parsed.result === 'string') {
      return parsed.result.trim();
    }
  } catch {
    // 무시
  }
  return null;
}
