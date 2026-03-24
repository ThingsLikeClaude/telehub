# TeleHub — Product Requirements Document

> Generated: 2026-03-24
> Based on: PRD Seed + Interview (25 Questions)
> PM Frameworks Applied: OST, JTBD, Lean Canvas, Personas, Competitor Analysis, TAM/SAM/SOM, Beachhead, GTM

---

## Executive Summary

| Item | Detail |
|------|--------|
| **Feature** | TeleHub — Telegram Agent Teams Hub |
| **Start Date** | 2026-03-24 |
| **Target Duration** | 2-3 weeks (MVP) |
| **Level** | Dynamic |

### Results Summary

| Metric | Value |
|--------|-------|
| Core Features | 8 |
| Bot Count (Initial) | 4 |
| Target Users | 소규모 팀 (3-10명) |
| Platform | macOS + pm2 |

### Value Delivered (4-Perspective)

| Perspective | Description |
|-------------|-------------|
| **Problem** | 기존 Rust 봇(8,683줄)의 유지보수 난이도, 파일 폴링 5초 지연, 봇간 진정한 협업 불가 |
| **Solution** | Node.js 기반 Hub 오케스트레이션 + EventEmitter 인메모리 통신 + 스마트 라우팅 |
| **Function/UX Effect** | `#봇이름`으로 즉시 호출, reply로 자연스러운 대화, `#얘들아`로 자동 분류/배분 |
| **Core Value** | AI 봇들이 진짜 팀원처럼 협업하는 그룹챗 경험 — 사람-봇 경계를 허문다 |

---

## 1. Opportunity Solution Tree (Teresa Torres)

### Desired Outcome
> 소규모 팀이 AI 봇들을 Telegram에서 인간 팀원과 동등하게 활용하여 생산성을 극대화한다.

### Opportunities

```
Desired Outcome: AI 봇 = 팀원급 협업
├── O1: 봇 호출이 번거롭다 (@태깅 매번 필요)
│   ├── S1: # prefix + 부분이름 매칭
│   └── S2: Reply 라우팅 (# 불필요)
├── O2: 봇들이 서로 모른다 (독립 세션)
│   ├── S3: EventEmitter 인메모리 봇간 통신
│   └── S4: Handoff 패턴 (stdout + custom tool)
├── O3: 멀티태스킹이 안 된다 (바쁘면 거절)
│   ├── S5: Per-bot 요청 대기열
│   └── S6: 상태 대시보드 (#상태)
├── O4: 컨텍스트가 날아간다 (세션 비영속)
│   ├── S7: 프로젝트별 세션 영속성 (--resume)
│   └── S8: 프로젝트 전환 (#전환)
└── O5: 봇 상태를 모른다 (먹통인지 확인 불가)
    ├── S9: Heartbeat 모니터링 (3분 임계값)
    └── S10: 긴 응답 자동 파일 전환
```

### Experiments (MVP Validation)

| ID | Solution | Experiment | Success Metric |
|----|----------|-----------|----------------|
| E1 | S1+S2 | 4봇 그룹챗에서 호출 테스트 | 올바른 봇 라우팅 100% |
| E2 | S3+S4 | 리서치→개발 핸드오프 시나리오 | 핸드오프 성공, 지연 <1초 |
| E3 | S5+S6 | 동시 3건 요청 후 대기열 처리 | 순차 완료, 누락 0건 |
| E4 | S7+S8 | 프로젝트 전환 후 세션 복원 | 이전 컨텍스트 유지 |
| E5 | S9 | 봇 3분 무응답 시나리오 | 사용자 알림 발생 |

---

## 2. Value Proposition — JTBD 6-Part (Huryn & Abdul Rauf)

### Job Statement
> **When** 소규모 팀이 프로젝트를 진행할 때,
> **I want to** AI 봇들에게 리서치/개발/마케팅/비서 역할을 맡기고,
> **So I can** 사람처럼 자연스럽게 협업하면서 생산성을 높인다.

### 6-Part Value Proposition

| Part | Description |
|------|-------------|
| **1. Target Customer** | AI 봇을 팀원으로 활용하려는 소규모 팀 리더 |
| **2. Problem** | 기존 봇 시스템은 독립 동작 — 봇간 협업 불가, 컨텍스트 단절, 호출 번거로움 |
| **3. Promise** | Telegram 그룹챗에서 봇들이 Agent Teams처럼 협업, 컨텍스트 공유, 자동 핸드오프 |
| **4. Proof** | Claude Code Agent Teams 패턴 검증됨. cokacdir 운영 경험으로 UX 문제점 파악 완료 |
| **5. Differentiator** | Hub 오케스트레이션 + EventEmitter 실시간 통신 + 프로젝트별 세션 영속성 |
| **6. Alternatives** | cokacdir(Rust, 파일폴링), 직접 Claude API 호출(비용), ChatGPT Group(제한적) |

