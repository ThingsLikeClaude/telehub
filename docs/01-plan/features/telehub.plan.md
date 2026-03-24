# TeleHub — Plan Document

> Feature: telehub
> Phase: Plan
> Created: 2026-03-24
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
| **Problem** | 기존 cokacdir(Rust 8,683줄)는 파일 폴링 5초 지연, 봇간 협업 불가, 유지보수 한계 |
| **Solution** | Node.js Hub가 Claude CLI subprocess들을 오케스트레이션, EventEmitter 인메모리 통신으로 실시간 봇간 협업 |
| **Function/UX Effect** | `#봇이름` 한마디로 즉시 호출, reply로 자연 대화, `#얘들아`로 자동 분류/배분, 프로젝트별 세션 유지 |
| **Core Value** | AI 봇들이 진짜 팀원처럼 Telegram 그룹챗에서 협업하는 경험 |

---

## 1. Goals & Scope

### 1.1 Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | 4+ 봇이 단일 그룹챗에서 독립 응답 | 라우팅 정확도 100% |
| G2 | 봇간 자동 핸드오프 작동 | 핸드오프 성공률 95%+ |
| G3 | 요청 대기열로 메시지 누락 0건 | 100건 연속 처리 시 누락 0 |
| G4 | 프로젝트별 세션 영속성 | 프로젝트 전환 후 컨텍스트 유지 |
| G5 | macOS pm2 안정 운영 | 24시간 무중단 |

### 1.2 In Scope (MVP)

- Multi-Bot Orchestration (F1) — 4봇 동시 운영
- Smart Routing (F2) — `#이름`, reply, `#얘들아`
- Bot-to-Bot Handoff (F3) — stdout 패턴 + custom tool
- Request Queue (F4) — per-bot 대기열
- Session Persistence (F5) — 프로젝트별 --resume
- Health Monitoring (F6) — 3분 heartbeat
- Long Response Handling (F7) — 자동 파일 전환
- Hot-Reload Config (F8) — fs.watch

### 1.3 Out of Scope

- EC2/클라우드 배포
- Docker 컨테이너화
- 사용자 권한 분리
- Webhook (polling으로 시작)
- 토큰 암호화 (신뢰 환경)
- DM(1:1) 지원

---

## 2. Technical Stack

| Category | Choice | Reason |
|----------|--------|--------|
| **Runtime** | Node.js (TypeScript) | 빠른 개발, Claude CLI subprocess 관리 용이 |
| **AI Engine** | Claude CLI subprocess | 구독 기반(API 비용 0), 모든 빌트인 도구 사용 가능 |
| **Telegram** | `node-telegram-bot-api` | 경량, polling 지원, 충분한 기능 |
| **Process** | pm2 | macOS 백그라운드, 자동 재시작 |
| **Config Watch** | `chokidar` | fs.watch보다 안정적인 크로스 플랫폼 |
| **Build** | tsx (esbuild) | TypeScript 직접 실행, 빠른 개발 사이클 |
| **Package Manager** | pnpm | 빠르고 디스크 효율적 |

---

## 3. Architecture

### 3.1 High-Level Architecture

```
Telegram Group Chat
        │
        ▼
┌─────────────────────────────────────────────┐
│  TeleHub (Node.js, single process, pm2)     │
│                                              │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ TelegramAdapter│→ │ MessageParser     │    │
│  │ (polling)     │   │ (#prefix/reply/   │    │
│  └──────────────┘   │  system cmd)      │    │
│                      └────────┬─────────┘    │
│                               ▼              │
│                      ┌──────────────────┐    │
│                      │ Router            │    │
│                      │ keyword/reply/    │    │
│                      │ broadcast         │    │
│                      └────────┬─────────┘    │
│                               ▼              │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ QueueManager  │←→│ BotManager        │    │
│  │ (per-bot)     │   │ spawn/resume/kill │    │
│  └──────────────┘   └────────┬─────────┘    │
│                               ▼              │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ EventBus      │   │ Claude CLI ×N     │    │
│  │ (EventEmitter)│←→│ (subprocess)      │    │
│  └──────────────┘   └──────────────────┘    │
│                                              │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ SessionStore  │   │ HealthMonitor     │    │
│  │ (JSON files)  │   │ (heartbeat 3min)  │    │
│  └──────────────┘   └──────────────────┘    │
│                                              │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ ConfigWatcher │   │ ResponseFormatter │    │
│  │ (chokidar)    │   │ (msg/file switch) │    │
│  └──────────────┘   └──────────────────┘    │
└─────────────────────────────────────────────┘
```

