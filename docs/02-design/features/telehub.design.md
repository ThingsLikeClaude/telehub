# TeleHub — Design Document

> Feature: telehub
> Phase: Design
> Created: 2026-03-24
> Plan Reference: `docs/01-plan/features/telehub.plan.md`
> PRD Reference: `docs/00-pm/telehub.prd.md`

---

## Executive Summary

| Item | Detail |
|------|--------|
| **Feature** | TeleHub — Telegram Agent Teams Hub |
| **Start Date** | 2026-03-24 |
| **Target Duration** | 2-3 weeks (MVP) |
| **Level** | Dynamic |

### Value Delivered (4-Perspective)

| Perspective | Description |
|-------------|-------------|
| **Problem** | cokacdir(Rust 8,683줄) — 파일 폴링 5초 지연, 봇간 협업 불가, 유지보수 한계 |
| **Solution** | Node.js Hub 오케스트레이션 + EventEmitter 인메모리 통신 + Claude CLI subprocess |
| **Function/UX** | `#봇이름` 즉시 호출, reply 자연 대화, `#얘들아` 자동 분류, 프로젝트별 세션 유지 |
| **Core Value** | AI 봇들이 진짜 팀원처럼 Telegram 그룹챗에서 협업 |

---

## 1. Module Detailed Design

### 1.1 Config (`src/config/schema.ts`)

#### Types

```typescript
import { z } from 'zod';

const BotConfigSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  triggers: z.array(z.string()).min(1),
  systemPrompt: z.string(),
  workDir: z.string(),
  color: z.string().default('🤖'),
});

const HubConfigSchema = z.object({
  telegram: z.object({
    groupChatId: z.string(),
  }),
  bots: z.array(BotConfigSchema).min(1),
  projects: z.object({
    default: z.string(),
    baseDir: z.string(),
  }),
  settings: z.object({
    healthTimeoutMs: z.number().default(180_000),
    longResponseThreshold: z.number().default(3000),
    pollingInterval: z.number().default(300),
    maxConcurrentBots: z.number().default(4),
  }),
});

type HubConfig = z.infer<typeof HubConfigSchema>;
type BotConfig = z.infer<typeof BotConfigSchema>;
```

#### Functions

```typescript
function loadConfig(path: string): HubConfig
// - fs.readFileSync → JSON.parse → HubConfigSchema.parse
// - 실패 시 ZodError throw (프로세스 종료)

function validateConfig(raw: unknown): HubConfig
// - HubConfigSchema.parse(raw)
// - 중복 trigger 체크: 서로 다른 봇의 trigger가 겹치면 에러

function buildTriggerMap(bots: BotConfig[]): Map<string, string>
// - trigger → botName 매핑
// - "제헌" → "김제헌", "ㅈㅎ" → "김제헌", ...
// - 반환: 불변 Map
```

---

### 1.2 ConfigWatcher (`src/config/watcher.ts`)

```typescript
import chokidar from 'chokidar';

interface ConfigWatcher {
  start(): void;
  stop(): void;
  onReload(callback: (config: HubConfig) => void): void;
}

function createConfigWatcher(configPath: string): ConfigWatcher
// - chokidar.watch(configPath, { awaitWriteFinish: { stabilityThreshold: 500 } })
// - 'change' 이벤트 → loadConfig → validate → callback 호출
// - 유효하지 않은 config → 로그 경고, 이전 config 유지 (적용하지 않음)
// - debounce: 500ms (연속 저장 방지)
```

---

### 1.3 Logger (`src/utils/logger.ts`)

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

function createLogger(options: { level: LogLevel; name: string }): Logger
// - stdout JSON lines: { ts, level, name, msg, ...meta }
// - child()는 context를 merge한 새 Logger 반환
// - pm2 로그와 호환되도록 console.log/console.error 사용
```

---

### 1.4 TelegramAdapter (`src/telegram/adapter.ts`)

#### Interface

```typescript
interface TelegramMessage {
  chatId: number;
  messageId: number;
  text: string;
  from: { id: number; firstName: string; username?: string };
  replyToMessage?: {
    messageId: number;
    from: { id: number; firstName: string; isBot: boolean; username?: string };
    text?: string;
  };
  date: number;
}

interface TelegramAdapter {
  start(): void;
  stop(): Promise<void>;
  onMessage(handler: (msg: TelegramMessage) => void): void;
  sendMessage(chatId: number, text: string, options?: SendOptions): Promise<number>;
  sendFile(chatId: number, filePath: string, caption?: string): Promise<number>;
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
}