---

## 3. Lean Canvas (Ash Maurya)

| Block | Content |
|-------|---------|
| **Problem** | 1) 봇간 통신 5초 지연 (파일폴링)<br>2) 봇 독립세션 — 협업 불가<br>3) Rust 8,683줄 유지보수 한계 |
| **Customer Segments** | 소규모 팀 (3-10명)<br>AI 도구 적극 활용자<br>Claude Pro/Max 구독자 |
| **Unique Value Proposition** | AI 봇들이 진짜 팀원처럼 협업하는 Telegram 그룹챗 |
| **Solution** | Node.js Hub + Claude CLI subprocess<br>EventEmitter 인메모리 통신<br># prefix 스마트 라우팅 |
| **Channels** | 내부 팀 먼저 → GitHub 오픈소스 → 기술 블로그/커뮤니티 |
| **Revenue Streams** | 오픈소스 (무료)<br>Claude 구독료 사용 (별도 API 비용 없음) |
| **Cost Structure** | Claude Pro/Max 구독료<br>개발 시간 (2-3주)<br>Telegram Bot API (무료) |
| **Key Metrics** | 일일 메시지 처리 수<br>핸드오프 성공률<br>봇 응답 시간<br>세션 복원 성공률 |
| **Unfair Advantage** | cokacdir 운영 경험<br>Claude Code Agent Teams 패턴 깊은 이해<br>팀 내부 즉시 사용 가능 |

---

## 4. User Personas (JTBD-based)

### Persona 1: 팀 리더 (Primary)

| Attribute | Detail |
|-----------|--------|
| **이름** | 김동현 (가상) |
| **역할** | 소규모 팀 리더, Claude Power User |
| **배경** | 개발자 출신, AI 도구로 팀 생산성 극대화에 관심 |
| **Job** | 팀 프로젝트의 리서치/개발/마케팅을 AI에 위임하고 감독 |
| **Pain** | 매번 봇 전환 번거로움, 봇끼리 소통 불가, 컨텍스트 리셋 |
| **Gain** | `#얘들아` 한마디로 적절한 봇에 배분, 자동 핸드오프 |
| **사용 빈도** | 매일, 하루 50+ 메시지 |

### Persona 2: 팀원 (Secondary)

| Attribute | Detail |
|-----------|--------|
| **이름** | 이서연 (가상) |
| **역할** | 마케팅 담당, AI 중급 사용자 |
| **배경** | 비개발자, Telegram으로 업무 소통 |
| **Job** | AI 봇에게 카피/리서치 요청, 결과 확인 |
| **Pain** | 어떤 봇에게 물어야 하는지 헷갈림, 긴 응답 읽기 어려움 |
| **Gain** | `#얘들아`로 자동 배분, 긴 응답은 파일로 깔끔하게 전달 |
| **사용 빈도** | 주 3-4회, 하루 10-20 메시지 |

### Persona 3: AI 봇 (Internal Actor)

| Attribute | Detail |
|-----------|--------|
| **이름** | 김제헌 (리서치 봇) |
| **역할** | Claude CLI subprocess, 전문 역할 수행 |
| **Job** | 리서치 결과를 팀에 공유, 필요시 다른 봇에 핸드오프 |
| **Pain** | 다른 봇 상태 모름, 핸드오프 수단 없음 (기존 시스템) |
| **Gain** | Hub 통해 다른 봇 상태 확인 + 자동 핸드오프 |

---

## 5. Competitor Analysis