### 3.2 Module Breakdown

| Module | File | Responsibility | Lines (Est.) |
|--------|------|---------------|-------------|
| TelegramAdapter | `src/telegram/adapter.ts` | Telegram polling, 메시지 수신/발신 | ~150 |
| MessageParser | `src/telegram/parser.ts` | #prefix, reply, system command 파싱 | ~100 |
| Router | `src/core/router.ts` | 메시지 라우팅 결정 (keyword/reply/broadcast) | ~150 |
| BotManager | `src/bot/manager.ts` | Claude CLI subprocess 생명주기 관리 | ~200 |
| BotProcess | `src/bot/process.ts` | 개별 Claude CLI 프로세스 래핑 | ~150 |
| EventBus | `src/core/event-bus.ts` | EventEmitter 기반 봇간 통신 | ~80 |
| QueueManager | `src/core/queue.ts` | Per-bot 요청 대기열 | ~100 |
| SessionStore | `src/store/session.ts` | 프로젝트별 세션 JSON 관리 | ~100 |
| HealthMonitor | `src/monitor/health.ts` | stdout heartbeat 감시, 3분 타임아웃 | ~100 |
| ResponseFormatter | `src/telegram/formatter.ts` | 짧은 응답→메시지, 긴 응답→파일 | ~80 |
| ConfigWatcher | `src/config/watcher.ts` | hub-config.json 핫 리로드 | ~80 |
| Config | `src/config/schema.ts` | 설정 타입 정의, 유효성 검증 | ~60 |
| Logger | `src/utils/logger.ts` | 구조화된 로깅 | ~50 |
| App | `src/app.ts` | 메인 엔트리, DI 조립 | ~80 |
| **Total** | | | **~1,480** |

### 3.3 Message Flow

```
1. Telegram Message 수신
   │
   ▼
2. MessageParser: 메시지 유형 판별
   ├── #봇이름 → KeywordRoute { bot, message }
   ├── #얘들아 → BroadcastRoute { message }
   ├── #상태/#전환/... → SystemCommand { command, args }
   ├── Reply to bot msg → ReplyRoute { bot, message }
   └── 기타 → Ignore (사람간 대화)
   │
   ▼
3. Router: 대상 봇 결정
   ├── Keyword/Reply → 직접 라우팅
   └── Broadcast → Hub Claude CLI로 분류 → 적절한 봇 선택
   │
   ▼
4. QueueManager: 대상 봇 상태 확인
   ├── Idle → 즉시 처리
   └── Busy → 대기열에 추가, 완료 후 순차 처리
   │
   ▼
5. BotManager: Claude CLI 실행
   ├── 세션 있음 → --resume sessionId
   └── 세션 없음 → 새 세션 시작
   │
   ▼
6. Claude CLI stdout 스트리밍
   ├── stream-json 파싱 → Telegram 실시간 업데이트
   ├── #핸드오프패턴 감지 → Router에 핸드오프 요청
   └── 3분 무이벤트 → HealthMonitor 알림
   │
   ▼
7. ResponseFormatter: 응답 전송
   ├── 짧은 텍스트 → Telegram 메시지
   └── 긴 텍스트 → .md 파일 첨부
```

---

## 4. Data Model

### 4.1 hub-config.json

```typescript
interface HubConfig {
  telegram: {
    groupChatId: string;
  };
  bots: BotConfig[];
  projects: {
    default: string;       // 기본 프로젝트명
    baseDir: string;       // 프로젝트 루트 경로
  };
  settings: {
    healthTimeoutMs: number;    // 기본 180000 (3분)
    longResponseThreshold: number; // 기본 3000 (chars)
    pollingInterval: number;    // Telegram polling (ms)
  };
}

interface BotConfig {
  name: string;           // "김제헌"
  role: string;           // "리서치"
  triggers: string[];     // ["제헌", "ㅈㅎ", "리서치"]
  systemPrompt: string;   // 봇 역할 프롬프트
  workDir: string;        // "research/"
  color: string;          // Emoji prefix for messages
}
```

