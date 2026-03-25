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

  // 3. Bot management (telegram injected after creation below)
  let telegram: ReturnType<typeof createTelegramAdapter>;

  // 4. Telegram
  const hubToken = process.env.HUB_BOT_TOKEN;
  if (!hubToken) throw new Error('HUB_BOT_TOKEN is required');

  telegram = createTelegramAdapter(hubToken, config.telegram.groupChatId, logger);
  const parser = createMessageParser(triggerMap);
  const router = createRouter(config.bots, logger);

  // 5. Health monitoring
  const healthMonitor = createHealthMonitor({
    healthTimeoutMs: config.settings.healthTimeoutMs,
    checkIntervalMs: 60_000,
    eventBus,
  });

  // 3b. Bot management (now telegram + healthMonitor available)
  const botManager = createBotManager({
    config,
    sessionStore,
    queueManager,
    eventBus,
    logger,
    telegram,
    triggerMap,
    healthMonitor,
  });

  eventBus.on('health:timeout', (event) => {
    logger.warn('Bot health timeout', { bot: event.bot });
    telegram.sendMessage(
      Number(config.telegram.groupChatId),
      `⚠️ ${event.bot} ${config.settings.healthTimeoutMs / 60_000}분간 응답 없음`,
    );
  });

  // 6. Build bot username map (토큰 → getMe로 username 조회)
  const botUsernames = new Map<string, string>();
  for (const botConfig of config.bots) {
    if (botConfig.token) {
      try {
        const { createBotSender } = await import('./telegram/bot-sender.js');
        const tempSender = createBotSender(botConfig.token, logger);
        const username = await tempSender.getUsername();
        if (username) {
          botUsernames.set(username, botConfig.name);
          logger.info('Bot username resolved', { bot: botConfig.name, username });
        }
      } catch (err) {
        logger.warn('Failed to resolve bot username', {
          bot: botConfig.name,
          error: String(err),
        });
      }
    }
  }

  // 7. Message handler
  telegram.onMessage((msg) => {
    const parsed = parser.parse(msg, botUsernames);
    const botLog = logger.child({ chatId: msg.chatId, messageId: msg.messageId });

    botLog.debug('Message received', {
      text: msg.text?.slice(0, 50),
      parsedType: parsed.type,
      hasReply: !!msg.replyToMessage,
      replyFrom: msg.replyToMessage?.from?.username,
      replyIsBot: msg.replyToMessage?.from?.isBot,
    });

    if (parsed.type === 'system') {
      handleSystemCommand(parsed.command, parsed.args, msg.chatId);
      return;
    }

    if (parsed.type === 'inline_cmd') {
      handleInlineCommand(parsed.botName, parsed.command, parsed.args, msg.chatId);
      return;
    }

    const route = router.route(parsed);

    if (parsed.type === 'multi') {
      botLog.info('Multi-bot dispatch', { bots: parsed.botNames, text: parsed.text });
      for (const botName of parsed.botNames) {
        botManager.dispatch({
          target: botName,
          text: parsed.text,
          chatId: parsed.chatId,
          messageId: parsed.messageId,
          userId: parsed.userId,
          source: 'keyword',
        }).catch((err) => {
          botLog.error('Multi dispatch error', { bot: botName, error: String(err) });
        });
      }
      return;
    }

    if (parsed.type === 'broadcast') {
      botLog.info('Broadcast received, classifying...', { text: parsed.text });
      router.routeBroadcast(parsed).then(async (routes) => {
        for (const r of routes) {
          await botManager.dispatch(r).catch((err) => {
            botLog.error('Dispatch error', { error: String(err) });
          });
        }
      }).catch((err) => {
        botLog.error('Broadcast classification error', { error: String(err) });
      });
      return;
    }

    if (!route) return;

    botLog.info('Routing message', { target: route.target, source: route.source });
    botManager.dispatch(route).catch((err) => {
      botLog.error('Dispatch error', { error: String(err) });
    });
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
        const projectDir = `${config.projects.baseDir}/${current}`;
        const { readdirSync, existsSync: dirExists } = await import('node:fs');
        const { resolve, join: joinPath } = await import('node:path');
        const absPath = resolve(projectDir);
        let listing = `📂 현재 프로젝트: ${current}\n📁 경로: ${absPath}`;
        const botsDir = joinPath(projectDir, 'bots');
        if (dirExists(botsDir)) {
          const dirs = readdirSync(botsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => `  └ ${d.name}/`);
          if (dirs.length > 0) listing += '\n🤖 봇:\n' + dirs.join('\n');
        } else {
          listing += '\n⚠️ 봇 미초기화 (첫 메시지 시 템플릿에서 생성)';
        }
        await telegram.sendMessage(chatId, listing);
        break;
      }
      case '세션': {
        const current = botManager.getCurrentProject();
        const allSessions = sessionStore.getAll(current);
        const { resolve: resolvePath, join: joinPath } = await import('node:path');
        const botLines = config.bots.map((b) => {
          const session = allSessions[b.name];
          const sessionId = session?.sessionId ?? '없음';
          const shortId = sessionId.length > 8 ? sessionId.slice(0, 8) + '...' : sessionId;
          const botDir = resolvePath(joinPath(config.projects.baseDir, current, 'bots', b.workDir));
          const status = botManager.getBot(b.name)?.status ?? 'unknown';
          const emoji = status === 'busy' ? '⏳' : status === 'idle' ? '💤' : '❌';
          return `${b.color} ${b.name}\n  📁 ${botDir}\n  🔑 ${shortId} ${emoji}`;
        });
        const header = `📋 세션 정보 (프로젝트: ${current})`;
        await telegram.sendMessage(chatId, header + '\n\n' + botLines.join('\n\n'));
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

  async function handleInlineCommand(
    botName: string,
    command: string,
    args: string[],
    chatId: number,
  ): Promise<void> {
    switch (command) {
      case 'clear': {
        await botManager.clearSession(botName);
        await telegram.sendMessage(chatId, `🗑️ ${botName} 세션 초기화 완료`);
        break;
      }
      case 'session': {
        const current = botManager.getCurrentProject();
        const allSessions = sessionStore.getAll(current);
        const session = allSessions[botName];
        const sessionId = session?.sessionId ?? '없음';
        const { resolve: resolvePath, join: joinPath } = await import('node:path');
        const botDir = resolvePath(joinPath(config.projects.baseDir, current, 'bots', botManager.getBot(botName)?.config.workDir ?? botName));
        await telegram.sendMessage(chatId, [
          `📋 ${botName} 세션 정보`,
          `  📁 작업 디렉토리: ${botDir}`,
          `  📂 프로젝트: ${current}`,
          `  🔑 세션: ${sessionId}`,
          `  상태: ${botManager.getBot(botName)?.status ?? 'unknown'}`,
        ].join('\n'));
        break;
      }
      case 'model': {
        const model = args[0];
        if (!model) {
          await telegram.sendMessage(chatId, '사용법: #봇이름 /model sonnet|opus|haiku');
          return;
        }
        // 모델 변경은 향후 구현 (세션 리셋 필요)
        await telegram.sendMessage(chatId, `⚠️ 모델 변경은 아직 지원되지 않습니다.`);
        break;
      }
    }
  }

  // 8. Config hot-reload
  const configWatcher = createConfigWatcher(CONFIG_PATH, logger);
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