interface SendOptions {
  replyToMessageId?: number;
  parseMode?: 'Markdown' | 'HTML';
}
```

#### 구현 상세

```typescript
function createTelegramAdapter(token: string, config: HubConfig): TelegramAdapter
// 내부:
// - new TelegramBot(token, { polling: true })
// - groupChatId 필터링: config.telegram.groupChatId와 일치하는 메시지만 처리
// - bot.on('message', ...) → 정규화 → handler 호출
// - sendMessage: 4096자 초과 시 자동 분할 (splitMessage 유틸리티)
// - editMessage: 메시지 존재하지 않으면 무시 (swallow error)
// - stop(): polling 중지, 대기 중인 요청 완료 후 반환
```

#### 메시지 분할 규칙

```typescript
function splitMessage(text: string, maxLength: number = 4096): string[]
// - 코드블록(```) 경계를 존중하여 분할
// - 분할 위치 우선순위: \n\n > \n > 공백 > maxLength 강제 절단
// - 각 파트에 "(1/N)" 접미사 추가
```

---

### 1.5 MessageParser (`src/telegram/parser.ts`)

#### Types

```typescript
type ParsedMessage =
  | { type: 'keyword'; botName: string; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'reply'; botName: string; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'broadcast'; text: string; chatId: number; messageId: number; userId: number }
  | { type: 'system'; command: SystemCommand; args: string[]; chatId: number; messageId: number }
  | { type: 'ignore' };

type SystemCommand = '상태' | '프로젝트' | '전환' | '클리어' | '전체클리어' | '끝';
```

#### Functions

```typescript
interface MessageParser {
  parse(msg: TelegramMessage, botUsernames: Map<string, string>): ParsedMessage;
}

function createMessageParser(triggerMap: Map<string, string>): MessageParser
```

#### 파싱 로직 (순서 중요)

```
1. 텍스트가 없으면 → { type: 'ignore' }
2. '#' 으로 시작?
   a. 시스템 명령 체크: #상태, #프로젝트, #전환, #클리어, #전체클리어, #끝
      → { type: 'system', command, args }
   b. #얘들아 체크 (정확히 "얘들아" 또는 "모두" 또는 "전체")
      → { type: 'broadcast', text: #키워드 이후 전체 }
   c. triggerMap에서 키워드 매칭
      - '#제헌 조사해줘' → '제헌' → triggerMap.get('제헌') → '김제헌'
      - '#제헌아 해줘' → '제헌' (접미사 '아/야/이/님' 제거 후 매칭)
      → { type: 'keyword', botName, text: 키워드 이후 텍스트 }
   d. 매칭 실패 → { type: 'ignore' }
3. Reply 메시지?
   a. replyToMessage.from.isBot === true
   b. replyToMessage.from.username → botUsernames에서 봇 이름 검색
      → { type: 'reply', botName, text }
   c. 봇이 아닌 메시지에 reply → { type: 'ignore' }
4. 그 외 → { type: 'ignore' }
```

#### Trigger 매칭 상세

```typescript
function matchTrigger(text: string, triggerMap: Map<string, string>): { botName: string; rest: string } | null
// 1. '#' 제거 후 첫 단어 추출
// 2. 접미사 제거: '아', '야', '이', '님', '씨' (한글 호칭 접미사)
//    예: "제헌아" → "제헌", "용훈이" → "용훈"
// 3. triggerMap.get(cleanedWord)
// 4. 없으면 부분 매칭: triggerMap 키 중 startsWith(cleanedWord) 인 것 (하나만 매칭될 때)
// 5. rest: 키워드 이후 텍스트 (trim)
```

---

### 1.6 Router (`src/core/router.ts`)

#### Interface

```typescript
interface RouteResult {
  target: string;     // botName 또는 'system'
  text: string;       // 봇에 전달할 메시지
  chatId: number;
  messageId: number;
  userId: number;
  source: 'keyword' | 'reply' | 'broadcast';
}

interface Router {
  route(parsed: ParsedMessage): Promise<RouteResult | null>;
}

function createRouter(
  botManager: BotManager,
  config: HubConfig,
): Router
```

#### Broadcast 분류 로직

```typescript
// #얘들아 메시지 처리
async function classifyBroadcast(
  text: string,
  bots: BotConfig[],
): Promise<string>
// 1. Claude CLI subprocess를 일회용으로 spawn
// 2. 프롬프트:
//    """
//    다음 메시지를 가장 적절한 봇에게 배분하세요.
//    봇 목록: [{name, role, triggers}]
//    메시지: "{text}"
//    응답: 봇 이름만 (예: "김제헌")
//    여러 봇이 필요하면 쉼표로 구분 (예: "김제헌, 김용훈")
//    """
// 3. stdout에서 봇 이름 파싱
// 4. 유효한 봇 이름 필터링
// 5. 실패 시 → 모든 봇에게 전달 (fallback)
```

---

### 1.7 BotProcess (`src/bot/process.ts`)

#### Interface

```typescript
interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'system';
  subtype?: string;        // 'text', 'tool_use_begin', etc.
  content?: string;
  sessionId?: string;
  costUsd?: number;
}

