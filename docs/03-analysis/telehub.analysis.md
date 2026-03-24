# TeleHub — Gap Analysis Report

> Feature: telehub
> Phase: Check (Gap Analysis)
> Created: 2026-03-24
> Design Reference: `docs/02-design/features/telehub.design.md`

---

## Overall Match Rate: 74%

| Category | Designed | Implemented | Rate |
|----------|----------|-------------|------|
| Modules (16) | 16 | 16 files exist | 100% (structure) |
| Interfaces/Types | 100% | 88% | 88% |
| Core Functions | 30+ | 22 | 73% |
| Feature Completeness | 100% | 68% | 68% |
| Tests | - | 95 passing | - |

---

## Module-by-Module Analysis

### ✅ Fully Implemented (Design ≥ 95%)

| Module | Design Section | Status | Notes |
|--------|---------------|--------|-------|
| Config schema.ts | 1.1 | ✅ 100% | Zod 검증, loadConfig, validateConfig, buildTriggerMap 모두 구현. 중복 trigger 체크 포함 |
| Logger | 1.3 | ✅ 100% | JSON lines, level filtering, child() 구현 |
| MessageParser | 1.5 | ✅ 100% | keyword/reply/broadcast/system 파싱, 호칭접미사(아/야/이/님/씨) 제거 모두 구현 |
| EventBus | 1.9 | ✅ 100% | typed emit/on/off, maxListeners 50 |
| QueueManager | 1.10 | ✅ 100% | FIFO, max 10 제한, enqueue/dequeue/peek/size/clear/clearAll |
| HandoffDetector | 1.11 | ✅ 100% | #패턴 감지, self-handoff 방지 |
| SessionStore | 1.13 | ✅ 100% | get/set/delete/deleteAll/getAll, JSON 영속성, 디렉토리 자동 생성 |
| splitMessage | 1.15 (partial) | ✅ 100% | 4096자 분할, newline/space 경계 존중, suffix 예약 |

### ⚠️ Partially Implemented (Design 40-94%)

| Module | Design Section | Status | Implemented | Missing |
|--------|---------------|--------|-------------|---------|
| TelegramAdapter | 1.4 | ⚠️ 80% | polling, sendMessage(split), sendFile, editMessage, deleteMessage, groupChatId 필터 | 테스트 없음 (외부 API) |
| Router | 1.6 | ⚠️ 50% | keyword/reply 라우팅 | `classifyBroadcast()` — Claude CLI 일회용 spawn으로 broadcast 분류 미구현 |
| BotProcess | 1.7 | ⚠️ 30% | `parseStreamLine()` 구현 | **`spawnBotProcess()` 미구현** — Claude CLI subprocess spawn/resume/kill, stdout 스트리밍, onEvent/onComplete/onError 콜백 |
| BotManager | 1.8 | ⚠️ 40% | getBot, getAllBots, clearSession, clearAllSessions, switchProject, getCurrentProject, shutdown | **`dispatch()` 미구현** — 실제 봇에 메시지 전달 + Claude CLI 실행 + Telegram 실시간 업데이트(300ms debounce) |
| ResponseFormatter | 1.15 | ⚠️ 50% | splitMessage 함수 | **`send()` 메서드 미구현** — 길이 판단 → 메시지 or 파일 전환, 봇 이름 prefix, .md 파일 생성/전송/삭제 |
| System Commands | 1.12 | ⚠️ 70% | `formatStatusDashboard()` 구현, app.ts에서 #상태/#프로젝트/#전환/#클리어/#전체클리어/#끝 핸들링 | `#클리어` reply 기반 봇 감지 미구현, 인라인 키보드 미구현 |
| HealthMonitor | 1.14 | ⚠️ 80% | startMonitoring, stopMonitoring, recordActivity, timeout 감지 | Telegram 인라인 키보드([재시작][중단][무시]) 미구현, app.ts 연동 미완전 |
| ConfigWatcher | 1.2 | ⚠️ 80% | chokidar, debounce 500ms, onReload | 유효하지 않은 config 시 로그 경고 미구현 (현재 silent catch) |
| App Entry | 1.16 | ⚠️ 60% | DI 조립, graceful shutdown, message handler 파이프라인 | dispatch 연결 미완 (TODO 주석), broadcast 분류 미구현 |

