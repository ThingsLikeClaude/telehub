import { z } from 'zod';
import { readFileSync } from 'node:fs';

const BotConfigSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  triggers: z.array(z.string()).min(1),
  systemPrompt: z.string().optional(),
  workDir: z.string(),
  color: z.string().default('🤖'),
  token: z.string().optional(),  // 개별 봇 토큰 (없으면 Hub 토큰 사용)
});

const HubConfigSchema = z.object({
  telegram: z.object({
    groupChatId: z.string(),
  }),
  bots: z.array(BotConfigSchema).min(1),
  bots_home: z.string().default('./bots'),  // (레거시) 봇별 고정 홈 디렉토리
  botTemplateDir: z.string().optional(),     // 봇 템플릿 원본 경로 (프로젝트 생성 시 복사)
  projects: z.object({
    default: z.string(),
    baseDir: z.string(),
  }),
  settings: z.object({
    healthTimeoutMs: z.number().default(180_000),
    longResponseThreshold: z.number().default(3000),
    pollingInterval: z.number().default(300),
    maxConcurrentBots: z.number().default(4),
    maxHandoffDepth: z.number().default(3),
    orchestratorModel: z.string().default('haiku'),
  }),
});

export type HubConfig = z.infer<typeof HubConfigSchema>;
export type BotConfig = z.infer<typeof BotConfigSchema>;

export function validateConfig(raw: unknown): HubConfig {
  const config = HubConfigSchema.parse(raw);
  checkDuplicateTriggers(config.bots);
  return config;
}

export function loadConfig(path: string): HubConfig {
  const content = readFileSync(path, 'utf-8');
  const raw = JSON.parse(content) as unknown;
  return validateConfig(raw);
}

export function buildTriggerMap(bots: ReadonlyArray<BotConfig>): Map<string, string> {
  const map = new Map<string, string>();
  for (const bot of bots) {
    for (const trigger of bot.triggers) {
      map.set(trigger, bot.name);
    }
  }
  return map;
}

function checkDuplicateTriggers(bots: ReadonlyArray<BotConfig>): void {
  const seen = new Map<string, string>();
  for (const bot of bots) {
    for (const trigger of bot.triggers) {
      const existing = seen.get(trigger);
      if (existing !== undefined) {
        throw new Error(
          `Duplicate trigger "${trigger}" found in bots "${existing}" and "${bot.name}"`,
        );
      }
      seen.set(trigger, bot.name);
    }
  }
}