interface BotProcess {
  readonly pid: number | null;
  readonly sessionId: string | null;
  readonly isRunning: boolean;

  send(message: string): Promise<void>;
  kill(): Promise<void>;
  onEvent(handler: (event: StreamEvent) => void): void;
  onComplete(handler: (result: { sessionId: string; output: string }) => void): void;
  onError(handler: (error: Error) => void): void;
}

function spawnBotProcess(options: SpawnOptions): BotProcess

interface SpawnOptions {
  botConfig: BotConfig;
  projectDir: string;
  sessionId?: string;    // --resume용, 없으면 새 세션
  message: string;       // 사용자 메시지
}
```

#### Claude CLI 실행 상세

```typescript
// 실행 명령:
// claude --output-format stream-json \
//        --dangerously-skip-permissions \
//        --system-prompt "{botConfig.systemPrompt}" \
//        [--resume {sessionId}] \
//        --prompt "{message}"
//
// 작업 디렉토리: {projectDir}/{botConfig.workDir}

// stdout 파싱:
// - 각 라인은 JSON 객체
// - type: "assistant" + subtype: "text" → 텍스트 청크
// - type: "result" → 완료, sessionId 추출
// - 그 외 → 로그만 남기고 무시

// 에러 처리:
// - 프로세스 exit code !== 0 → onError 호출
// - stdout JSON 파싱 실패 → 해당 라인 무시, 로그 남김
// - SIGTERM → graceful shutdown (5초 대기 후 SIGKILL)
```

#### stdout stream-json 이벤트 파싱

```typescript
function parseStreamLine(line: string): StreamEvent | null
// 1. JSON.parse(line)
// 2. type 필드 확인
// 3. type === 'assistant' && subtype === 'text' → content 추출
// 4. type === 'result' → sessionId, costUsd 추출
// 5. 파싱 실패 → null 반환 (로그 남김)
```

---

### 1.8 BotManager (`src/bot/manager.ts`)

#### Interface

```typescript
interface BotManager {
  // 봇 상태 조회
  getBot(name: string): BotState | undefined;
  getAllBots(): ReadonlyArray<BotState>;

  // 봇에 메시지 전달 (큐 포함)
  dispatch(route: RouteResult): Promise<void>;

  // 봇 세션 관리
  clearSession(botName: string): Promise<void>;
  clearAllSessions(): Promise<void>;

  // 프로젝트 전환
  switchProject(projectName: string): Promise<void>;
  getCurrentProject(): string;

  // 종료
  shutdown(): Promise<void>;
}

interface BotState {
  name: string;
  config: BotConfig;
  status: 'idle' | 'busy' | 'error' | 'starting';
  currentTask?: string;
  process: BotProcess | null;
  telegramBotUsername: string;   // Telegram bot username (@xxx_bot)
  telegramBotToken: string;      // 개별 봇 토큰
}
```

#### dispatch 흐름

```typescript
async function dispatch(route: RouteResult): Promise<void> {
  // 1. botState = getBot(route.target)
  // 2. if botState.status === 'busy'
  //    → queueManager.enqueue(route.target, route)
  //    → Telegram에 "대기열에 추가됨 (N번째)" 메시지
  //    → return
  // 3. botState.status = 'busy'
  //    botState.currentTask = route.text.slice(0, 50)
  // 4. sessionId = sessionStore.get(currentProject, route.target)
  // 5. process = spawnBotProcess({
  //      botConfig: botState.config,
  //      projectDir: projects/{currentProject},
  //      sessionId,
  //      message: route.text,
  //    })
  // 6. process.onEvent → handleStreamEvent (Telegram 업데이트)
  // 7. process.onComplete → handleComplete (세션 저장, 대기열 처리, 핸드오프 체크)
  // 8. process.onError → handleError (상태 복구, 에러 메시지 전송)
}
```

#### Telegram 실시간 업데이트 전략

```typescript
function handleStreamEvent(botState: BotState, event: StreamEvent): void {
  // 텍스트 이벤트 누적:
  // - buffer에 event.content 추가
  // - 첫 이벤트: Telegram 메시지 신규 생성 (messageId 저장)
  // - 이후: 300ms debounce로 editMessage 호출
  //   (Telegram rate limit: 초당 1회 edit 제한 존중)
  // - 최종 완료 시: 마지막 editMessage로 전체 텍스트 전송
  //
  // 편집 debounce:
  // - lastEditTime 기록
  // - 300ms 미경과 시 타이머 예약
  // - 타이머 실행 시 현재 buffer 상태로 edit
}
```

---

### 1.9 EventBus (`src/core/event-bus.ts`)

```typescript
import { EventEmitter } from 'node:events';

