import type { BotConfig, HubConfig } from '../config/schema.js';
import type { SessionStore } from '../store/session.js';
import type { QueueManager } from '../core/queue.js';
import type { EventBus } from '../core/event-bus.js';

export interface BotState {
  name: string;
  config: BotConfig;
  status: 'idle' | 'busy' | 'error' | 'starting';
  currentTask?: string;
}

export interface BotManager {
  getBot(name: string): BotState | undefined;
  getAllBots(): ReadonlyArray<BotState>;
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
}

export function createBotManager(deps: BotManagerDeps): BotManager {
  const { config, sessionStore, queueManager } = deps;
  let currentProject = config.projects.default;

  const botStates: Map<string, BotState> = new Map(
    config.bots.map((botConfig) => [
      botConfig.name,
      {
        name: botConfig.name,
        config: botConfig,
        status: 'idle' as const,
        currentTask: undefined,
      },
    ]),
  );

  return {
    getBot(name) {
      return botStates.get(name);
    },

    getAllBots() {
      return [...botStates.values()];
    },

    async clearSession(botName) {
      sessionStore.delete(currentProject, botName);
      const state = botStates.get(botName);
      if (state) {
        botStates.set(botName, { ...state, status: 'idle', currentTask: undefined });
      }
    },

    async clearAllSessions() {
      sessionStore.deleteAll(currentProject);
      for (const [name, state] of botStates) {
        botStates.set(name, { ...state, status: 'idle', currentTask: undefined });
      }
      queueManager.clearAll();
    },

    async switchProject(projectName) {
      // 기존 봇 프로세스는 상태만 리셋 (실제 프로세스 kill은 향후)
      for (const [name, state] of botStates) {
        botStates.set(name, { ...state, status: 'idle', currentTask: undefined });
      }
      currentProject = projectName;
    },

    getCurrentProject() {
      return currentProject;
    },

    async shutdown() {
      for (const [name, state] of botStates) {
        botStates.set(name, { ...state, status: 'idle', currentTask: undefined });
      }
      queueManager.clearAll();
    },
  };
}