| Product | Type | Strengths | Weaknesses | TeleHub Differentiation |
|---------|------|-----------|------------|------------------------|
| **cokacdir** | Rust 멀티봇 | 검증된 봇 운영, 실사용 경험 | 8,683줄 단일파일, 파일폴링 5초 지연, 봇간 협업 불가 | Node.js 모듈화, EventEmitter 실시간 통신, Hub 오케스트레이션 |
| **ChatGPT Team** | SaaS | OpenAI 생태계, 쉬운 설정 | 커스터마이징 제한, 봇간 협업 불가, 비용 높음 | Claude CLI 전체 도구 접근, 완전 커스텀 가능, 구독료만 |
| **Slack + Claude** | 통합 | Slack 워크플로우 연동 | 멀티봇 협업 제한, Telegram 대비 모바일 UX 약함 | Telegram 네이티브, 봇간 핸드오프, 프로젝트 세션 관리 |
| **Custom API Bot** | 자체구축 | 완전 제어 가능 | API 비용 높음, 도구(Bash/Read/Write) 없음 | CLI subprocess로 모든 도구 활용, 구독료만 |
| **LangChain Agent** | 프레임워크 | 유연한 에이전트 구성 | Telegram 통합 별도, 복잡한 설정, API 비용 | 즉시 사용 가능, 간단한 config, 구독 기반 무비용 |

### Competitive Position
TeleHub은 "Claude CLI subprocess 활용 + Telegram 네이티브 멀티봇 협업" 조합에서 **유일한 포지션**을 차지한다. 핵심 차별점은 API 비용 없이 Claude의 전체 도구셋(Bash, Read, Write, Edit)을 활용할 수 있다는 점이다.

---

## 6. Market Sizing (TAM/SAM/SOM)

| Level | Segment | Size | Basis |
|-------|---------|------|-------|
| **TAM** | Claude 구독자 중 Telegram 사용자 | ~500K명 | Claude 유료 구독자 추정 2M × Telegram 사용 비율 25% |
| **SAM** | Claude + Telegram + 멀티봇 니즈 | ~25K명 | TAM의 5% — 봇 자동화 적극 활용자 |
| **SOM** | 오픈소스 초기 채택자 | ~500명 (Year 1) | SAM의 2% — GitHub 발견 + 기술 블로그 유입 |

### Sizing Method
- **Top-down**: Anthropic 유료 구독자 × Telegram 활성 사용자 비율 × 멀티봇 니즈 비율
- **Bottom-up**: cokacdir 관심자 + Claude Code Agent Teams 사용자 커뮤니티 × 전환율

> Note: 내부 도구로 시작하므로 시장 크기보다 **내부 팀 생산성 향상**이 1차 성공 기준

---

## 7. Beachhead Segment (Geoffrey Moore)

### Beachhead: Claude Power User 소규모 팀 (한국)

| Attribute | Detail |
|-----------|--------|
| **Who** | Claude Pro/Max 구독 중인 한국어 소규모 팀 (3-10명) |
| **Why This Segment** | 즉시 접근 가능 (내부 팀), 동일 페인포인트 경험, 한국어 봇 이름/트리거 최적화 |
| **Use Case** | 프로젝트별 리서치/개발/마케팅 AI 어시스턴트 팀 운영 |
| **Switching Cost** | 낮음 — Telegram 이미 사용 중, Claude 구독 보유 |
| **Word-of-Mouth** | 높음 — AI 도구 커뮤니티에서 활발한 공유 문화 |

### Expansion Path
```
Beachhead: 내부 팀 (5명)
  → 2차: 한국 AI 개발자 커뮤니티 (GitHub/블로그)
  → 3차: 글로벌 Claude 사용자 (영문 README + i18n)
  → 4차: 다른 LLM 지원 (Gemini, GPT 등)
```

---

## 8. GTM Strategy (Product Compass)

### Phase 1: Internal Dogfooding (Week 1-3)

| Action | Detail |
|--------|--------|
| **채널** | 내부 Telegram 그룹 |
| **목표** | 4봇 안정 운영, 핵심 플로우 검증 |
| **성공 기준** | 일일 50+ 메시지 처리, 핸드오프 성공률 95%+ |
| **피드백** | 직접 사용하며 이슈 즉시 수정 |

### Phase 2: Open Source Launch (Week 4-6)

| Action | Detail |
|--------|--------|
| **채널** | GitHub 공개 + README(한/영) |
| **목표** | 50 GitHub stars, 10 외부 사용자 |
| **콘텐츠** | 설치 가이드, 데모 영상, 아키텍처 문서 |
| **커뮤니티** | Issues/Discussions 활성화 |

### Phase 3: Community Growth (Month 2-3)

| Action | Detail |
|--------|--------|
| **채널** | 기술 블로그 (한/영), Twitter/X, Anthropic Discord |
| **목표** | 200 stars, 50 활성 사용자 |
| **콘텐츠** | "cokacdir에서 TeleHub으로" 마이그레이션 가이드 |
| **확장** | 커스텀 봇 템플릿, 플러그인 시스템 |

---

## 9. Product Requirements

### 9.1 Core Features (MVP)