### ❌ Missing (Design 0%)

| Item | Design Section | Impact |
|------|---------------|--------|
| `spawnBotProcess()` | 1.7 | **Critical** — 전체 봇 응답 파이프라인의 핵심. Claude CLI `--output-format stream-json` 실행 |
| `dispatch()` in BotManager | 1.8 | **Critical** — 봇에 메시지 전달, 큐 연동, 세션 복원, 응답 스트리밍 |
| `handleStreamEvent()` | 1.8 | **High** — 300ms debounce editMessage로 실시간 Telegram 업데이트 |
| `classifyBroadcast()` | 1.6 | **Medium** — `#얘들아` 메시지 Claude CLI 분류 |
| ResponseFormatter.send() | 1.15 | **High** — 메시지/파일 자동 전환 + 봇 prefix |
| Telegram 인라인 키보드 | 1.14 | **Low** — Health timeout 시 [재시작][중단][무시] 버튼 |

---

## Data Flow Gap Analysis

| Flow | Design Section | Status |
|------|---------------|--------|
| 2.1 Keyword message | 수신 → 파싱 → 라우팅 ✅ → dispatch ❌ → 응답 ❌ | ⚠️ 50% |
| 2.2 Broadcast | 수신 → 파싱 ✅ → 분류 ❌ → dispatch ❌ | ❌ 20% |
| 2.3 Handoff | 패턴 감지 ✅ → EventBus ✅ → 라우팅 연동 ❌ | ⚠️ 40% |
| 2.4 Project switch | 명령 파싱 ✅ → switchProject ✅ → 세션 전환 ✅ | ✅ 90% |

---

## Error Handling Gap (Design Section 3)

| Error | Design Recovery | Implemented |
|-------|----------------|-------------|
| Claude CLI crash | status → error, 재시도 1회 | ❌ |
| --resume 실패 | sessionId 삭제 → 새 세션 | ❌ |
| stdout JSON 파싱 | 무시 + 로그 | ✅ (parseStreamLine) |
| Telegram 429 | 지수 백오프 | ❌ |
| Config 유효성 실패 | 이전 config 유지 | ⚠️ (silent catch) |
| Graceful shutdown | SIGINT/SIGTERM 처리 | ✅ (app.ts) |

---

## Priority Fix Order

| Priority | Gap Item | Effort | Impact |
|----------|---------|--------|--------|
| **P0** | `spawnBotProcess()` | ~150줄 | 전체 봇 응답 파이프라인 활성화 |
| **P0** | `dispatch()` in BotManager | ~100줄 | 메시지→봇 실행→응답 연결 |
| **P1** | `handleStreamEvent()` + Telegram 실시간 업데이트 | ~60줄 | UX 핵심 (실시간 타이핑 효과) |
| **P1** | `ResponseFormatter.send()` | ~40줄 | 긴 응답 파일 전환 |
| **P2** | `classifyBroadcast()` | ~50줄 | `#얘들아` 기능 |
| **P2** | Handoff → Router 연동 | ~30줄 | 봇간 자동 핸드오프 |
| **P3** | Telegram 인라인 키보드 | ~30줄 | Health timeout UX |
| **P3** | Telegram 429 지수 백오프 | ~20줄 | Rate limit 방어 |

---

## Match Rate: 74%

```
[PM] ✅ → [Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] 74% 🔄 → [Act] ⏳
```

**Verdict**: 90% 미달 → `/pdca iterate telehub` 필요

---

## Next Step

P0 항목(`spawnBotProcess` + `dispatch`) 구현 시 Match Rate ~88% 예상.
P0+P1 항목 구현 시 ~93% 예상 → 90% 기준 통과.