type HubEvent =
  | { type: 'bot:message'; from: string; to: string; text: string }
  | { type: 'bot:complete'; bot: string; output: string; sessionId: string }
  | { type: 'bot:error'; bot: string; error: string }
  | { type: 'bot:handoff'; from: string; to: string; task: string }
  | { type: 'queue:enqueued'; bot: string; position: number }
  | { type: 'queue:dequeued'; bot: string; item: QueueItem }
  | { type: 'health:timeout'; bot: string }
  | { type: 'config:reloaded'; config: HubConfig }
  | { type: 'project:switched'; from: string; to: string };

interface EventBus {
  emit(event: HubEvent): void;
  on<T extends HubEvent['type']>(
    type: T,
    handler: (event: Extract<HubEvent, { type: T }>) => void,
  ): void;
  off(type: HubEvent['type'], handler: Function): void;
}

function createEventBus(): EventBus
// - 내부 EventEmitter 래핑
// - maxListeners: 50 (봇 수 × 이벤트 수 고려)
// - 모든 emit에 로그 기록 (debug level)
```

---

### 1.10 QueueManager (`src/core/queue.ts`)

```typescript
interface QueueManager {
  enqueue(botName: string, route: RouteResult): number;  // position 반환
  dequeue(botName: string): RouteResult | null;
  peek(botName: string): RouteResult | null;
  size(botName: string): number;
  clear(botName: string): void;
  clearAll(): void;
}

function createQueueManager(): QueueManager
// - Map<string, RouteResult[]> — 봇별 FIFO 큐
// - enqueue: push + EventBus emit('queue:enqueued')
// - dequeue: shift + EventBus emit('queue:dequeued')
// - 큐 크기 제한: 봇당 최대 10개 (초과 시 거부 + 사용자 알림)
```

---

### 1.11 Handoff Detection (`src/bot/handoff.ts`)

```typescript
interface HandoffRequest {
  from: string;       // 요청한 봇
  to: string;         // 대상 봇
  task: string;       // 전달할 작업 내용
}

interface HandoffDetector {
  detect(botName: string, output: string): HandoffRequest | null;
}

function createHandoffDetector(triggerMap: Map<string, string>): HandoffDetector
```

#### 감지 패턴

```typescript
// Pattern 1: stdout에서 #봇이름 패턴
// 예: "이 부분은 개발이 필요합니다. #용훈 이 API를 구현해주세요."
// 정규식: /#(\S+)\s+(.+)/
// → triggerMap에서 매칭 → HandoffRequest

// Pattern 2: 구조화된 핸드오프 (향후 custom tool)
// Claude CLI stdout에서 tool_use 이벤트 감지
// tool name: "handoff"
// input: { to: "용훈", task: "API 구현" }

// 감지 후 처리:
// 1. EventBus.emit('bot:handoff', { from, to, task })
// 2. Router가 이벤트 수신 → dispatch({ target: to, text: task, ... })
// 3. 원본 봇에게 "핸드오프 완료: {to}에게 전달됨" 메시지
```

---

### 1.12 System Commands (`src/core/commands.ts`)

```typescript
interface CommandHandler {
  execute(command: SystemCommand, args: string[], chatId: number): Promise<void>;
}

