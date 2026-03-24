import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBotManager,
  type BotManager,
  type BotState,
} from './manager.js';
import { createSessionStore } from '../store/session.js';
import { createQueueManager } from '../core/queue.js';
import { createEventBus } from '../core/event-bus.js';
import type { HubConfig } from '../config/schema.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = join(tmpdir(), 'telehub-test-manager');

const testConfig: HubConfig = {
  telegram: { groupChatId: '-100' },
  bots: [
    { name: '김제헌', role: '리서치', triggers: ['제헌'], systemPrompt: 'test', workDir: 'research', color: '🔬' },
    { name: '김용훈', role: '개발', triggers: ['용훈'], systemPrompt: 'test', workDir: 'dev', color: '💻' },
  ],
  projects: { default: 'general', baseDir: tmpDir },
  settings: { healthTimeoutMs: 180000, longResponseThreshold: 3000, pollingInterval: 300, maxConcurrentBots: 4 },
};

describe('BotManager', () => {
  let manager: BotManager;

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    const sessionStore = createSessionStore(tmpDir);
    const queueManager = createQueueManager();
    const eventBus = createEventBus();

    manager = createBotManager({
      config: testConfig,
      sessionStore,
      queueManager,
      eventBus,
    });
  });

  it('should initialize all bots with idle status', () => {
    const bots = manager.getAllBots();
    expect(bots).toHaveLength(2);
    expect(bots[0].name).toBe('김제헌');
    expect(bots[0].status).toBe('idle');
    expect(bots[1].name).toBe('김용훈');
  });

  it('should get bot by name', () => {
    const bot = manager.getBot('김제헌');
    expect(bot).toBeDefined();
    expect(bot?.name).toBe('김제헌');
    expect(bot?.config.role).toBe('리서치');
  });

  it('should return undefined for unknown bot', () => {
    expect(manager.getBot('모르는봇')).toBeUndefined();
  });

  it('should track current project', () => {
    expect(manager.getCurrentProject()).toBe('general');
  });

  it('should switch project', async () => {
    await manager.switchProject('new-proj');
    expect(manager.getCurrentProject()).toBe('new-proj');
  });

  it('should clear session for a bot', async () => {
    // 세션 설정 후 클리어
    const sessionStore = createSessionStore(tmpDir);
    sessionStore.set('general', '김제헌', 'sess-abc');

    const mgr = createBotManager({
      config: testConfig,
      sessionStore,
      queueManager: createQueueManager(),
      eventBus: createEventBus(),
    });

    await mgr.clearSession('김제헌');
    expect(sessionStore.get('general', '김제헌')).toBeNull();
  });

  it('should clear all sessions', async () => {
    const sessionStore = createSessionStore(tmpDir);
    sessionStore.set('general', '김제헌', 's1');
    sessionStore.set('general', '김용훈', 's2');

    const mgr = createBotManager({
      config: testConfig,
      sessionStore,
      queueManager: createQueueManager(),
      eventBus: createEventBus(),
    });

    await mgr.clearAllSessions();
    expect(sessionStore.get('general', '김제헌')).toBeNull();
    expect(sessionStore.get('general', '김용훈')).toBeNull();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
