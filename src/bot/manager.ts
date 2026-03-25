import { mkdirSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import type { BotConfig, HubConfig } from '../config/schema.js';
import type { SessionStore } from '../store/session.js';
import type { QueueManager, RouteResult } from '../core/queue.js';
import type { EventBus } from '../core/event-bus.js';
import type { Logger } from '../utils/logger.js';
import type { TelegramAdapter } from '../telegram/adapter.js';
import { createBotSender, type BotSender } from '../telegram/bot-sender.js';
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
  initBots(): { created: string[]; skipped: string[] };
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
  healthMonitor?: { startMonitoring(bot: string): void; stopMonitoring(bot: string): void; recordActivity(bot: string): void };
}

const EDIT_DEBOUNCE_MS = 300;

export function createBotManager(deps: BotManagerDeps): BotManager {
  const { config, sessionStore, queueManager, eventBus } = deps;
  const logger = deps.logger;
  const telegram = deps.telegram;
  const healthMonitor = deps.healthMonitor;
  let currentProject = config.projects.default;

  const handoffDetector: HandoffDetector | null = deps.triggerMap
    ? createHandoffDetector(deps.triggerMap)
    : null;

  // 봇별 개별 sender (토큰이 있는 봇만)
  const botSenders: Map<string, BotSender> = new Map();
  for (const botConfig of config.bots) {
    if (botConfig.token && logger) {
      botSenders.set(botConfig.name, createBotSender(botConfig.token, logger));
    }
  }

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

      // 빈 메시지 방지
      if (!route.text || !route.text.trim()) {
        logger?.warn('Empty message, skipping dispatch', { bot: route.target });
        return;
      }

      // 에러 상태 자동 복구
      if (state.status === 'error') {
        setBotStatus(route.target, 'idle');
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

      // 발신용 sender 결정: 개별 토큰 > Hub telegram fallback
      const sender = botSenders.get(route.target) ?? telegram;

      // 봇 실행 — "생각하는 중" 메시지 (점 애니메이션)
      setBotStatus(route.target, 'busy', route.text.slice(0, 50));
      let thinkingMsgId: number | null = null;
      let dotCount = 1;

      if (sender) {
        try {
          thinkingMsgId = await sender.sendMessage(route.chatId, '생각하는 중 .');
        } catch {
          // thinking 메시지 실패해도 진행
        }
      }

      // 프로젝트별 봇 디렉토리 (cwd로 사용)
      const projectBaseDir = `${config.projects.baseDir}/${currentProject}`;
      const projectBotDir = join(projectBaseDir, 'bots', state.config.workDir);

      // 프로젝트 봇 디렉토리가 없으면 템플릿에서 복사
      if (!existsSync(projectBotDir)) {
        const templateDir = config.botTemplateDir
          ? join(config.botTemplateDir, state.config.workDir)
          : join(config.bots_home, state.config.workDir);

        if (existsSync(templateDir)) {
          logger?.info('Copying bot template to project', {
            from: templateDir,
            to: projectBotDir,
          });
          cpSync(templateDir, projectBotDir, { recursive: true });
        } else {
          logger?.info('No template found, creating empty bot dir', {
            bot: route.target,
            dir: projectBotDir,
          });
          mkdirSync(projectBotDir, { recursive: true });
        }
      }

      const existingSessionId = sessionStore.get(currentProject, route.target) ?? undefined;

      let proc: BotProcess;
      try {
        proc = spawnBotProcess({
          botConfig: state.config,
          botHomeDir: projectBotDir,
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

      // Health 모니터링 시작
      healthMonitor?.startMonitoring(route.target);
      healthMonitor?.recordActivity(route.target);

      // Telegram 메시지 관리 — 단락(\n\n) 단위로 새 메시지 전송
      let currentMsgId: number | null = null;
      let currentMsgText = '';
      let pendingText = '';         // 아직 전송되지 않은 텍스트
      let sendingMsg = false;       // 전송 중 잠금
      let editTimer: ReturnType<typeof setTimeout> | null = null;
      let sentMessages: number[] = []; // 보낸 메시지 ID 목록

      const MSG_SPLIT_THRESHOLD = 500; // 이 길이 넘으면 다음 \n\n에서 분할

      const flushCurrentMsg = async () => {
        if (!sender || !currentMsgId || !currentMsgText) return;
        try {
          await sender.editMessage(route.chatId, currentMsgId, currentMsgText);
        } catch {
          // edit 실패 무시
        }
      };

      const startNewMessage = async (text: string) => {
        if (!sender || sendingMsg) return;
        sendingMsg = true;
        try {
          const msgId = await sender.sendMessage(route.chatId, text);
          currentMsgId = msgId;
          currentMsgText = text;
          sentMessages.push(msgId);
        } catch {
          // 전송 실패 무시
        }
        sendingMsg = false;
      };

      // "생각하는 중" 점 애니메이션
      const thinkingInterval = setInterval(() => {
        dotCount = (dotCount % 5) + 1;
        const dots = '.'.repeat(dotCount);
        if (thinkingMsgId && sender) {
          sender.editMessage(route.chatId, thinkingMsgId, `생각하는 중 ${dots}`);
        }
      }, 1000);

      proc.onEvent((event: StreamEvent) => {
        healthMonitor?.recordActivity(route.target);

        if (event.content) {
          pendingText += event.content;

          if (!sender) return;

          // 첫 텍스트: thinking 메시지를 응답으로 교체
          if (!currentMsgId && !sendingMsg) {
            clearInterval(thinkingInterval);

            if (thinkingMsgId) {
              currentMsgId = thinkingMsgId;
              currentMsgText = pendingText;
              thinkingMsgId = null;
              sentMessages.push(currentMsgId);
              sender.editMessage(route.chatId, currentMsgId, currentMsgText);
              pendingText = '';
            } else {
              sendingMsg = true;
              sender.sendMessage(route.chatId, pendingText).then((msgId) => {
                currentMsgId = msgId;
                currentMsgText = pendingText;
                sentMessages.push(msgId);
                pendingText = '';
                sendingMsg = false;
              });
            }
            return;
          }

          // 단락 분할: \n\n이 있고 현재 메시지가 threshold 넘으면 새 메시지
          if (currentMsgId && currentMsgText.length > MSG_SPLIT_THRESHOLD) {
            const splitIdx = pendingText.indexOf('\n\n');
            if (splitIdx !== -1) {
              // 현재 메시지에 splitIdx까지 추가하고 edit
              const beforeSplit = pendingText.slice(0, splitIdx);
              const afterSplit = pendingText.slice(splitIdx + 2);
              currentMsgText += beforeSplit;
              flushCurrentMsg();

              // 나머지는 새 메시지로
              pendingText = afterSplit;
              currentMsgId = null;
              currentMsgText = '';
              if (pendingText.trim()) {
                startNewMessage(pendingText);
                pendingText = '';
              }
              return;
            }
          }

          // 일반: 현재 메시지에 추가 + debounce edit
          if (currentMsgId) {
            currentMsgText += pendingText;
            pendingText = '';
            if (editTimer) clearTimeout(editTimer);
            editTimer = setTimeout(flushCurrentMsg, EDIT_DEBOUNCE_MS);
          }
        }
      });

      proc.onComplete(async (result) => {
        clearInterval(thinkingInterval);
        healthMonitor?.stopMonitoring(route.target);

        // 마지막 편집 flush
        if (editTimer) clearTimeout(editTimer);

        // 전송 중이면 대기
        if (sendingMsg) {
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (!sendingMsg) { clearInterval(check); resolve(); }
            }, 50);
            setTimeout(() => { clearInterval(check); resolve(); }, 2000);
          });
        }

        // 남은 pendingText 처리
        if (pendingText.trim() && currentMsgId) {
          currentMsgText += pendingText;
          pendingText = '';
          await flushCurrentMsg();
        }

        if (sentMessages.length > 0) {
          // 마지막 메시지 최종 편집
          await flushCurrentMsg();

          // 남은 텍스트가 있으면 새 메시지
          if (pendingText.trim() && sender) {
            await sender.sendMessage(route.chatId, pendingText);
          }
        } else if (sender) {
          // 스트리밍 메시지가 하나도 없는 경우 — fallback
          const fallbackText = result.output || '⚠️ 응답이 비어있습니다. 다시 시도해주세요.';
          if (result.output) {
            logger?.info('Sending fallback response', { bot: route.target, outputLen: result.output.length });
          } else {
            logger?.warn('Bot completed with empty output', { bot: route.target });
          }

          if (thinkingMsgId) {
            await sender.editMessage(route.chatId, thinkingMsgId, fallbackText);
          } else {
            await sender.sendMessage(route.chatId, fallbackText, {
              replyToMessageId: route.messageId,
            });
          }
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
        clearInterval(thinkingInterval);
        if (editTimer) clearTimeout(editTimer);

        // --resume 실패 시 세션 삭제 후 새 세션으로 재시도
        if (existingSessionId) {
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
        // thinking 메시지를 에러로 교체
        const errText = `❌ 오류: ${error.message}`;
        if (thinkingMsgId && sender) {
          sender.editMessage(route.chatId, thinkingMsgId, errText);
        } else {
          telegram?.sendMessage(route.chatId, errText);
        }

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

    initBots() {
      const created: string[] = [];
      const skipped: string[] = [];
      const projectBaseDir = `${config.projects.baseDir}/${currentProject}`;

      for (const botConfig of config.bots) {
        const projectBotDir = join(projectBaseDir, 'bots', botConfig.workDir);

        if (existsSync(projectBotDir)) {
          skipped.push(botConfig.name);
          continue;
        }

        const templateDir = config.botTemplateDir
          ? join(config.botTemplateDir, botConfig.workDir)
          : join(config.bots_home, botConfig.workDir);

        if (existsSync(templateDir)) {
          cpSync(templateDir, projectBotDir, { recursive: true });
        } else {
          mkdirSync(projectBotDir, { recursive: true });
        }
        created.push(botConfig.name);
      }

      // 세션도 초기화
      if (created.length > 0) {
        sessionStore.deleteAll(currentProject);
      }

      return { created, skipped };
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