function createCommandHandler(
  botManager: BotManager,
  sessionStore: SessionStore,
  telegramAdapter: TelegramAdapter,
): CommandHandler
```

#### 명령별 동작

```typescript
// #상태
async function handleStatus(chatId: number): Promise<void>
// 출력 예시:
// 📂 현재 프로젝트: marketing-seunghun
// ├ 🔬 제헌(리서치): 경쟁사 분석 중... ⏳
// ├ 💻 용훈(개발): 대기 💤
// ├ 📣 승훈(마케팅): 카피 작성 완료 ✅
// └ 📋 승주(비서): 대기 💤
// 대기열: 1건 (제헌 → "시장 규모 조사")

// #프로젝트
async function handleProjectList(chatId: number): Promise<void>
// projects/ 디렉토리 스캔 → 프로젝트 목록 출력
// 현재 활성 프로젝트에 ✅ 표시

// #전환 {projectName}
async function handleSwitch(projectName: string, chatId: number): Promise<void>
// 1. 프로젝트 디렉토리 존재 확인
// 2. 없으면 생성 (+ sessions.json 초기화)
// 3. botManager.switchProject(projectName)
// 4. "프로젝트 전환 완료: {projectName}" 메시지

// #클리어
async function handleClear(chatId: number): Promise<void>
// 1. 가장 최근 활성 봇 세션 클리어
// 2. 또는 reply로 특정 봇 지정 시 해당 봇만 클리어
// 3. sessionStore에서 sessionId 삭제
// 4. "세션 초기화 완료: {botName}" 메시지

// #전체클리어
async function handleClearAll(chatId: number): Promise<void>
// 1. 모든 봇 프로세스 kill
// 2. sessionStore 전체 초기화
// 3. "전체 세션 초기화 완료" 메시지

// #끝
async function handleEnd(chatId: number): Promise<void>
// 1. 현재 busy인 봇 프로세스만 kill (세션은 유지)
// 2. 상태를 idle로 변경
// 3. "활성 작업 종료 완료" 메시지
```

---

### 1.13 SessionStore (`src/store/session.ts`)

```typescript
interface SessionStore {
  get(project: string, botName: string): string | null;  // sessionId
  set(project: string, botName: string, sessionId: string): void;
  delete(project: string, botName: string): void;
  deleteAll(project: string): void;
  getAll(project: string): Record<string, { sessionId: string; lastActive: string }>;
}

function createSessionStore(baseDir: string): SessionStore
// - 파일: {baseDir}/{project}/sessions.json
// - 읽기: 파일 없으면 빈 객체 반환
// - 쓰기: JSON.stringify + fs.writeFileSync (atomic write via temp file + rename)
// - lastActive: set 호출 시 자동 갱신
```

---

### 1.14 HealthMonitor (`src/monitor/health.ts`)

```typescript
interface HealthMonitor {
  start(): void;
  stop(): void;
  recordActivity(botName: string): void;  // 이벤트 수신 시 호출
}

function createHealthMonitor(
  config: HubConfig,
  eventBus: EventBus,
  telegramAdapter: TelegramAdapter,
): HealthMonitor
// - 봇별 lastActivityTime 추적
// - 1분 간격 체크: Date.now() - lastActivityTime > healthTimeoutMs?
// - 타임아웃 감지 시:
//   1. EventBus.emit('health:timeout', { bot: botName })
//   2. Telegram에 인라인 키보드 전송:
//      "⚠️ {botName} 3분간 응답 없음"
//      [재시작] [중단] [무시]
// - recordActivity: busy 상태 봇의 stdout 이벤트마다 호출
// - idle 봇은 모니터링 대상에서 제외
```

---

### 1.15 ResponseFormatter (`src/telegram/formatter.ts`)

```typescript
interface ResponseFormatter {
  send(chatId: number, botName: string, text: string, replyTo?: number): Promise<void>;
}

