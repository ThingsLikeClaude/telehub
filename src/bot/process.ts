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

  const workDir = `${projectDir}/${botConfig.workDir}`;
  const child: ChildProcess = spawn('claude', args, {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
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
      logger.debug('Claude CLI stdout raw', { bot: botConfig.name, line: line.slice(0, 200) });

      const event = parseStreamLine(line);
      if (!event) return;

      logger.debug('Parsed stream event', { bot: botConfig.name, type: event.type, subtype: event.subtype, hasContent: !!event.content });

      // 텍스트 누적
      if (event.type === 'assistant' && event.content) {
        outputBuffer += event.content;
      }

      // sessionId 추출
      if (event.type === 'result' && event.sessionId) {
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

  // assistant text content
  if (type === 'assistant' && parsed.content_block_delta) {
    const delta = parsed.content_block_delta as Record<string, unknown>;
    event.content = delta.text as string;
  }

  // result event
  if (type === 'result') {
    if (parsed.session_id) event.sessionId = parsed.session_id as string;
    if (parsed.cost_usd !== undefined) event.costUsd = parsed.cost_usd as number;
  }

  return event;
}
