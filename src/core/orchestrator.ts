import { spawn } from 'node:child_process';
import type { HubConfig } from '../config/schema.js';
import type { BotManager } from '../bot/manager.js';
import type { EventBus } from './event-bus.js';
import type { Logger } from '../utils/logger.js';
import type { TelegramAdapter } from '../telegram/adapter.js';
import type { ParsedMessage } from '../telegram/parser.js';

// --- Types ---

export interface ExecutionStep {
  id: string;
  bot: string;
  task: string;
  dependsOn?: string[];
  relayFrom?: string;
}

export interface ExecutionPlan {
  type: 'sequential' | 'parallel' | 'mixed';
  steps: ExecutionStep[];
}

interface StepResult {
  bot: string;
  output: string;
  sessionId: string;
}

export interface Orchestrator {
  handle(parsed: Extract<ParsedMessage, { type: 'broadcast' | 'multi' }>): Promise<void>;
}

export interface OrchestratorDeps {
  config: HubConfig;
  botManager: BotManager;
  eventBus: EventBus;
  telegram: TelegramAdapter;
  logger: Logger;
}

// --- Implementation ---

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { config, botManager, eventBus, telegram, logger } = deps;

  function buildPrompt(userMessage: string): string {
    const botList = config.bots
      .map((b) => `- ${b.name}(${b.role})`)
      .join('\n');

    return [
      '당신은 TeleHub 오케스트레이터입니다. 사용자의 요청을 분석하여 실행 계획(JSON)을 생성하세요.',
      '',
      '## 사용 가능한 봇',
      botList,
      '',
      '## 사용자 요청',
      `"${userMessage}"`,
      '',
      '## 출력 규칙',
      '- JSON만 출력. 설명, 마크다운, 코드블록 없이 순수 JSON만.',
      '- steps의 task는 해당 봇에게 전달될 메시지. 자연스러운 한국어로 작성.',
      '- relayFrom이 있으면 해당 step의 응답이 task 앞에 자동 추가됨.',
      '',
      '## 판단 기준',
      '- "서로 인사해", "대화해" → sequential. 한 명씩 차례로, relayFrom으로 이전 대화 전달. task에 "짧게 2-3문장으로" 명시.',
      '- "각자 의견", "보고해", "뭐해" → parallel. 동시 실행.',
      '- "A가 ~하고 B가 ~해" → mixed. A 먼저, B는 dependsOn + relayFrom으로 A 결과 활용.',
      '- 특정 봇만 해당 → 해당 봇만 steps에 포함.',
      '',
      '## 중요 규칙',
      '- task 메시지에 항상 "짧게 답변해" 또는 구체적 분량을 포함하세요.',
      '- sequential일 때 각 봇의 task는 "이전 사람의 말에 이어서 짧게 답해" 형태로. 봇이 모든 팀원에게 개별 인사하지 않도록.',
      '- 한 봇이 여러 명에게 동시에 말하는 plan은 만들지 마세요. 1 step = 1 봇 = 1 대상.',
      '',
      '## JSON 형식',
      '{',
      '  "type": "sequential" | "parallel" | "mixed",',
      '  "steps": [',
      '    { "id": "step-1", "bot": "봇이름", "task": "봇에게 전달할 메시지" },',
      '    { "id": "step-2", "bot": "봇이름", "task": "메시지", "dependsOn": ["step-1"], "relayFrom": "step-1" }',
      '  ]',
      '}',
    ].join('\n');
  }

  async function createPlan(message: string): Promise<ExecutionPlan> {
    const prompt = buildPrompt(message);
    const model = config.settings.orchestratorModel ?? 'haiku';

    const raw = await runClaude(prompt, model);
    logger.info('Orchestrator raw response', { raw: raw.slice(0, 500) });

    // JSON 추출 (코드블록 안에 있을 수도 있으므로)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Orchestrator returned no valid JSON');
    }

    const plan = JSON.parse(jsonMatch[0]) as ExecutionPlan;

    // 유효성 검증
    if (!plan.steps || plan.steps.length === 0) {
      throw new Error('Orchestrator returned empty plan');
    }

    // 봇 이름 검증
    const validBots = new Set(config.bots.map((b) => b.name));
    for (const step of plan.steps) {
      if (!validBots.has(step.bot)) {
        logger.warn('Unknown bot in plan, skipping step', { bot: step.bot, stepId: step.id });
      }
    }
    plan.steps = plan.steps.filter((s) => validBots.has(s.bot));

    return plan;
  }

  async function executePlan(
    plan: ExecutionPlan,
    chatId: number,
    messageId: number,
    userId: number,
  ): Promise<void> {
    const results = new Map<string, StepResult>();
    eventBus.emit({ type: 'orchestrator:plan', steps: plan.steps.length });

    if (plan.type === 'parallel') {
      // 모든 step 동시 실행
      const promises = plan.steps.map((step) =>
        executeStep(step, results, chatId, messageId, userId),
      );
      await Promise.allSettled(promises);
    } else {
      // sequential 또는 mixed: dependsOn 기반 실행
      const completed = new Set<string>();
      const pending = [...plan.steps];

      while (pending.length > 0) {
        // 실행 가능한 step 찾기 (dependsOn이 모두 완료된 것)
        const ready = pending.filter((s) =>
          !s.dependsOn || s.dependsOn.every((dep) => completed.has(dep)),
        );

        if (ready.length === 0) {
          logger.warn('Orchestrator deadlock: no ready steps', {
            pending: pending.map((s) => s.id),
            completed: [...completed],
          });
          break;
        }

        // 준비된 step 동시 실행
        const promises = ready.map(async (step) => {
          const result = await executeStep(step, results, chatId, messageId, userId);
          if (result) {
            results.set(step.id, result);
            completed.add(step.id);
          }
        });
        await Promise.allSettled(promises);

        // 실행된 step 제거
        for (const step of ready) {
          const idx = pending.indexOf(step);
          if (idx !== -1) pending.splice(idx, 1);
        }
      }
    }
  }

  async function executeStep(
    step: ExecutionStep,
    results: Map<string, StepResult>,
    chatId: number,
    messageId: number,
    userId: number,
  ): Promise<StepResult | null> {
    eventBus.emit({ type: 'orchestrator:step', bot: step.bot, status: 'start' });

    // relayFrom: 이전 step의 응답을 task에 포함
    let task = step.task;
    if (step.relayFrom) {
      const prev = results.get(step.relayFrom);
      if (prev) {
        task = `[${prev.bot}의 이전 메시지]\n${prev.output}\n\n[요청]\n${step.task}`;
      }
    }

    try {
      const result = await botManager.dispatchAndWait({
        target: step.bot,
        text: task,
        chatId,
        messageId,
        userId,
        source: 'orchestrated',
      });

      eventBus.emit({ type: 'orchestrator:step', bot: step.bot, status: 'complete' });
      logger.info('Orchestrator step completed', { stepId: step.id, bot: step.bot });

      return { bot: step.bot, output: result.output, sessionId: result.sessionId };
    } catch (err) {
      logger.error('Orchestrator step failed', { stepId: step.id, bot: step.bot, error: String(err) });
      return null;
    }
  }

  return {
    async handle(parsed) {
      const chatId = parsed.chatId;
      let text: string;
      if (parsed.type === 'multi') {
        text = `${parsed.text} (대상: ${parsed.botNames.join(', ')})`;
      } else {
        text = parsed.text;
      }

      if (!text?.trim()) {
        // 빈 브로드캐스트 = 출석 → 전원 parallel
        const plan: ExecutionPlan = {
          type: 'parallel',
          steps: config.bots.map((b, i) => ({
            id: `step-${i + 1}`,
            bot: b.name,
            task: '팀장이 부르고 있어. 지금 뭐하고 있는지 간단히 한줄로 응답해.',
          })),
        };
        await executePlan(plan, chatId, parsed.messageId, parsed.userId);
        return;
      }

      // "계획 중..." 메시지
      let thinkingMsgId: number | null = null;
      try {
        thinkingMsgId = await telegram.sendMessage(chatId, '🧠 계획 중...');
      } catch {
        // 무시
      }

      try {
        const plan = await createPlan(text);
        logger.info('Orchestrator plan created', {
          type: plan.type,
          steps: plan.steps.length,
          detail: plan.steps.map((s) => `${s.id}:${s.bot}`).join(' → '),
        });

        // thinking 메시지 삭제
        if (thinkingMsgId) {
          telegram.deleteMessage(chatId, thinkingMsgId).catch(() => {});
        }

        await executePlan(plan, chatId, parsed.messageId, parsed.userId);
      } catch (err) {
        logger.error('Orchestrator failed, falling back to parallel', { error: String(err) });

        // thinking 메시지 삭제
        if (thinkingMsgId) {
          telegram.deleteMessage(chatId, thinkingMsgId).catch(() => {});
        }

        // Fallback: 전원 parallel dispatch (기존 broadcast 동작)
        const fallbackPlan: ExecutionPlan = {
          type: 'parallel',
          steps: config.bots.map((b, i) => ({
            id: `step-${i + 1}`,
            bot: b.name,
            task: text,
          })),
        };
        await executePlan(fallbackPlan, chatId, parsed.messageId, parsed.userId);
      }
    },
  };
}

// --- Helpers ---

function runClaude(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '--model', model,
      '-p',
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      prompt,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Claude CLI (${model}) exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