function createResponseFormatter(
  adapter: TelegramAdapter,
  config: HubConfig,
): ResponseFormatter
// 판단 기준:
// - text.length <= config.settings.longResponseThreshold → Telegram 메시지
// - text.length > threshold → .md 파일 생성 후 sendFile
//
// 파일 생성:
// - 경로: /tmp/telehub-{botName}-{timestamp}.md
// - 캡션: "{botName}의 응답 (파일로 전환됨)"
// - 전송 후 파일 삭제 (setTimeout 10초)
//
// 메시지 prefix:
// - "{botConfig.color} **{botName}**: " + text
// - reply 시 replyToMessageId 설정
```

---

### 1.16 App Entry (`src/app.ts`)

```typescript
async function main(): Promise<void> {
  // 1. .env 로드 (dotenv)
  // 2. loadConfig('hub-config.json')
  // 3. Logger 생성
  // 4. EventBus 생성
  // 5. TelegramAdapter 생성 (각 봇 토큰으로 봇 목록 등록)
  //    - Hub 봇 토큰: process.env.HUB_BOT_TOKEN
  //    - 각 봇 토큰: process.env.BOT_TOKEN_{NAME}
  //    NOTE: 모든 봇 메시지는 Hub 봇 하나로 전송 (MVP)
  //    향후: 봇별 개별 토큰으로 분리 가능
  // 6. MessageParser 생성 (triggerMap)
  // 7. SessionStore 생성
  // 8. QueueManager 생성
  // 9. BotManager 생성
  // 10. Router 생성
  // 11. CommandHandler 생성
  // 12. HealthMonitor 생성
  // 13. ResponseFormatter 생성
  // 14. ConfigWatcher 생성 + 시작
  // 15. 메시지 핸들러 등록:
  //     adapter.onMessage → parser.parse → router.route / command.execute
  // 16. adapter.start()
  // 17. graceful shutdown 등록:
  //     SIGINT/SIGTERM → botManager.shutdown → adapter.stop
}
```

#### 의존성 주입 순서 (Dependency Graph)

```
Logger ──────────────────────────────────────────────┐
Config ──────────────────────────────────────────────┤
EventBus ────────────────────────────────────────────┤
TelegramAdapter(Config, Logger) ─────────────────────┤
MessageParser(Config) ───────────────────────────────┤
SessionStore(Config) ────────────────────────────────┤
QueueManager(EventBus) ──────────────────────────────┤
ResponseFormatter(TelegramAdapter, Config) ──────────┤
BotManager(Config, SessionStore, QueueManager,       │
           EventBus, ResponseFormatter, Logger) ─────┤
HandoffDetector(Config) ─────────────────────────────┤
Router(BotManager, HandoffDetector, Config) ─────────┤
CommandHandler(BotManager, SessionStore, Adapter) ────┤
HealthMonitor(Config, EventBus, Adapter) ─────────────┤
ConfigWatcher(Config path, EventBus) ─────────────────┤
App(all above) ──────────────────────────────────────┘
```

---

## 2. Data Flow Diagrams

### 2.1 Keyword Message (`#제헌 조사해줘`)

```
User → Telegram → TelegramAdapter.onMessage
  → MessageParser.parse
    → { type: 'keyword', botName: '김제헌', text: '조사해줘' }
  → Router.route
    → { target: '김제헌', text: '조사해줘', source: 'keyword' }
  → BotManager.dispatch
    → 김제헌.status === 'idle'?
      Yes → spawnBotProcess({ sessionId, message: '조사해줘' })
           → stdout stream → ResponseFormatter.send → Telegram
           → onComplete → sessionStore.set + queue.dequeue
      No  → QueueManager.enqueue('김제헌', route)
           → Telegram: "대기열 추가됨 (2번째)"
```

### 2.2 Broadcast (`#얘들아 경쟁사 분석하자`)

```
User → Telegram → Parser
  → { type: 'broadcast', text: '경쟁사 분석하자' }
  → Router.classifyBroadcast('경쟁사 분석하자', bots)
    → Claude CLI 일회용 spawn → "김제헌" (리서치 역할 매칭)
  → BotManager.dispatch({ target: '김제헌', text: '경쟁사 분석하자' })
  → (일반 dispatch 흐름)
```

### 2.3 Handoff (`제헌 → 용훈`)

```
김제헌 Claude CLI stdout:
  "경쟁사 분석 완료. #용훈 이 데이터 기반으로 API를 설계해주세요."

BotProcess.onEvent → HandoffDetector.detect
  → { from: '김제헌', to: '김용훈', task: '이 데이터 기반으로 API를 설계해주세요.' }
  → EventBus.emit('bot:handoff')
  → Router가 수신 → BotManager.dispatch({ target: '김용훈', ... })
  → Telegram: "🔄 김제헌 → 김용훈: 핸드오프 전달됨"
```

### 2.4 Project Switch (`#전환 new-project`)

```
User → Parser → { type: 'system', command: '전환', args: ['new-project'] }
  → CommandHandler.handleSwitch('new-project')
    1. 기존 프로젝트 봇 프로세스 전부 kill (세션 유지)
    2. botManager.switchProject('new-project')
       → sessionStore 경로 변경
       → 봇 상태 전부 idle로 리셋
    3. Telegram: "📂 프로젝트 전환: new-project"
```

