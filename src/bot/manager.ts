import { mkdirSync, existsSync } from 'node:fs';
import type { BotConfig, HubConfig } from '../config/schema.js';
import type { SessionStore } from '../store/session.js';
import type { QueueManager, RouteResult } from '../core/queue.js';
import type { EventBus } from '../core/event-bus.js';
import type { Logger } from '../utils/logger.js';
import type { TelegramAdapter } from '../telegram/adapter.js';
import { spawnBotProcess, type BotProcess, type StreamEvent } from './process.js';
import { createHandoffDetector, type HandoffDetector } from './handoff.js';

export interface BotState {
  name: string;
  config: BotConfig;
  status: 'idle' | 'busy' | 'error' | 'starting';
  currentTask?: string;
  process: BotProcess | null;
}

export interface BotManager {
  getBot(name: string): BotState | undefined;
  getAllBots(): ReadonlyArray<BotState>;
  dispatch(route: RouteResult): Promise<void>;
  clearSession(botName: string): Promise<void>;
  clearAllSessions(): Promise<void>;
  switchProject(projectName: string): Promise<void>;
  getCurrentProject(): string;
  shutdown(): Promise<void>;
}

export interface BotManagerDeps {
  config: HubConfig;
  sessionStore: SessionStore;
  queueManager: QueueManager;
  eventBus: EventBus;
  logger?: Logger;
  telegram?: TelegramAdapter;
  triggerMap?: Map<string, string>;
}

const EDIT_DEBOUNCE_MS = 300;