| ID | Feature | Priority | Description |
|----|---------|----------|-------------|
| F1 | Multi-Bot Orchestration | P0 | 4+ 봇이 단일 그룹챗에서 동시 운영 |
| F2 | Smart Routing | P0 | `#이름` prefix + reply 라우팅 + `#얘들아` 자동 분류 |
| F3 | Bot-to-Bot Handoff | P0 | stdout 패턴 감지 + custom tool로 자동 핸드오프 |
| F4 | Request Queue | P0 | 봇 바쁠 때 요청 적재, 완료 후 순차 처리 |
| F5 | Session Persistence | P1 | 프로젝트별 Claude CLI 세션 저장/복원 (--resume) |
| F6 | Health Monitoring | P1 | stdout heartbeat, 3분 무이벤트 → 사용자 알림 |
| F7 | Long Response Handling | P1 | 짧은 응답은 메시지, 긴 응답은 .md 파일 첨부 |
| F8 | Hot-Reload Config | P2 | hub-config.json 변경 시 재시작 없이 적용 |

### 9.2 System Commands

| Command | Action |
|---------|--------|
| `#상태` | 봇 상태 대시보드 표시 |
| `#프로젝트` | 프로젝트 목록 |
| `#전환 {name}` | 프로젝트 전환 |
| `#클리어` | 현재 봇 세션 초기화 |
| `#전체클리어` | 전체 봇 세션 초기화 |
| `#끝` | 활성 세션 해제 |

### 9.3 Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | 메시지 라우팅 <100ms, EventEmitter 통신 ~0ms |
| **Reliability** | pm2 자동 재시작, graceful shutdown |
| **Security** | `--dangerously-skip-permissions` (신뢰 환경), 토큰 `.env` 관리 |
| **Scalability** | 초기 4봇, config 추가로 무제한 확장 |
| **Maintainability** | 모듈별 분리, 파일 ≤800줄, 함수 ≤50줄 |

### 9.4 Technical Architecture

```
TeleHub Hub (Node.js, single process, pm2)
├── TelegramAdapter      → 메시지 수신/발신 (polling)
├── MessageParser         → # prefix, reply, system command 파싱
├── Router                → keyword match / reply routing / broadcast
├── BotManager            → Claude CLI spawn/resume/kill
├── EventBus              → EventEmitter 기반 봇간 통신
├── QueueManager          → per-bot 요청 대기열
├── SessionStore          → 프로젝트별 세션 JSON
├── HealthMonitor         → stdout heartbeat 감시
├── ResponseFormatter     → 메시지/파일 자동 전환
└── ConfigWatcher         → fs.watch 핫 리로드
```

### 9.5 Validation Criteria

- [ ] 4 봇이 `#이름` 트리거로 독립 응답
- [ ] Reply 라우팅 (# 없이) 정상 작동
- [ ] `#얘들아` → Hub Claude 분류 → 적절한 봇에 배분
- [ ] 봇간 핸드오프 (stdout 패턴 + custom tool) 작동
- [ ] 봇 바쁠 때 대기열 적재 → 완료 후 순차 처리
- [ ] 프로젝트 전환 시 세션 복원
- [ ] `#상태` 대시보드 정확하게 표시
- [ ] `#클리어` / `#전체클리어` 세션 초기화
- [ ] 긴 응답 자동 파일 전환
- [ ] 3분 무이벤트 → 사용자 알림
- [ ] hub-config.json 수정 → 재시작 없이 반영
- [ ] pm2 백그라운드 안정 실행

---

## 10. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Claude CLI `--resume` 불안정 | 세션 유실 | 중 | 세션 재생성 fallback, 주기적 세션 상태 백업 |
| Telegram Rate Limit | 메시지 전송 실패 | 낮 | 메시지 배치 전송, 재시도 로직 |
| Claude CLI stdout 파싱 에러 | 봇 응답 누락 | 중 | 에러 핸들링, raw output fallback |
| 동시 4봇 리소스 소모 | macOS 성능 저하 | 중 | 유휴 봇 세션 해제, 리소스 모니터링 |
| `#얘들아` 분류 정확도 | 잘못된 봇에 배분 | 중 | 분류 프롬프트 튜닝, 사용자 확인 옵션 |

---

## Next Steps

1. `/pdca plan telehub` — 이 PRD를 기반으로 구현 계획 수립
2. `/pdca design telehub` — 아키텍처 상세 설계
3. MVP 구현 (F1-F4 우선)
4. 내부 dogfooding → 피드백 반영