---

## 3. Error Handling Strategy

### 3.1 에러 분류 & 복구

| Error | Category | Recovery |
|-------|----------|----------|
| Claude CLI crash (exit code ≠ 0) | 봇 프로세스 | status → 'error', sessionId 보존, 사용자에게 알림 + 자동 재시도 1회 |
| Claude CLI `--resume` 실패 | 세션 | sessionId 삭제 → 새 세션으로 재시도 |
| stdout JSON 파싱 실패 | 스트리밍 | 해당 라인 무시, 로그 남김, 다음 이벤트 계속 처리 |
| Telegram API 429 (rate limit) | 네트워크 | 지수 백오프 (1s → 2s → 4s), 최대 3회 |
| Telegram API 기타 에러 | 네트워크 | 로그 + 무시 (봇 프로세스는 계속) |
| Config 유효성 실패 (hot-reload) | 설정 | 이전 config 유지, 경고 로그 |
| 파일 I/O 에러 (session.json) | 스토리지 | 인메모리 fallback, 다음 기회에 재시도 |
| 봇 프로세스 OOM | 리소스 | SIGKILL 감지 → 상태 리셋, 사용자 알림 |

### 3.2 Graceful Shutdown

```typescript
// SIGINT/SIGTERM 수신 시:
async function gracefulShutdown(): Promise<void> {
  // 1. 새 메시지 수신 중단 (adapter.stop polling)
  // 2. 진행 중인 봇 프로세스에 SIGTERM
  // 3. 5초 대기 (응답 완료 기회)
  // 4. 남은 프로세스 SIGKILL
  // 5. 세션 상태 저장
  // 6. 프로세스 종료
}
```

---

## 4. Environment Variables

```bash
# .env
HUB_BOT_TOKEN=123456:ABC-DEF          # Hub 봇 토큰 (메시지 수신/발신)
TELEGRAM_GROUP_CHAT_ID=-100123456789  # 대상 그룹챗 ID

# 봇별 개별 토큰 (향후 개별 봇 발신용, MVP에서는 Hub 토큰만 사용)
# BOT_TOKEN_JEHEON=...
# BOT_TOKEN_YONGHUN=...
# BOT_TOKEN_SEUNGHUN=...
# BOT_TOKEN_SEUNGJU=...

# 선택
LOG_LEVEL=info                         # debug | info | warn | error
NODE_ENV=production
```

#### MVP 봇 토큰 전략

MVP에서는 **Hub 봇 하나의 토큰**으로 모든 메시지를 수신/발신한다.
- 장점: 설정 간단, BotFather 토큰 1개만 필요
- 단점: 모든 봇 메시지가 같은 발신자 (이름으로 구분)
- 향후: 봇별 개별 토큰 → 각 봇이 자기 이름으로 메시지 전송

---

## 5. hub-config.json Example

```json
{
  "telegram": {
    "groupChatId": "-100123456789"
  },
  "bots": [
    {
      "name": "김제헌",
      "role": "리서치",
      "triggers": ["제헌", "ㅈㅎ", "리서치"],
      "systemPrompt": "당신은 리서치 전문가 김제헌입니다. 시장 분석, 경쟁사 조사, 트렌드 리서치를 담당합니다. 항상 한국어로 답변하세요.",
      "workDir": "research",
      "color": "🔬"
    },
    {
      "name": "김용훈",
      "role": "개발",
      "triggers": ["용훈", "ㅇㅎ", "개발"],
      "systemPrompt": "당신은 개발자 김용훈입니다. 코드 작성, API 설계, 기술 구현을 담당합니다. 항상 한국어로 답변하세요.",
      "workDir": "dev",
      "color": "💻"
    },
    {
      "name": "김승훈",
      "role": "마케팅",
      "triggers": ["승훈", "마케팅"],
      "systemPrompt": "당신은 마케팅 전문가 김승훈입니다. 카피라이팅, 마케팅 전략, 콘텐츠 기획을 담당합니다. 항상 한국어로 답변하세요.",
      "workDir": "marketing",
      "color": "📣"
    },
    {
      "name": "김승주",
      "role": "비서",
      "triggers": ["승주", "비서"],
      "systemPrompt": "당신은 비서 김승주입니다. 일정 관리, 문서 정리, 회의록 작성을 담당합니다. hub-config.json을 수정하여 새 봇을 추가할 수 있습니다. 항상 한국어로 답변하세요.",
      "workDir": "assistant",
      "color": "📋"
    }
  ],
  "projects": {
    "default": "general",
    "baseDir": "./projects"
  },
  "settings": {
    "healthTimeoutMs": 180000,
    "longResponseThreshold": 3000,
    "pollingInterval": 300,
    "maxConcurrentBots": 4
  }
}
```