export function createBotManager(deps: BotManagerDeps): BotManager {
  const { config, sessionStore, queueManager, eventBus } = deps;
  const logger = deps.logger;
  const telegram = deps.telegram;
  let currentProject = config.projects.default;

  const handoffDetector: HandoffDetector | null = deps.triggerMap
    ? createHandoffDetector(deps.triggerMap)
    : null;

  const botStates: Map<string, BotState> = new Map(
    config.bots.map((botConfig) => [
      botConfig.name,
      {
        name: botConfig.name,
        config: botConfig,
        status: 'idle' as const,
        currentTask: undefined,
        process: null,
      },
    ]),
  );

  function setBotStatus(
    name: string,
    status: BotState['status'],
    currentTask?: string,
  ): void {
    const state = botStates.get(name);
    if (state) {
      botStates.set(name, { ...state, status, currentTask });
    }
  }

  async function processNext(botName: string): Promise<void> {
    const next = queueManager.dequeue(botName);
    if (next) {
      await manager.dispatch(next);
    }
  }

  const manager: BotManager = {
    getBot(name) {
      return botStates.get(name);
    },

    getAllBots() {
      return [...botStates.values()];
    },

    async dispatch(route: RouteResult) {
      const state = botStates.get(route.target);
      if (!state) {
        logger?.warn('Unknown bot target', { target: route.target });
        return;
      }

      // 바쁘면 대기열에 추가
      if (state.status === 'busy') {
        const pos = queueManager.enqueue(route.target, route);
        if (pos === -1) {
          telegram?.sendMessage(route.chatId, `⚠️ ${route.target} 대기열이 가득 찼습니다.`);
        } else {
          telegram?.sendMessage(
            route.chatId,
            `⏳ ${route.target} 작업 중 — 대기열에 추가됨 (${pos}번째)`,
          );
          eventBus.emit({ type: 'queue:enqueued', bot: route.target, position: pos });
        }
        return;
      }

      // 봇 실행
      setBotStatus(route.target, 'busy', route.text.slice(0, 50));

      const projectDir = `${config.projects.baseDir}/${currentProject}`;
      const workDir = `${projectDir}/${state.config.workDir}`;
      if (!existsSync(workDir)) {
        mkdirSync(workDir, { recursive: true });
      }

      const existingSessionId = sessionStore.get(currentProject, route.target) ?? undefined;

      let proc: BotProcess;
      try {
        proc = spawnBotProcess({
          botConfig: state.config,
          projectDir,
          sessionId: existingSessionId,
          message: route.text,
          logger: logger ?? { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
        });
      } catch (err) {
        setBotStatus(route.target, 'error');
        logger?.error('Failed to spawn bot process', {
          bot: route.target,
          error: String(err),
        });
        telegram?.sendMessage(route.chatId, `❌ ${route.target} 실행 실패`);
        return;
      }

      botStates.set(route.target, { ...state, status: 'busy', process: proc });

      // Telegram 실시간 업데이트 (300ms debounce editMessage)
      let telegramMsgId: number | null = null;
      let textBuffer = '';
      let editTimer: ReturnType<typeof setTimeout> | null = null;

      const flushEdit = async () => {
        if (!telegram || !telegramMsgId || !textBuffer) return;
        const displayText = `${state.config.color} **${state.name}**:\n${textBuffer}`;
        try {
          await telegram.editMessage(route.chatId, telegramMsgId, displayText);
        } catch {
          // edit 실패 무시
        }
      };

      proc.onEvent((event: StreamEvent) => {
        if (event.type === 'assistant' && event.content) {
          textBuffer += event.content;

          if (telegram) {
            // 첫 텍스트: 새 메시지 생성
            if (!telegramMsgId) {
              const prefix = `${state.config.color} **${state.name}**:\n`;
              telegram.sendMessage(route.chatId, prefix + textBuffer, {
                replyToMessageId: route.messageId,
              }).then((msgId) => {
                telegramMsgId = msgId;
              });
            } else {
              // 이후: debounce editMessage
              if (editTimer) clearTimeout(editTimer);
              editTimer = setTimeout(flushEdit, EDIT_DEBOUNCE_MS);
            }
          }
        }
      });

      proc.onComplete(async (result) => {
        // 마지막 편집 flush
        if (editTimer) clearTimeout(editTimer);
        await flushEdit();

        // Fallback: 스트리밍 중 메시지를 못 보냈으면 최종 출력 전송
        if (!telegramMsgId && result.output && telegram) {
          logger?.info('Sending fallback response (no stream events captured)', { bot: route.target });
          const prefix = `${state.config.color} **${state.name}**:\n`;
          await telegram.sendMessage(route.chatId, prefix + result.output, {
            replyToMessageId: route.messageId,
          });
        }

        // 세션 저장
        if (result.sessionId) {
          sessionStore.set(currentProject, route.target, result.sessionId);
        }

        setBotStatus(route.target, 'idle');
        botStates.set(route.target, {
          ...botStates.get(route.target)!,
          process: null,
        });

        eventBus.emit({
          type: 'bot:complete',
          bot: route.target,
          output: result.output,
          sessionId: result.sessionId,
        });

        logger?.info('Bot completed', { bot: route.target, sessionId: result.sessionId });

        // 핸드오프 감지
        if (handoffDetector) {
          const handoff = handoffDetector.detect(route.target, result.output);
          if (handoff) {
            eventBus.emit({ type: 'bot:handoff', ...handoff });
            telegram?.sendMessage(
              route.chatId,
              `🔄 ${handoff.from} → ${handoff.to}: 핸드오프`,
            );
            await manager.dispatch({
              target: handoff.to,
              text: handoff.task,
              chatId: route.chatId,
              messageId: route.messageId,
              userId: route.userId,
              source: 'keyword',
            });
          }
        }

        // 대기열 처리
        await processNext(route.target);
      });

      proc.onError(async (error) => {
        if (editTimer) clearTimeout(editTimer);

        // --resume 실패 시 세션 삭제 후 재시도
        if (existingSessionId && error.message.includes('resume')) {
          logger?.warn('Resume failed, retrying with new session', { bot: route.target });
          sessionStore.delete(currentProject, route.target);
          setBotStatus(route.target, 'idle');
          await manager.dispatch(route);
          return;
        }

        setBotStatus(route.target, 'error');
        botStates.set(route.target, {
          ...botStates.get(route.target)!,
          process: null,
        });

        eventBus.emit({ type: 'bot:error', bot: route.target, error: error.message });
        logger?.error('Bot error', { bot: route.target, error: error.message });
        telegram?.sendMessage(route.chatId, `❌ ${route.target} 오류: ${error.message}`);

        // 대기열 처리
        await processNext(route.target);
      });
    },

    async clearSession(botName) {
      const state = botStates.get(botName);
      if (state?.process) {
        await state.process.kill();
      }
      sessionStore.delete(currentProject, botName);
      setBotStatus(botName, 'idle');
      botStates.set(botName, { ...botStates.get(botName)!, process: null });
    },

    async clearAllSessions() {
      for (const [name, state] of botStates) {
        if (state.process) await state.process.kill();
        botStates.set(name, { ...state, status: 'idle', currentTask: undefined, process: null });
      }
      sessionStore.deleteAll(currentProject);
      queueManager.clearAll();
    },

    async switchProject(projectName) {
      for (const [name, state] of botStates) {
        if (state.process) await state.process.kill();
        botStates.set(name, { ...state, status: 'idle', currentTask: undefined, process: null });
      }
      currentProject = projectName;
    },

    getCurrentProject() {
      return currentProject;
    },

    async shutdown() {
      for (const [, state] of botStates) {
        if (state.process) await state.process.kill();
      }
      queueManager.clearAll();
    },
  };

  return manager;
}
