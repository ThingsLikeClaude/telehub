import 'dotenv/config';
import { loadConfig, buildTriggerMap } from './config/schema.js';
import { createConfigWatcher } from './config/watcher.js';
import { createLogger } from './utils/logger.js';
import { createTelegramAdapter } from './telegram/adapter.js';
import { createMessageParser } from './telegram/parser.js';
import { createEventBus } from './core/event-bus.js';
import { createRouter } from './core/router.js';
import { createQueueManager } from './core/queue.js';
import { createSessionStore } from './store/session.js';
import { createBotManager } from './bot/manager.js';
import { createHealthMonitor } from './monitor/health.js';
import { formatStatusDashboard } from './core/commands.js';

const CONFIG_PATH = process.env.CONFIG_PATH ?? 'hub-config.json';

async function main(): Promise<void> {
  // 1. Config & Logger
  const config = loadConfig(CONFIG_PATH);
  const logger = createLogger({
    level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
    name: 'telehub',
  });

  logger.info('TeleHub starting', {
    bots: config.bots.map((b) => b.name),
    project: config.projects.default,
  });

  // 2. Core services
  const eventBus = createEventBus();
  const triggerMap = buildTriggerMap(config.bots);
  const sessionStore = createSessionStore(config.projects.baseDir);
  const queueManager = createQueueManager();

  // 3. Bot management
  const botManager = createBotManager({
    config,
    sessionStore,
    queueManager,
    eventBus,
  });

  // 4. Telegram
  const hubToken = process.env.HUB_BOT_TOKEN;
  if (!hubToken) throw new Error('HUB_BOT_TOKEN is required');

  const telegram = createTelegramAdapter(hubToken, config.telegram.groupChatId, logger);
  const parser = createMessageParser(triggerMap);
  const router = createRouter(config.bots);

  // 5. Health monitoring
  const healthMonitor = createHealthMonitor({
    healthTimeoutMs: config.settings.healthTimeoutMs,
    checkIntervalMs: 60_000,
    eventBus,
  });

  eventBus.on('health:timeout', (event) => {
    logger.warn('Bot health timeout', { bot: event.bot });
    telegram.sendMessage(
      Number(config.telegram.groupChatId),
      `⚠️ ${event.bot} ${config.settings.healthTimeoutMs / 60_000}분간 응답 없음`,
    );
  });

  // 6. Build bot username map (MVP: 단일 Hub 봇이므로 빈 맵)
  const botUsernames = new Map<string, string>();

  // 7. Message handler
  telegram.onMessage((msg) => {
    const parsed = parser.parse(msg, botUsernames);
    const botLog = logger.child({ chatId: msg.chatId, messageId: msg.messageId });

    if (parsed.type === 'system') {
      handleSystemCommand(parsed.command, parsed.args, msg.chatId);
      return;
    }

    const route = router.route(parsed);
    if (!route) {
      if (parsed.type === 'broadcast') {
        botLog.info('Broadcast received — classification not yet implemented', {
          text: parsed.text,
        });
        telegram.sendMessage(
          msg.chatId,
          '📡 브로드캐스트 분류는 아직 구현 중입니다. `#봇이름`으로 직접 호출해주세요.',
        );
      }
      return;
    }

    botLog.info('Routing message', { target: route.target, source: route.source });
    // TODO: botManager.dispatch(route) — Claude CLI subprocess 실행
    telegram.sendMessage(
      msg.chatId,
      `🤖 ${route.target}에게 전달됨: "${route.text}"`,
      { replyToMessageId: msg.messageId },
    );
  });

  async function handleSystemCommand(
    command: string,
    args: string[],
    chatId: number,
  ): Promise<void> {
    switch (command) {
      case '상태': {
        const bots = botManager.getAllBots().map((b) => ({
          name: b.name,
          role: b.config.role,
          color: b.config.color,
          status: b.status,
          currentTask: b.currentTask,
        }));
        const queueInfo = config.bots.map((b) => ({
          bot: b.name,
          size: queueManager.size(b.name),
        }));
        const dashboard = formatStatusDashboard(
          botManager.getCurrentProject(),
          bots,
          queueInfo,
        );
        await telegram.sendMessage(chatId, dashboard);
        break;
      }
      case '프로젝트': {
        const current = botManager.getCurrentProject();
        await telegram.sendMessage(chatId, `📂 현재 프로젝트: ${current}`);
        break;
      }
      case '전환': {
        const projectName = args[0];
        if (!projectName) {
          await telegram.sendMessage(chatId, '사용법: #전환 프로젝트명');
          return;
        }
        await botManager.switchProject(projectName);
        await telegram.sendMessage(chatId, `📂 프로젝트 전환: ${projectName}`);
        break;
      }
      case '클리어': {
        const botName = args[0];
        if (botName) {
          await botManager.clearSession(botName);
          await telegram.sendMessage(chatId, `🗑️ 세션 초기화: ${botName}`);
        } else {
          await telegram.sendMessage(chatId, '사용법: #클리어 봇이름 또는 #전체클리어');
        }
        break;
      }
      case '전체클리어': {
        await botManager.clearAllSessions();
        await telegram.sendMessage(chatId, '🗑️ 전체 세션 초기화 완료');
        break;
      }
      case '끝': {
        await telegram.sendMessage(chatId, '✅ 활성 작업 종료');
        break;
      }
    }
  }

  // 8. Config hot-reload
  const configWatcher = createConfigWatcher(CONFIG_PATH);
  configWatcher.onReload((newConfig) => {
    logger.info('Config reloaded', { bots: newConfig.bots.map((b) => b.name) });
    eventBus.emit({ type: 'config:reloaded' });
  });
  configWatcher.start();

  // 9. Start polling
  telegram.start();

  // 10. Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    configWatcher.stop();
    healthMonitor.stop();
    await botManager.shutdown();
    await telegram.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('TeleHub is running', {
    project: botManager.getCurrentProject(),
    bots: config.bots.length,
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