---

## 6. Implementation Order

> Plan 문서 Phase 1-4를 상세화한 구현 순서. 각 단계별 의존성을 반영.

### Step 1: 프로젝트 초기화
- `pnpm init` + TypeScript + ESLint 설정
- `package.json` scripts: `dev`, `build`, `start`
- `.env` 파일 + `.gitignore`
- **검증**: `pnpm dev` 실행 확인

### Step 2: Config + Logger
- `src/config/schema.ts` — Zod 스키마, loadConfig, validateConfig, buildTriggerMap
- `src/utils/logger.ts` — createLogger
- `hub-config.json` — 예시 설정 파일
- **검증**: config 로딩 + 유효성 검증 + 로그 출력

### Step 3: TelegramAdapter + MessageParser
- `src/telegram/adapter.ts` — createTelegramAdapter
- `src/telegram/parser.ts` — createMessageParser
- **검증**: Telegram 그룹챗 메시지 수신 → 파싱 → 로그 출력

### Step 4: BotProcess + BotManager + SessionStore
- `src/bot/process.ts` — spawnBotProcess, parseStreamLine
- `src/bot/manager.ts` — createBotManager
- `src/store/session.ts` — createSessionStore
- **검증**: `#제헌 안녕` → Claude CLI 실행 → 응답 수신

### Step 5: Router + EventBus + ResponseFormatter
- `src/core/router.ts` — createRouter
- `src/core/event-bus.ts` — createEventBus
- `src/telegram/formatter.ts` — createResponseFormatter
- **검증**: 전체 메시지 흐름 (수신 → 파싱 → 라우팅 → 응답)

### Step 6: QueueManager + Handoff
- `src/core/queue.ts` — createQueueManager
- `src/bot/handoff.ts` — createHandoffDetector
- **검증**: 동시 요청 대기열 + 봇간 핸드오프

### Step 7: System Commands + HealthMonitor + ConfigWatcher
- `src/core/commands.ts` — createCommandHandler
- `src/monitor/health.ts` — createHealthMonitor
- `src/config/watcher.ts` — createConfigWatcher
- **검증**: #상태, #전환, #클리어 + 3분 타임아웃 + config 핫리로드

### Step 8: App Assembly + pm2
- `src/app.ts` — main()
- `ecosystem.config.js` — pm2 설정
- **검증**: `pm2 start` → 24시간 안정 운영

---

## 7. Validation Checklist

| ID | Item | Step | Method |
|----|------|------|--------|
| V1 | `#제헌 안녕` → 김제헌 봇 응답 | Step 4 | 수동 테스트 |
| V2 | `#ㅈㅎ 조사해줘` → 김제헌 봇 응답 (초성 트리거) | Step 5 | 수동 |
| V3 | Reply → 해당 봇 라우팅 | Step 5 | 수동 |
| V4 | `#얘들아 분석하자` → Hub 분류 → 적절한 봇 | Step 5 | 수동 |
| V5 | 봇 바쁠 때 대기열 → 완료 후 처리 | Step 6 | 동시 2건 요청 |
| V6 | 핸드오프 (#용훈 패턴) | Step 6 | 리서치→개발 시나리오 |
| V7 | `#상태` → 대시보드 정확 표시 | Step 7 | 수동 |
| V8 | `#전환` → 프로젝트 전환 + 세션 복원 | Step 7 | 수동 |
| V9 | `#클리어` → 세션 초기화 | Step 7 | 수동 |
| V10 | 3분 무응답 → 알림 | Step 7 | 봇 멈춤 시뮬레이션 |
| V11 | 긴 응답 → 파일 자동 전환 | Step 5 | 긴 리서치 요청 |
| V12 | hub-config.json 수정 → 핫리로드 | Step 7 | 파일 수정 |
| V13 | pm2 24시간 안정 운영 | Step 8 | 로그 확인 |

---

## Next Step

`/pdca do telehub` — 이 Design을 기반으로 구현 시작