### 4.2 Session Store

```typescript
// projects/{name}/sessions.json
interface SessionMap {
  [botName: string]: {
    sessionId: string;
    lastActive: string;    // ISO timestamp
    status: 'idle' | 'busy' | 'error';
  };
}
```

### 4.3 Internal Types

```typescript
type ParsedMessage =
  | { type: 'keyword'; bot: string; text: string; chatId: number; messageId: number }
  | { type: 'reply'; bot: string; text: string; chatId: number; messageId: number }
  | { type: 'broadcast'; text: string; chatId: number; messageId: number }
  | { type: 'system'; command: string; args: string[]; chatId: number; messageId: number }
  | { type: 'ignore' };

interface QueueItem {
  id: string;
  message: ParsedMessage;
  enqueuedAt: string;
}

interface BotState {
  name: string;
  status: 'idle' | 'busy' | 'error' | 'starting';
  currentTask?: string;
  queue: QueueItem[];
  process?: ChildProcess;
}
```

---

## 5. Implementation Plan

### Phase 1: Foundation (Day 1-3)

| Order | Task | File(s) | Dependencies |
|-------|------|---------|-------------|
| 1.1 | 프로젝트 초기화 (pnpm, tsconfig, eslint) | `package.json`, `tsconfig.json` | - |
| 1.2 | Config 스키마 & 로딩 | `src/config/schema.ts` | 1.1 |
| 1.3 | Logger 유틸리티 | `src/utils/logger.ts` | 1.1 |
| 1.4 | TelegramAdapter (polling, send) | `src/telegram/adapter.ts` | 1.1 |
| 1.5 | MessageParser (#prefix, reply, system) | `src/telegram/parser.ts` | 1.4 |
| **Checkpoint** | Telegram 메시지 수신/파싱 확인 | | |

### Phase 2: Core Bot Management (Day 4-7)

| Order | Task | File(s) | Dependencies |
|-------|------|---------|-------------|
| 2.1 | BotProcess (Claude CLI 래핑) | `src/bot/process.ts` | 1.3 |
| 2.2 | BotManager (spawn/resume/kill) | `src/bot/manager.ts` | 2.1, 1.2 |
| 2.3 | SessionStore (JSON 저장/로드) | `src/store/session.ts` | 1.2 |
| 2.4 | Router (keyword/reply 라우팅) | `src/core/router.ts` | 1.5, 2.2 |
| 2.5 | EventBus (봇간 통신) | `src/core/event-bus.ts` | - |
| **Checkpoint** | `#봇이름` 호출 → Claude 응답 수신 확인 | | |

### Phase 3: Advanced Features (Day 8-11)

| Order | Task | File(s) | Dependencies |
|-------|------|---------|-------------|
| 3.1 | QueueManager (per-bot 대기열) | `src/core/queue.ts` | 2.2 |
| 3.2 | Broadcast Router (`#얘들아` 분류) | `src/core/router.ts` (확장) | 2.4, 2.1 |
| 3.3 | Handoff 감지 & 라우팅 | `src/bot/handoff.ts` | 2.1, 2.4 |
| 3.4 | ResponseFormatter (메시지/파일 전환) | `src/telegram/formatter.ts` | 1.4 |
| 3.5 | System Commands (#상태, #전환, #클리어) | `src/core/commands.ts` | 2.2, 2.3 |
| **Checkpoint** | 핸드오프, 대기열, 시스템 명령 작동 확인 | | |

### Phase 4: Stability & Polish (Day 12-14)

| Order | Task | File(s) | Dependencies |
|-------|------|---------|-------------|
| 4.1 | HealthMonitor (heartbeat 감시) | `src/monitor/health.ts` | 2.1 |
| 4.2 | ConfigWatcher (핫 리로드) | `src/config/watcher.ts` | 1.2 |
| 4.3 | App 엔트리 (DI 조립) | `src/app.ts` | All |
| 4.4 | pm2 ecosystem.config.js | `ecosystem.config.js` | 4.3 |
| 4.5 | 통합 테스트 & 버그 수정 | - | All |
| **Checkpoint** | pm2 백그라운드 안정 운영 확인 | | |

---

## 6. File Structure

```
telehub/
├── package.json
├── tsconfig.json
├── .env                        # BOT_TOKEN_*, GROUP_CHAT_ID
├── ecosystem.config.js         # pm2 config
├── hub-config.json             # Bot definitions, triggers, settings
├── src/
│   ├── app.ts                  # Main entry, DI assembly
│   ├── config/
│   │   ├── schema.ts           # Config types & validation
│   │   └── watcher.ts          # Hot-reload via chokidar
│   ├── telegram/
│   │   ├── adapter.ts          # Polling, send message/file
│   │   ├── parser.ts           # Message parsing (#, reply, system)
│   │   └── formatter.ts        # Response length → msg or file
│   ├── core/
│   │   ├── router.ts           # Routing logic (keyword/reply/broadcast)
│   │   ├── event-bus.ts        # EventEmitter for bot comms
│   │   ├── queue.ts            # Per-bot request queue
│   │   └── commands.ts         # System commands (#상태, #전환, ...)
│   ├── bot/
│   │   ├── manager.ts          # Bot lifecycle (spawn/resume/kill)
│   │   ├── process.ts          # Claude CLI subprocess wrapper
│   │   └── handoff.ts          # Handoff pattern detection
│   ├── store/
│   │   └── session.ts          # Project-based session JSON
│   ├── monitor/
│   │   └── health.ts           # Heartbeat monitoring
│   └── utils/
│       └── logger.ts           # Structured logging
├── projects/                    # Runtime: project working dirs
│   └── {project-name}/
│       ├── sessions.json
│       └── {bot-workdir}/
├── logs/                        # Runtime: Hub logs
└── docs/
    ├── 00-pm/
    │   └── telehub.prd.md
    └── 01-plan/
        └── features/
            └── telehub.plan.md
```

---

## 7. Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Claude CLI `--resume` 세션 깨짐 | 높 | 중 | 세션 재생성 fallback, 에러 시 자동 새 세션 |
| Claude CLI stdout 파싱 실패 | 중 | 중 | stream-json 포맷 정규화, raw text fallback |
| 동시 4봇 CPU/메모리 부하 | 중 | 중 | 유휴 봇 프로세스 정리, 동시 실행 수 제한 옵션 |
| `#얘들아` 분류 정확도 낮음 | 중 | 중 | 분류 프롬프트 반복 튜닝, 사용자 확인 모드 |
| Telegram Rate Limit | 낮 | 낮 | 메시지 배치 전송, 429 에러 시 지수 백오프 |
| node-telegram-bot-api 라이브러리 이슈 | 낮 | 낮 | telegraf로 교체 가능한 Adapter 패턴 |

---

## 8. Assumptions & Dependencies

### Assumptions

- Claude CLI `--output-format stream-json`이 실시간 stdout 이벤트를 안정적으로 제공
- Claude CLI `--resume sessionId`가 세션 복원을 신뢰성 있게 수행
- Telegram reply_to_message 필드가 Bot API에서 접근 가능
- macOS 환경에서 pm2가 안정적으로 동작
- 사용자 전원이 신뢰 가능 (보안 제한 불필요)

### Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| node-telegram-bot-api | latest | Telegram Bot API |
| chokidar | latest | File watching |
| pm2 | latest | Process management |
| tsx | latest | TypeScript execution |
| zod | latest | Config validation |

---

## 9. Success Criteria

| Criteria | Metric | Target |
|----------|--------|--------|
| 라우팅 정확도 | `#이름` + reply 정확 라우팅 | 100% |
| 핸드오프 성공률 | stdout 패턴 → 올바른 봇 전달 | 95%+ |
| 메시지 누락 | 대기열 처리 후 누락 건수 | 0건 |
| 세션 복원 | 프로젝트 전환 후 컨텍스트 유지 | 100% |
| 안정성 | pm2 24시간 무중단 | 크래시 0회 |
| 응답 속도 | 메시지 수신 → 라우팅 결정 | <100ms |
| Health 감지 | 3분 무이벤트 → 알림 발생 | 100% |

---

## Next Step

`/pdca design telehub` — 이 Plan을 기반으로 상세 설계 문서 작성
