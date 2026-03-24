# TeleHub — PRD Seed Document

## Product Vision

TeleHub은 Claude Code의 Agent Teams 경험을 Telegram 그룹챗으로 가져오는 Node.js 기반 멀티봇 오케스트레이션 시스템이다.

## Problem Statement

현재 cokacdir의 Telegram 봇 시스템은:
- Rust 단일 파일(8,683줄)로 유지보수 어려움
- 봇간 통신이 파일 기반 폴링(5초 지연)
- 봇들이 독립 세션으로 동작, 진정한 팀 협업 불가
- 그룹챗에서 매번 `@봇이름` 태깅 필요 (UX 불편)

## Target Users

- 소규모 팀(3-10명)이 AI 봇들을 팀원처럼 활용
- 초기: 내부 사용 (개발팀 5명 + 봇 4개)

## Core Features (Interview-Confirmed)

### 1. Multi-Bot Orchestration
- 4+ 봇이 하나의 Telegram 그룹챗에서 동시 운영
- 각 봇은 전문 역할 담당 (리서치, 개발, 마케팅, 비서)
- Claude CLI subprocess로 실행 (구독 요금 사용)

### 2. Smart Routing
- `#봇이름` prefix 트리거 (부분 이름 매칭)
- Telegram reply로 자동 라우팅 (# 불필요)
- `#얘들아` broadcast → Hub가 Claude CLI로 분류/배분

### 3. Bot-to-Bot Collaboration
- 봇이 작업 완료 후 다음 봇에게 자동 핸드오프
- `#봇이름` stdout 패턴 감지 + 커스텀 tool 호출
- Hub가 중간 검증 (대상 봇 상태 확인, 대기열 관리)

### 4. Project Management
- 여러 프로젝트 전환 가능 (`#전환 프로젝트명`)
- 프로젝트별 봇 세션 영속성 (Claude CLI --resume)
- 상태 대시보드 (`#상태`)
- 컨텍스트 클리어 (`#클리어`, `#전체클리어`)

### 5. Request Queue
- 봇 작업 중 추가 요청 → 대기열에 적재
- 작업 완료 후 순차 처리

### 6. Health Monitoring
- Claude CLI stdout heartbeat (stream-json events)
- 3분 무이벤트 → 사용자에게 알림 (재시작/중단 선택)

### 7. Response Optimization
- 짧은 응답: Telegram 메시지
- 긴 응답: 자동으로 파일(.md) 첨부 전환

### 8. Hot-Reloadable Config
- `hub-config.json`으로 봇 추가/수정/삭제
- fs.watch로 변경 감지 → 재시작 없이 적용
- 봇(비서)이 Claude CLI로 config 수정 가능

## Architecture Summary

```
TeleHub Hub (Node.js, pm2 background)
├── Telegram Polling → Message Parser
├── Router (keyword match / reply detection / broadcast)
├── Bot Manager (spawn/resume/kill Claude CLI)
├── EventEmitter (in-memory bot-to-bot comms)
├── Queue Manager (per-bot request queue)
├── Session Store (project-based, JSON)
├── Health Monitor (stdout heartbeat)
└── Config Watcher (fs.watch hot-reload)
```

## Bot Roster (Initial)

| Name | Role | Triggers |
|------|------|----------|
| 김제헌 | 리서치 | 제헌, ㅈㅎ, 리서치 |
| 김용훈 | 개발 | 용훈, ㅇㅎ, 개발 |
| 김승훈 | 마케팅 | 승훈, 마케팅 |
| 김승주 | 비서 | 승주, 비서 |

## Constraints

- macOS only, pm2 background
- Claude Pro/Max subscription (no API costs)
- No Docker, no EC2
- No user permission differentiation

## Interview Reference

Full interview details: `docs/interviews/interview-telehub-2026-03-24.md`

## Next Steps

Run `/pm-discovery` in the telehub project session to generate full PRD with:
- Opportunity Solution Tree analysis
- Value Proposition (JTBD)
- Lean Canvas
- Market Research
- Beachhead Segment + GTM Strategy
